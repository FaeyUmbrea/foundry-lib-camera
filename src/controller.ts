import type { Camera3D, CameraResult3D, CameraView3D } from './camera-3d.js';
import type { CameraFollow } from './follow.js';
import type { CameraAdapter, CameraPosition, MovementResult, MoveOptions } from './movement.js';
import type { CameraClaim, ConsumerOptions, RejectionReason } from './ownership.js';
import { validView3D } from './camera-3d.js';
import { followCamera } from './follow.js';
import { CameraMovement, validMove } from './movement.js';
import { CameraCoordinator } from './ownership.js';

export interface CameraSession extends CameraClaim {
	/** Replace this claim's current movement, continuing from the actual view. */
	retarget: (options: MoveOptions, signal?: AbortSignal) => Promise<MovementResult>;
	set3D: (view: CameraView3D) => CameraResult3D;
	move: (options: MoveOptions, signal?: AbortSignal) => Promise<MovementResult>;
}

export type SessionResult
	= | {
		ok: true;
		claim: CameraSession;
	}
	| {
		ok: false;
		reason: RejectionReason | 'unavailable';
	};

export interface LocalConsumer {
	readonly id: string;
	follow: (source: () => MoveOptions | undefined, interval?: number) => {
		ok: true;
		follow: CameraFollow;
	} | {
		ok: false;
		reason: RejectionReason | 'unavailable';
	};
	/** Acquire, set the 3D view immediately, and release. */
	set3D: (view: CameraView3D) => CameraResult3D;
	acquire: () => SessionResult;
	/** Acquire, move, and release, including when movement fails. */
	move: (options: MoveOptions, signal?: AbortSignal) => Promise<MovementResult | {
		status: 'rejected';
		reason: RejectionReason;
	}>;
	unregister: () => void;
}

export class CameraController {
	readonly ownership = new CameraCoordinator();
	readonly #movement: CameraMovement;
	#sessions = new Map<string, CameraSession>();
	readonly consumers = new Map<string, LocalConsumer>();

	constructor(readonly adapter: CameraAdapter, readonly getUserId: () => string | undefined, readonly camera3D?: Camera3D) {
		this.#movement = new CameraMovement(adapter);
	}

	read(): Readonly<CameraPosition> | undefined {
		return this.adapter.read();
	}

	register(options: ConsumerOptions): LocalConsumer {
		const consumer = this.ownership.register(options);
		const acquire = (): SessionResult => {
			const userId = this.getUserId();
			if (!userId || (!this.adapter.read() && !this.camera3D?.read())) return { ok: false, reason: 'unavailable' };
			const result = consumer.acquire(userId);
			if (!result.ok) return result;
			const claim = result.claim;
			let running: Promise<MovementResult> | undefined;
			let operation: AbortController | undefined;
			let revision = 0;
			const move = (options: MoveOptions, signal?: AbortSignal): Promise<MovementResult> => {
				if (running) return Promise.resolve({ status: 'rejected', reason: 'busy' });
				operation = new AbortController();
				const combined = signal ? AbortSignal.any([signal, operation.signal]) : operation.signal;
				running = this.#movement.move(claim, options, combined).finally(() => {
					running = undefined;
				});
				return running;
			};
			const retarget = async (options: MoveOptions, signal?: AbortSignal): Promise<MovementResult> => {
				if (!validMove(options)) return { status: 'rejected', reason: 'invalid-input' };
				const current = ++revision;
				operation?.abort();
				await running;
				if (current !== revision) return { status: 'cancelled', reason: 'retargeted' };
				return move(options, signal);
			};
			const session: CameraSession = Object.freeze({
				consumerId: claim.consumerId,
				userId: claim.userId,
				get active() {
					return claim.active;
				},
				signal: claim.signal,
				set3D: (view: CameraView3D) => this.camera3D?.set(claim, view) ?? { status: 'rejected', reason: 'unavailable' },
				release: claim.release,
				move,
				retarget,
			});
			this.#sessions.set(userId, session);
			claim.signal.addEventListener('abort', () => {
				if (this.#sessions.get(userId) === session) this.#sessions.delete(userId);
			}, { once: true });
			return { ok: true, claim: session };
		};
		const registered: LocalConsumer = Object.freeze({
			id: consumer.id,
			acquire,
			follow: (source: () => MoveOptions | undefined, interval?: number) => {
				if (typeof source !== 'function' || (interval !== undefined && (!Number.isFinite(interval) || interval < 16 || interval > 60000))) throw new TypeError('Invalid follow source or interval');
				const result = acquire();
				if (!result.ok) return result;
				return { ok: true as const, follow: followCamera(result.claim, source, interval) };
			},
			set3D: (view: CameraView3D): CameraResult3D => {
				if (!validView3D(view)) return { status: 'rejected', reason: 'invalid-input' };
				if (!this.camera3D) return { status: 'rejected', reason: 'unavailable' };
				const reason = this.camera3D.availability();
				if (reason) return { status: 'rejected', reason };
				const result = acquire();
				if (!result.ok) return { status: 'rejected', reason: result.reason };
				try {
					return result.claim.set3D(view);
				} finally {
					result.claim.release();
				}
			},
			move: async (move: MoveOptions, signal?: AbortSignal) => {
				if (!validMove(move)) return { status: 'rejected' as const, reason: 'invalid-input' as const };
				if (signal?.aborted) return { status: 'cancelled' as const, reason: 'cancelled' as const };
				if (!this.adapter.read()) return { status: 'rejected' as const, reason: 'unavailable' as const };
				const result = acquire();
				if (!result.ok) return { status: 'rejected' as const, reason: result.reason };
				try {
					return await result.claim.move(move, signal);
				} finally {
					result.claim.release();
				}
			},
			unregister: () => {
				consumer.unregister();
				if (this.consumers.get(consumer.id) === registered) this.consumers.delete(consumer.id);
			},
		});
		this.consumers.set(consumer.id, registered);
		return registered;
	}

	releaseLocal(): void {
		const userId = this.getUserId();
		if (userId) this.#sessions.get(userId)?.release();
	}

	panic(): void {
		this.ownership.panic();
	}

	resume(): void {
		this.ownership.resume();
	}

	reset(): void {
		this.ownership.reset();
	}
}
