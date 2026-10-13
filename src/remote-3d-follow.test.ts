import type { CameraSession } from './controller.js';
import type { ViewportSample3D } from './remote.js';
import { expect, it, vi } from 'vitest';
import { followRemote3D } from './remote-3d-follow.js';

it('copies only current-scene samples, pauses, resumes and cleans up on preemption', async () => {
	const abort = new AbortController();
	const claim = { active: true, signal: abort.signal, release: vi.fn(), set3D: vi.fn(() => ({ status: 'completed' })) } as unknown as CameraSession;
	const stop = vi.fn();
	let receive!: (sample: ViewportSample3D) => void;
	const follow = followRemote3D(claim, (callback) => {
		receive = callback;
		return { stop };
	}, () => 'scene');
	const sample = { userId: 'source', sceneId: 'scene', view: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } } };
	receive({ ...sample, sceneId: 'other' });
	expect(claim.set3D).not.toHaveBeenCalled();
	receive(sample);
	expect(claim.set3D).toHaveBeenCalledOnce();
	follow.pause();
	receive(sample);
	expect(claim.set3D).toHaveBeenCalledOnce();
	follow.resume();
	expect(claim.set3D).toHaveBeenCalledTimes(2);
	abort.abort('preempted');
	expect(await follow.done).toEqual({ status: 'cancelled', reason: 'preempted' });
	follow.stop();
	expect(stop).toHaveBeenCalledOnce();
	expect(claim.release).toHaveBeenCalledOnce();
	receive(sample);
	expect(claim.set3D).toHaveBeenCalledTimes(2);
});
