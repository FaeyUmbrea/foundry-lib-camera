import type { CameraAdapter } from './movement.js';
import { expect, it, vi } from 'vitest';
import { CameraController } from './controller.js';

/** Build a camera with a fixed scene-fit result and observable viewport writes. */
function setup() {
	const view = { x: 0, y: 0, scale: 1 };
	const pan = vi.fn(next => Object.assign(view, next));
	const adapter: CameraAdapter = { read: () => view, pan, animate: async () => true, lockInput: () => () => {}, frameScene: () => ({ x: 1000, y: 500, scale: 0.5 }) };
	return { controller: new CameraController(adapter, () => 'user'), adapter, pan };
}

it('fits the scene through normal movement and releases ownership afterwards', async () => {
	const { controller, pan } = setup();
	controller.register({ id: 'test', name: 'Test' });
	expect(await controller.fitScene('test', { duration: 0 })).toMatchObject({ status: 'completed', position: { x: 1000, y: 500, scale: 0.5 } });
	expect(pan).toHaveBeenCalledOnce();
	expect(controller.register({ id: 'other', name: 'Other' }).acquire().ok).toBe(true);
});

it('rejects missing consumers and unavailable scenes without moving', async () => {
	const { controller, adapter, pan } = setup();
	expect(await controller.fitScene('missing')).toEqual({ status: 'rejected', reason: 'unregistered' });
	controller.register({ id: 'test', name: 'Test' });
	adapter.frameScene = () => undefined;
	expect(await controller.fitScene('test')).toEqual({ status: 'rejected', reason: 'unavailable' });
	expect(pan).not.toHaveBeenCalled();
});

it('respects higher-priority ownership and cancelled requests', async () => {
	const { controller, pan } = setup();
	controller.register({ id: 'test', name: 'Test' });
	const high = controller.register({ id: 'high', name: 'High', priority: 1 }).acquire();
	expect(high.ok).toBe(true);
	expect(await controller.fitScene('test', { duration: 0 })).toMatchObject({ status: 'rejected' });
	if (high.ok) high.claim.release();
	expect(await controller.fitScene('test', { duration: 0 }, AbortSignal.abort())).toEqual({ status: 'cancelled', reason: 'cancelled' });
	expect(pan).not.toHaveBeenCalled();
});
