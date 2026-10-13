import type { CameraResult3D, CameraView3D } from './camera-3d.js';
import type { CameraController } from './controller.js';
import type { CameraPosition, MovementResult, MoveOptions } from './movement.js';
import type { TrackingMode } from './viewport-filter.js';
import { validView3D } from './camera-3d.js';
import { validMove } from './movement.js';
import { followRemote3D } from './remote-3d-follow.js';
import { ViewportFilter } from './viewport-filter.js';

export type RemoteOutcome = MovementResult | CameraResult3D | {
	status: 'rejected';
	reason: 'unauthorized' | 'wrong-scene' | 'unregistered';
};
export interface RemoteUserResult {
	userId: string;
	/** Acknowledgements from responding sessions; this is not proof that every session responded. */
	outcomes: RemoteOutcome[];
	status: 'acknowledged' | 'timeout' | 'cancelled' | 'offline' | 'rejected';
}
export interface RemoteOptions {
	timeout?: number;
	signal?: AbortSignal;
}
export interface ViewportSample {
	userId: string;
	sceneId: string;
	position: Readonly<CameraPosition>;
}
/** Native 3D view from a responding user on a particular scene. */
export interface ViewportSample3D {
	userId: string;
	sceneId: string;
	view: Readonly<CameraView3D> | null;
}
export interface ViewportSubscription { stop: () => void }
export interface RemoteEnvironment {
	userId: () => string | undefined;
	users: () => readonly {
		id: string;
		isGM: boolean;
		active: boolean;
	}[];
	sceneId: () => string | undefined;
	read: () => Readonly<CameraPosition> | undefined;
	read3D?: () => Readonly<CameraView3D> | undefined;
	emit: (packet: object, recipients: string[]) => void;
}
interface Pending {
	users: string[];
	outcomes: Map<string, Map<string, RemoteOutcome>>;
	finish: (cancelled?: boolean) => void;
}
interface Incoming {
	abort: AbortController;
	expires: number;
	result?: RemoteOutcome;
}
interface Watcher {
	filter: ViewportFilter;
	userId: string;
	callback: (sample: ViewportSample) => void;
	timer: ReturnType<typeof setInterval>;
}

/** Native 3D callback and renewal timer for one requested user. */
interface Watcher3D {
	userId: string;
	callback: (sample: ViewportSample3D) => void;
	timer: ReturnType<typeof setInterval>;
}

/** A recipient's expiring subscription, with change detection for native 3D samples. */
interface ViewportRecipient {
	userId: string;
	id: string;
	expires: number;
	dimension?: '3d';
	last3D?: string;
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
function id(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.length <= 128;
}
function position(value: unknown): value is CameraPosition {
	return record(value) && ['x', 'y', 'scale'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))
		&& Number(value.scale) > 0 && (value.level === undefined || id(value.level));
}
function outcome(value: unknown): value is RemoteOutcome {
	if (!record(value)) return false;
	if (value.status === 'completed') return position(value.position) || (record(value.view) && validView3D(value.view as unknown as CameraView3D));
	return ['rejected', 'cancelled', 'failed'].includes(String(value.status)) && id(value.reason);
}

/** Session and packet IDs must also work on Foundry's plain HTTP LAN URLs. */
function randomId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Foundry supplies sender identity as the second socket callback argument. Never read it from payloads. */
export class RemoteCamera {
	readonly #session = randomId();
	readonly #pending = new Map<string, Pending>();
	readonly #incoming = new Map<string, Incoming>();
	readonly #watchers = new Map<string, Watcher>();
	readonly #watchers3D = new Map<string, Watcher3D>();
	#camera3DTimer?: ReturnType<typeof setInterval>;
	readonly #subscribers = new Map<string, ViewportRecipient>();

	#publishTimer?: ReturnType<typeof setTimeout>;
	#disposed = false;
	constructor(readonly controller: CameraController, readonly environment: RemoteEnvironment) {}

	move(consumer: string, targets: string | readonly string[], options: MoveOptions, remote?: RemoteOptions): Promise<RemoteUserResult[]> {
		if (!validMove(options)) throw new TypeError('Invalid movement');
		return this.#request(consumer, targets, 'move', options, remote);
	}

	set3D(consumer: string, targets: string | readonly string[], view: CameraView3D, remote?: RemoteOptions): Promise<RemoteUserResult[]> {
		if (!validView3D(view)) throw new TypeError('Invalid 3D view');
		return this.#request(consumer, targets, 'set3D', view, remote);
	}

	#send(packet: object, users: string[]): void {
		try {
			this.environment.emit(packet, users);
		} catch (error) {
			console.error('libCamera: socket delivery failed', error);
		}
		// Local delivery also works when Foundry excludes the sending socket.
		const me = this.environment.userId();
		if (me && users.includes(me)) void this.receive(packet, me);
	}

	#authorized(sender: string, target: string): boolean {
		return this.environment.users().some(user => user.id === sender && (user.isGM || sender === target));
	}

	#request(consumer: string, targets: string | readonly string[], action: 'move' | 'set3D', data: MoveOptions | CameraView3D, options: RemoteOptions = {}): Promise<RemoteUserResult[]> {
		if (this.#disposed) throw new Error('Remote camera is disposed');
		const users = [...new Set(targets === '*' ? this.environment.users().filter(user => user.active).map(user => user.id) : typeof targets === 'string' ? [targets] : targets)];
		const me = this.environment.userId();
		const sceneId = this.environment.sceneId();
		const timeout = options.timeout ?? Math.min(65000, (action === 'move' ? (data as MoveOptions).duration ?? 0 : 0) + 2000);
		if (!id(consumer) || !users.length || users.length > 256 || !users.every(id) || !Number.isFinite(timeout) || timeout < 100 || timeout > 65000) throw new TypeError('Invalid remote request');
		if (!me || !sceneId) throw new Error('A ready scene and user are required');
		if (!users.every(user => this.#authorized(me, user))) return Promise.resolve(users.map(userId => ({ userId, status: 'rejected', outcomes: [{ status: 'rejected', reason: 'unauthorized' }] })));
		if (this.#pending.size >= 128) throw new Error('Too many pending camera requests');
		const requestId = randomId();
		return new Promise((resolve) => {
			const outcomes = new Map<string, Map<string, RemoteOutcome>>();
			let timer: ReturnType<typeof setTimeout>;
			let finish: (cancelled?: boolean) => void;
			const cancel = () => {
				finish(true);
				this.#send({ kind: 'cancel', id: requestId }, users);
			};
			finish = (cancelled = false) => {
				if (!this.#pending.delete(requestId)) return;
				clearTimeout(timer);
				options.signal?.removeEventListener('abort', cancel);
				resolve(users.map((userId) => {
					const received = [...(outcomes.get(userId)?.values() ?? [])];
					return { userId, outcomes: received, status: cancelled ? 'cancelled' : received.length ? 'acknowledged' : this.environment.users().some(user => user.id === userId && user.active) ? 'timeout' : 'offline' };
				}));
			};
			timer = setTimeout(() => {
				finish();
				this.#send({ kind: 'cancel', id: requestId }, users);
			}, timeout);
			this.#pending.set(requestId, { users, outcomes, finish });
			options.signal?.addEventListener('abort', cancel, { once: true });
			if (options.signal?.aborted) {
				cancel();
			} else {
				try {
					this.#send({ kind: 'request', id: requestId, sceneId, consumer, action, data }, users);
				} catch {
					finish();
				}
			}
		});
	}

	watch(userId: string, callback: (sample: ViewportSample) => void, mode: TrackingMode = 'raw'): ViewportSubscription {
		const me = this.environment.userId();
		if (!['raw', 'smooth', 'dragRelease'].includes(mode)) throw new TypeError('Invalid tracking mode');
		if (this.#disposed || !me || !id(userId) || typeof callback !== 'function' || !this.environment.users().some(user => user.id === userId)) throw new Error('Viewport subscription is unavailable or unauthorized');
		if (this.#watchers.size >= 128) throw new Error('Too many viewport subscriptions');
		const watchId = randomId();
		const renew = () => this.#send({ kind: 'watch', id: watchId }, [userId]);
		const timer = setInterval(renew, 5000);
		const filter = new ViewportFilter(mode, (sample) => {
			try {
				callback(sample);
			} catch (error) {
				console.error('libCamera: viewport observer failed', error);
			}
		});
		this.#watchers.set(watchId, { userId, callback, timer, filter });
		renew();
		return { stop: () => {
			if (!this.#watchers.delete(watchId)) return;
			clearInterval(timer);
			filter.dispose();
			this.#send({ kind: 'unwatch', id: watchId }, [userId]);
		} };
	}

	/** Subscribe to native 3D samples; sender identity is checked before delivering each sample. */
	watch3D(userId: string, callback: (sample: ViewportSample3D) => void): ViewportSubscription {
		if (this.#disposed || !this.environment.userId() || !id(userId) || typeof callback !== 'function' || !this.environment.users().some(user => user.id === userId)) throw new Error('3D viewport subscription is unavailable');
		if (this.#watchers3D.size >= 128) throw new Error('Too many 3D viewport subscriptions');
		const watchId = randomId();
		const renew = () => this.#send({ kind: 'watch', id: watchId, dimension: '3d' }, [userId]);
		const timer = setInterval(renew, 5000);
		this.#watchers3D.set(watchId, { userId, callback, timer });
		renew();
		return { stop: () => {
			if (!this.#watchers3D.delete(watchId)) return;
			clearInterval(timer);
			this.#send({ kind: 'unwatch', id: watchId }, [userId]);
		} };
	}

	/** Acquire a camera claim and copy a user's native 3D samples until stopped or preempted. */
	followUser3D(consumerId: string, userId: string) {
		const consumer = this.controller.consumers.get(consumerId);
		if (!consumer) return { ok: false as const, reason: 'unregistered' as const };
		const result = consumer.acquire();
		if (!result.ok) return result;
		return { ok: true as const, follow: followRemote3D(result.claim, callback => this.watch3D(userId, callback), this.environment.sceneId) };
	}

	/** Follow the most recently changed viewport among the consumer-selected users on this scene. */
	followUser(consumerId: string, userId: string | readonly string[], options: Pick<MoveOptions, 'duration' | 'easing' | 'bounds' | 'lockInput'> = {}, mode: TrackingMode = 'smooth') {
		const consumer = this.controller.consumers.get(consumerId);
		if (!consumer) return { ok: false as const, reason: 'unregistered' as const };
		const userIds = [...new Set(typeof userId === 'string' ? [userId] : userId)];
		if (!userIds.length || userIds.length > 128) throw new TypeError('Follow requires between 1 and 128 users');
		let latest: ViewportSample | undefined;
		const previous = new Map<string, string>();
		const subscriptions: ViewportSubscription[] = [];
		const stop = () => subscriptions.forEach(subscription => subscription.stop());
		try {
			for (const source of userIds) {
				subscriptions.push(this.watch(source, (sample) => {
					const identity = JSON.stringify([sample.sceneId, sample.position]);
					if (previous.get(source) === identity) return;
					previous.set(source, identity);
					latest = sample;
				}, mode));
			}
			const result = consumer.follow(() => latest && latest.sceneId === this.environment.sceneId() ? { duration: 33, easing: 'linear', ...options, ...latest.position } : undefined);
			if (!result.ok) stop();
			else void result.follow.done.finally(stop);
			return result;
		} catch (error) {
			stop();
			throw error;
		}
	}

	/** Bound socket traffic to approximately 30 Hz, retaining the newest sample. */
	publish(): void {
		if (this.#disposed || this.#publishTimer) return;
		this.#publishTimer = setTimeout(() => {
			this.#publishTimer = undefined;
			for (const [key, subscriber] of this.#subscribers) {
				if (subscriber.expires < Date.now()) this.#subscribers.delete(key);
				else this.#snapshot(subscriber.userId, subscriber.id);
			}
		}, 33);
	}

	#snapshot(userId: string, watchId: string): void {
		const view = this.environment.read();
		const sceneId = this.environment.sceneId();
		if (this.#subscribers.get(`${userId}:${watchId}`)?.dimension === '3d') {
			const view3D = this.environment.read3D?.();
			const subscriber = this.#subscribers.get(`${userId}:${watchId}`)!;
			const serialized = JSON.stringify([sceneId, view3D ?? null]);
			if (subscriber.last3D === serialized) return;
			subscriber.last3D = serialized;
			if (sceneId) this.#send({ kind: 'view3D', id: watchId, sceneId, view: view3D ?? null }, [userId]);
		} else if (view && sceneId) {
			this.#send({ kind: 'view', id: watchId, sceneId, position: view }, [userId]);
		}
	}

	/** Poll native 3D subscriptions and stop the timer when none remain. */
	#publish3D(): void {
		let active = false;
		for (const [entry, subscriber] of this.#subscribers) {
			if (subscriber.expires < Date.now()) {
				this.#subscribers.delete(entry);
			} else if (subscriber.dimension === '3d') {
				active = true;
				this.#snapshot(subscriber.userId, subscriber.id);
			}
		}
		if (!active) {
			clearInterval(this.#camera3DTimer);
			this.#camera3DTimer = undefined;
		}
	}

	async receive(packet: unknown, sender: unknown): Promise<void> {
		if (this.#disposed || !record(packet) || !id(packet.id) || !id(sender)) return;
		const me = this.environment.userId();
		if (!me) return;
		const key = `${sender}:${packet.id}`;
		if (packet.kind === 'ack') {
			const pending = this.#pending.get(packet.id);
			if (!pending?.users.includes(sender) || !id(packet.session) || !outcome(packet.result)) return;
			const responses = pending.outcomes.get(sender) ?? new Map<string, RemoteOutcome>();
			if (responses.size < 128) responses.set(packet.session, packet.result);
			pending.outcomes.set(sender, responses);
			return;
		}
		if (packet.kind === 'view3D') {
			const watcher = this.#watchers3D.get(packet.id);
			if (watcher?.userId !== sender || !id(packet.sceneId) || (packet.view !== null && !validView3D(packet.view as CameraView3D))) return;
			try {
				watcher.callback({ userId: sender, sceneId: packet.sceneId, view: packet.view === null ? null : structuredClone(packet.view as CameraView3D) });
			} catch (error) {
				console.error('libCamera: 3D viewport observer failed', error);
			}
			return;
		}
		if (packet.kind === 'view') {
			const watcher = this.#watchers.get(packet.id);
			if (watcher?.userId !== sender || !id(packet.sceneId) || !position(packet.position)) return;
			try {
				watcher.filter.push({ userId: sender, sceneId: packet.sceneId, position: Object.freeze({ ...packet.position }) });
			} catch (error) {
				console.error('libCamera: viewport observer failed', error);
			}
			return;
		}
		if (packet.kind === 'cancel') {
			this.#incoming.get(key)?.abort.abort();
			return;
		}
		if (packet.kind === 'unwatch') {
			this.#subscribers.delete(key);
			return;
		}
		if (packet.kind === 'watch') {
			// Viewport observation does not grant camera control; OBS clients are ordinary players.
			if (!this.environment.users().some(user => user.id === sender)) return;
			for (const [entry, subscriber] of this.#subscribers) {
				if (subscriber.expires < Date.now()) this.#subscribers.delete(entry);
			}
			if (this.#subscribers.size >= 128 && !this.#subscribers.has(key)) return;
			this.#subscribers.set(key, { userId: sender, id: packet.id, expires: Date.now() + 15000, dimension: packet.dimension === '3d' ? '3d' : undefined });
			if (packet.dimension === '3d') this.#camera3DTimer ??= setInterval(() => this.#publish3D(), 33);
			this.#snapshot(sender, packet.id);
			return;
		}
		if (packet.kind !== 'request') return;
		const reply = (result: RemoteOutcome) => this.#send({ kind: 'ack', id: packet.id, session: this.#session, result }, [sender]);
		if (!this.#authorized(sender, me)) {
			reply({ status: 'rejected', reason: 'unauthorized' });
			return;
		}
		if (packet.sceneId !== this.environment.sceneId()) {
			reply({ status: 'rejected', reason: 'wrong-scene' });
			return;
		}
		if (!id(packet.consumer)) return;
		const consumer = this.controller.consumers.get(packet.consumer);
		if (!consumer) {
			reply({ status: 'rejected', reason: 'unregistered' });
			return;
		}
		const existing = this.#incoming.get(key);
		if (existing) {
			if (existing.result) reply(existing.result);
			return;
		}
		for (const [entry, incoming] of this.#incoming) {
			if (incoming.result && incoming.expires < Date.now()) this.#incoming.delete(entry);
		}
		if (this.#incoming.size >= 128) {
			reply({ status: 'rejected', reason: 'busy' });
			return;
		}
		const incoming: Incoming = { abort: new AbortController(), expires: Date.now() + 70000 };
		this.#incoming.set(key, incoming);
		try {
			if (packet.action === 'move' && record(packet.data) && validMove(packet.data)) incoming.result = await consumer.move(packet.data, incoming.abort.signal);
			else if (packet.action === 'set3D' && record(packet.data) && validView3D(packet.data as unknown as CameraView3D)) incoming.result = consumer.set3D(packet.data as unknown as CameraView3D);
			else incoming.result = { status: 'rejected', reason: 'invalid-input' };
		} catch { incoming.result = { status: 'failed', reason: 'adapter-error' }; }
		reply(incoming.result);
	}

	dispose(): void {
		this.#disposed = true;
		clearTimeout(this.#publishTimer);
		clearInterval(this.#camera3DTimer);
		for (const watcher of this.#watchers3D.values()) clearInterval(watcher.timer);
		this.#watchers3D.clear();
		for (const pending of this.#pending.values()) pending.finish(true);
		for (const incoming of this.#incoming.values()) incoming.abort.abort();
		for (const watcher of this.#watchers.values()) {
			clearInterval(watcher.timer);
			watcher.filter.dispose();
		}
		this.#incoming.clear();
		this.#watchers.clear();
		this.#subscribers.clear();
	}
}
