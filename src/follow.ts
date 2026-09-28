import type { CameraSession } from './controller.js';
import type { MovementResult, MoveOptions } from './movement.js';

export interface CameraFollow {
	readonly active: boolean;
	readonly paused: boolean;
	/** Resolves on stop, preemption, panic, teardown or a source/movement failure. */
	readonly done: Promise<MovementResult>;
	pause: () => void;
	resume: () => void;
	stop: () => void;
}

/** Sample a consumer-selected source; tracking policy remains with the consumer. */
export function followCamera(session: CameraSession, source: () => MoveOptions | undefined, interval = 33): CameraFollow {
	if (typeof source !== 'function' || !Number.isFinite(interval) || interval < 16 || interval > 60000) throw new TypeError('Follow requires a source and an interval between 16 and 60000 ms');
	let paused = false;
	let ended = false;
	let last = '';
	let operation = new AbortController();
	let timer: ReturnType<typeof setInterval>;
	let cancelled: () => void;
	let finish!: (result: MovementResult) => void;
	const done = new Promise<MovementResult>((resolve) => {
		finish = resolve;
	});
	const end = (result: MovementResult) => {
		if (ended) return;
		ended = true;
		clearInterval(timer);
		operation.abort();
		session.signal.removeEventListener('abort', cancelled);
		session.release();
		finish(result);
	};
	cancelled = () => end({ status: 'cancelled', reason: session.signal.reason });
	const tick = () => {
		if (ended || paused) return;
		try {
			const view = source();
			if (!view) return;
			const key = JSON.stringify(view);
			if (key === last) return;
			last = key;
			void session.retarget(view, operation.signal).then((result) => {
				if (result.status === 'failed' || result.status === 'rejected') end(result);
			});
		} catch {
			end({ status: 'failed', reason: 'adapter-error' });
		}
	};
	timer = setInterval(tick, interval);
	session.signal.addEventListener('abort', cancelled, { once: true });
	if (!session.active) cancelled();
	else tick();
	return Object.freeze({
		get active() {
			return !ended;
		},
		get paused() {
			return paused;
		},
		done,
		pause: () => {
			paused = true;
			operation.abort();
		},
		resume: () => {
			if (ended) return;
			paused = false;
			last = '';
			operation = new AbortController();
			tick();
		},
		stop: () => end({ status: 'cancelled', reason: 'released' }),
	});
}
