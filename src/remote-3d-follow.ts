import type { CameraSession } from './controller.js';
import type { CameraFollow } from './follow.js';
import type { MovementResult } from './movement.js';
import type { ViewportSample3D, ViewportSubscription } from './remote.js';

/** Copy native 3D samples from the current scene, releasing the claim and subscription on stop. */
export function followRemote3D(session: CameraSession, subscribe: (callback: (sample: ViewportSample3D) => void) => ViewportSubscription, sceneId: () => string | undefined): CameraFollow {
	let ended = false;
	let paused = false;
	let latest: ViewportSample3D | undefined;
	let subscription: ViewportSubscription | undefined;
	let finish!: (result: MovementResult) => void;
	const done = new Promise<MovementResult>((resolve) => {
		finish = resolve;
	});
	/** End observation and release ownership exactly once. */
	function stop() {
		if (ended) return;
		ended = true;
		subscription?.stop();
		session.signal.removeEventListener('abort', stop);
		session.release();
		finish({ status: 'cancelled', reason: session.signal.reason ?? 'released' });
	}
	/** Apply a responding sample only while its scene and this claim remain current. */
	function apply(sample: ViewportSample3D) {
		latest = sample;
		if (ended || paused || !sample.view || sample.sceneId !== sceneId()) return;
		const result = session.set3D(sample.view);
		if (result.status !== 'completed') stop();
	}
	session.signal.addEventListener('abort', stop, { once: true });
	try {
		subscription = subscribe(apply);
		if (ended) subscription.stop();
		if (!session.active) stop();
	} catch (error) {
		stop();
		throw error;
	}
	return Object.freeze({
		get active() { return !ended; },
		get paused() { return paused; },
		done,
		pause: () => { paused = true; },
		resume: () => {
			paused = false;
			if (latest) apply(latest);
		},
		stop,
	});
}
