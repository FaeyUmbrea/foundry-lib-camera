import type { CameraView3D, Canvas3D } from './camera-3d.js';
import type { CameraAdapter } from './movement.js';
import { describe, expect, it, vi } from 'vitest';
import { Camera3D } from './camera-3d.js';
import { CameraController } from './controller.js';

function vector(x: number, y: number, z: number) {
	return {
		x,
		y,
		z,
		set(x: number, y: number, z: number) { Object.assign(this, { x, y, z }); },
	};
}
const next: CameraView3D = { position: { x: 2, y: 3, z: 4 }, target: { x: 1, y: 0, z: 1 } };
function setup() {
	const view: Canvas3D = {
		_active: true,
		_ready: true,
		firstPersonMode: false,
		GameCamera: { enabled: false },
		cutsceneEngine: { isPlaying: false },
		camera: { position: vector(0, 2, 3) },
		controls: { target: vector(0, 0, 0), enableDamping: true, autoRotate: false, update: vi.fn() },
		stopCameraAnimation: vi.fn(),
	};
	const camera = new Camera3D(() => view);
	const adapter: CameraAdapter = { read: () => undefined, pan: vi.fn(), animate: vi.fn(), lockInput: vi.fn() };
	const controller = new CameraController(adapter, () => 'user', camera);
	const consumer = controller.register({ id: 'test', name: 'Test' });
	return { view, camera, controller, consumer };
}

describe('3D Canvas integration', () => {
	it('is unavailable when the optional module is absent', () => {
		const camera = new Camera3D(() => undefined);
		expect(camera.read()).toBeUndefined();
		expect(camera.availability()).toBe('unavailable');
	});

	it('does not preempt a 3D claim for unavailable 2D movement', async () => {
		const { consumer, controller } = setup();
		const owner = consumer.acquire();
		const higher = controller.register({ id: 'high', name: 'High', priority: 1 });
		expect(await higher.move({ x: 50 })).toEqual({ status: 'rejected', reason: 'unavailable' });
		expect(owner.ok && owner.claim.active).toBe(true);
	});

	it('reads detached immutable native vectors without changing the camera', () => {
		const { camera, view } = setup();
		const snapshot = camera.read()!;
		view.camera.position.x = 123;
		expect(snapshot.position.x).toBe(0);
		expect(Object.isFrozen(snapshot.position)).toBe(true);
		expect(Object.isFrozen(snapshot.target)).toBe(true);
		expect(view.controls.update).not.toHaveBeenCalled();
	});

	it('uses position/target setters and controls, then releases its temporary claim', () => {
		const { consumer, view, controller } = setup();
		expect(consumer.set3D(next)).toEqual({ status: 'completed', view: next });
		expect(view.stopCameraAnimation).toHaveBeenCalledOnce();
		expect(view.controls.update).toHaveBeenCalledTimes(2);
		expect(view.controls.enableDamping).toBe(true);
		expect(controller.ownership.getClaims()).toHaveLength(0);
	});

	it('flushes residual input before setting the view and restores control settings', () => {
		const { consumer, view } = setup();
		view.controls.autoRotate = true;
		view.controls.update = vi.fn().mockImplementationOnce(() => {
			expect(view.controls.enableDamping).toBe(false);
			expect(view.controls.autoRotate).toBe(false);
			view.camera.position.x += 10;
		});
		expect(consumer.set3D(next)).toEqual({ status: 'completed', view: next });
		expect(view.controls.autoRotate).toBe(true);
		expect(view.controls.enableDamping).toBe(true);
	});

	it.each(['first-person', 'game-camera', 'cutscene', 'position-lock'])('rejects %s without changing its mode or taking ownership', (mode) => {
		const { consumer, view, controller } = setup();
		if (mode === 'first-person') view.firstPersonMode = true;
		if (mode === 'game-camera') view.GameCamera.enabled = true;
		if (mode === 'cutscene') view.cutsceneEngine.isPlaying = true;
		if (mode === 'position-lock') view._toggleCameraLockPosition = vector(0, 0, 1);
		expect(consumer.set3D(next)).toEqual({ status: 'rejected', reason: 'unsupported-mode' });
		expect(view.stopCameraAnimation).not.toHaveBeenCalled();
		expect(view.controls.update).not.toHaveBeenCalled();
		expect(controller.ownership.getClaims()).toHaveLength(0);
	});

	it.each([null, {}, { position: { x: NaN, y: 0, z: 1 }, target: next.target }, { position: next.target, target: next.target }, { position: { x: Number.MAX_VALUE, y: 0, z: 0 }, target: next.target }])('rejects invalid input %j before preempting an owner', (invalid) => {
		const { consumer, controller, view } = setup();
		const owner = consumer.acquire();
		expect(owner.ok).toBe(true);
		const higher = controller.register({ id: 'high', name: 'High', priority: 1 });
		expect(higher.set3D(invalid as CameraView3D)).toEqual({ status: 'rejected', reason: 'invalid-input' });
		expect(owner.ok && owner.claim.active).toBe(true);
		expect(view.controls.update).not.toHaveBeenCalled();
	});

	it('shares priority, stale-claim and panic handling with 2D ownership', () => {
		const { consumer, controller } = setup();
		const owner = consumer.acquire();
		if (!owner.ok) throw new Error('Expected claim');
		const equal = controller.register({ id: 'equal', name: 'Equal' });
		expect(equal.set3D(next)).toEqual({ status: 'rejected', reason: 'busy' });
		const higher = controller.register({ id: 'high', name: 'High', priority: 1 });
		expect(higher.set3D(next).status).toBe('completed');
		expect(owner.claim.set3D(next)).toEqual({ status: 'rejected', reason: 'inactive-claim' });
		controller.panic();
		expect(higher.set3D(next)).toEqual({ status: 'rejected', reason: 'disabled' });
	});

	it('restores settings and releases ownership after an adapter error', () => {
		const { consumer, controller, view } = setup();
		view.controls.update = () => {
			throw new Error('Renderer stopped');
		};
		expect(consumer.set3D(next)).toEqual({ status: 'failed', reason: 'adapter-error' });
		expect(view.controls.enableDamping).toBe(true);
		expect(controller.ownership.getClaims()).toHaveLength(0);
	});

	it('does not write requested vectors after reentrant panic', () => {
		const { consumer, controller, view } = setup();
		view.controls.update = () => controller.panic();
		expect(consumer.set3D(next)).toEqual({ status: 'rejected', reason: 'inactive-claim' });
		expect(view.camera.position.x).toBe(0);
		expect(view.controls.enableDamping).toBe(true);
	});

	it('rejects inactive and unready scenes, including existing sessions', () => {
		const { consumer, camera, view } = setup();
		const owner = consumer.acquire();
		if (!owner.ok) throw new Error('Expected claim');
		view._ready = false;
		expect(camera.read()).toBeUndefined();
		expect(owner.claim.set3D(next)).toEqual({ status: 'rejected', reason: 'unavailable' });
		view._ready = true;
		view._active = false;
		expect(consumer.set3D(next)).toEqual({ status: 'rejected', reason: 'unavailable' });
	});
});
