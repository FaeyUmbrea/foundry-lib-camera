/** Why a live claim ended. Movement adapters must observe the claim signal. */
export type ReleaseReason = 'released' | 'superseded' | 'unregistered' | 'panic' | 'canvas-teardown' | 'disposed';
export type RejectionReason = 'disabled' | 'unregistered' | 'busy' | 'disposed' | 'canvas-teardown';

export interface ConsumerOptions {
	/** Module ID. Registration is coordination, not an authorization boundary. */
	id: string;
	name: string;
	priority?: number;
}

export interface ClaimSnapshot {
	readonly consumerId: string;
	readonly userId: string;
	readonly priority: number;
}

export interface CameraClaim {
	readonly consumerId: string;
	readonly userId: string;
	readonly active: boolean;
	/** Aborted exactly once. signal.reason is a ReleaseReason. */
	readonly signal: AbortSignal;
	/** A stale claim cannot release a newer claim. */
	release: () => void;
}

export type ClaimResult
	= | { readonly ok: true; readonly claim: CameraClaim }
		| { readonly ok: false; readonly reason: RejectionReason; readonly owner?: ClaimSnapshot };

export interface CameraConsumer {
	readonly id: string;
	/** An existing claim is never silently replaced by another from the same consumer. */
	acquire: (userId: string) => ClaimResult;
	unregister: () => void;
}

export interface PriorityOverride {
	consumerId: string;
	/** Omit for a default applying to all users. */
	userId?: string;
	priority: number;
}

export interface ConsumerSnapshot {
	readonly id: string;
	readonly name: string;
	readonly priority: number;
}

export interface Diagnostic {
	readonly sequence: number;
	readonly action: 'acquired' | 'rejected' | 'ended';
	readonly consumerId: string;
	readonly userId: string;
	readonly reason?: ReleaseReason | RejectionReason;
}

interface Registration { id: string; name: string; priority: number }
interface ActiveClaim { registration: Registration; userId: string; controller: AbortController }

function requireId(value: string, label: string): void {
	if (typeof value !== 'string' || value.trim().length === 0) throw new TypeError(`${label} must be a non-empty string`);
}
function requirePriority(value: number): void {
	if (!Number.isSafeInteger(value)) throw new RangeError('Priority must be a safe integer');
}

/**
 * Per-user ownership arbitration for cooperative camera consumers.
 * The integration layer authenticates remote requests and enforces input locks.
 */
export class CameraCoordinator {
	#consumers = new Map<string, Registration>();
	#claims = new Map<string, ActiveClaim>();
	#defaults = new Map<string, number>();
	#overrides = new Map<string, Map<string, number>>();
	#disabledUsers = new Set<string>();
	#disabled = false;
	#disposed = false;
	#notifications = 0;
	#canvasGeneration = 0;
	#diagnostics: Diagnostic[] = [];
	#sequence = 0;
	readonly #diagnosticLimit: number;

	constructor({ diagnosticLimit = 100 }: { diagnosticLimit?: number } = {}) {
		if (!Number.isSafeInteger(diagnosticLimit) || diagnosticLimit < 0 || diagnosticLimit > 10000) {
			throw new RangeError('Diagnostic limit must be an integer from 0 to 10000');
		}
		this.#diagnosticLimit = diagnosticLimit;
	}

	register({ id, name, priority = 0 }: ConsumerOptions): CameraConsumer {
		this.#requireLive();
		requireId(id, 'Consumer ID');
		requireId(name, 'Consumer name');
		requirePriority(priority);
		if (this.#consumers.has(id)) throw new Error(`Consumer ${id} is already registered`);
		const registration: Registration = { id, name, priority };
		this.#consumers.set(id, registration);
		return Object.freeze({
			id,
			acquire: (userId: string) => this.#acquire(registration, userId),
			unregister: () => {
				if (this.#consumers.get(id) !== registration) return;
				this.#consumers.delete(id);
				this.#endMatching(claim => claim.registration === registration, 'unregistered');
			},
		});
	}

	/** Replace configuration atomically. New priorities apply to the next acquisition. */
	setPriorities(overrides: readonly PriorityOverride[]): void {
		this.#requireLive();
		const defaults = new Map<string, number>();
		const users = new Map<string, Map<string, number>>();
		for (const { consumerId, userId, priority } of overrides) {
			requireId(consumerId, 'Consumer ID');
			requirePriority(priority);
			let target = defaults;
			if (userId !== undefined) {
				requireId(userId, 'User ID');
				target = users.get(userId) ?? new Map<string, number>();
				users.set(userId, target);
			}
			if (target.has(consumerId)) throw new Error(`Duplicate priority override for ${consumerId}`);
			target.set(consumerId, priority);
		}
		this.#defaults = defaults;
		this.#overrides = users;
	}

	getConsumers(userId?: string): readonly ConsumerSnapshot[] {
		if (userId !== undefined) requireId(userId, 'User ID');
		return Object.freeze([...this.#consumers.values()].map(registration => Object.freeze({
			id: registration.id,
			name: registration.name,
			priority: this.#priority(registration, userId),
		})));
	}

	getOwner(userId: string): ClaimSnapshot | undefined {
		requireId(userId, 'User ID');
		const claim = this.#claims.get(userId);
		return claim ? this.#snapshot(claim) : undefined;
	}

	getClaims(): readonly ClaimSnapshot[] {
		return Object.freeze([...this.#claims.values()].map(claim => this.#snapshot(claim)));
	}

	getDiagnostics(): readonly Diagnostic[] { return Object.freeze([...this.#diagnostics]); }

	isDisabled(userId?: string): boolean {
		if (userId !== undefined) requireId(userId, 'User ID');
		return this.#disposed || this.#disabled || (userId !== undefined && this.#disabledUsers.has(userId));
	}

	/** Stop and block one user, or every user when omitted. Resume is explicit. */
	panic(userId?: string): void {
		if (userId !== undefined) requireId(userId, 'User ID');
		if (userId === undefined) this.#disabled = true;
		else this.#disabledUsers.add(userId);
		this.#endMatching(claim => userId === undefined || claim.userId === userId, 'panic');
	}

	/** Global resume preserves individual users' opt-outs. */
	resume(userId?: string): void {
		this.#requireLive();
		if (this.#notifications) throw new Error('Cannot resume while claims are being cancelled');
		if (userId === undefined) {
			this.#disabled = false;
		} else {
			requireId(userId, 'User ID');
			this.#disabledUsers.delete(userId);
		}
	}

	/** Release transient claims on a canvas transition; retain user configuration. */
	reset(): void {
		this.#canvasGeneration++;
		this.#endMatching(() => true, 'canvas-teardown');
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		this.#consumers.clear();
		this.#endMatching(() => true, 'disposed');
		this.#defaults.clear();
		this.#overrides.clear();
		this.#disabledUsers.clear();
	}

	#acquire(registration: Registration, userId: string): ClaimResult {
		requireId(userId, 'User ID');
		const owner = this.#claims.get(userId);
		let reason: RejectionReason | undefined;
		if (this.#disposed) {
			reason = 'disposed';
		} else if (this.#consumers.get(registration.id) !== registration) {
			reason = 'unregistered';
		} else if (this.isDisabled(userId)) {
			reason = 'disabled';
		} else if (this.#notifications || (owner && (owner.registration === registration
			|| this.#priority(registration, userId) <= this.#priority(owner.registration, userId)))) {
			reason = 'busy';
		}
		if (reason) {
			this.#record('rejected', registration.id, userId, reason);
			return Object.freeze({ ok: false, reason, ...(owner ? { owner: this.#snapshot(owner) } : {}) });
		}

		const canvasGeneration = this.#canvasGeneration;
		// Synchronous cleanup must finish before the new owner can move the camera.
		if (owner) this.#endMatching(claim => claim === owner, 'superseded');
		// Cancellation listeners may panic, dispose, or unregister this consumer.
		if (this.#disposed || this.isDisabled(userId) || this.#consumers.get(registration.id) !== registration) {
			return this.#acquire(registration, userId);
		}
		if (canvasGeneration !== this.#canvasGeneration) {
			this.#record('rejected', registration.id, userId, 'canvas-teardown');
			return Object.freeze({ ok: false, reason: 'canvas-teardown' });
		}
		const active: ActiveClaim = { registration, userId, controller: new AbortController() };
		this.#claims.set(userId, active);
		const isActive = () => this.#claims.get(userId) === active;
		const claim: CameraClaim = Object.freeze({
			consumerId: registration.id,
			userId,
			get active() { return isActive(); },
			signal: active.controller.signal,
			release: () => this.#endMatching(candidate => candidate === active, 'released'),
		});
		this.#record('acquired', registration.id, userId);
		return Object.freeze({ ok: true, claim });
	}

	#endMatching(predicate: (claim: ActiveClaim) => boolean, reason: ReleaseReason): void {
		const ended = [...this.#claims.values()].filter(predicate);
		// Remove the whole batch before callbacks so observers see a complete reset.
		for (const claim of ended) {
			this.#claims.delete(claim.userId);
			this.#record('ended', claim.registration.id, claim.userId, reason);
		}
		this.#notifications++;
		try {
			for (const claim of ended) claim.controller.abort(reason);
		} finally {
			this.#notifications--;
		}
	}

	#priority(registration: Registration, userId?: string): number {
		return (userId === undefined ? undefined : this.#overrides.get(userId)?.get(registration.id))
			?? this.#defaults.get(registration.id) ?? registration.priority;
	}

	#snapshot(claim: ActiveClaim): ClaimSnapshot {
		return Object.freeze({ consumerId: claim.registration.id, userId: claim.userId, priority: this.#priority(claim.registration, claim.userId) });
	}

	#record(action: Diagnostic['action'], consumerId: string, userId: string, reason?: Diagnostic['reason']): void {
		if (!this.#diagnosticLimit) return;
		this.#diagnostics.push(Object.freeze({ sequence: ++this.#sequence, action, consumerId, userId, ...(reason ? { reason } : {}) }));
		if (this.#diagnostics.length > this.#diagnosticLimit) this.#diagnostics.shift();
	}

	#requireLive(): void {
		if (this.#disposed) throw new Error('Camera coordinator is disposed');
	}
}
