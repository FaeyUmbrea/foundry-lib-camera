import type { CameraAdapter } from './movement.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraController } from './controller.js';

afterEach(() => vi.useRealTimers());
function setup() {
	vi.useFakeTimers();
	let view = { x: 0, y: 0, scale: 1 };
	const adapter: CameraAdapter = {
		read: () => view,
		pan: (next) => { view = next; },
		animate: (next, options, signal) => new Promise((resolve) => {
			const timer = setTimeout(() => {
				view = next;
				resolve(true);
			}, options.duration);
			signal.addEventListener('abort', () => {
				clearTimeout(timer);
				resolve(false);
			}, { once: true });
		}),
		lockInput: () => () => {},
	};
	const controller = new CameraController(adapter, () => 'user');
	const consumer = controller.register({ id: 'test', name: 'Test' });
	return { controller, consumer };
}
describe('continuous camera control', () => {
	it('retargets without an old animation writing its final position', async () => {
		const { controller, consumer } = setup();
		const acquired = consumer.acquire();
		if (!acquired.ok) throw new Error('Expected claim');
		const old = acquired.claim.move({ x: 100, duration: 1000 });
		const next = acquired.claim.retarget({ x: 200, duration: 100 });
		await vi.advanceTimersByTimeAsync(1000);
		expect((await old).status).toBe('cancelled');
		expect((await next).status).toBe('completed');
		expect(controller.read()?.x).toBe(200);
		acquired.claim.release();
	});
	it('follows changes, pauses without forgetting the source, and cleans up on panic', async () => {
		const { controller, consumer } = setup();
		let x = 50;
		const result = consumer.follow(() => ({ x }));
		if (!result.ok) throw new Error('Expected follow');
		await vi.advanceTimersByTimeAsync(33);
		expect(controller.read()?.x).toBe(50);
		result.follow.pause();
		x = 100;
		await vi.advanceTimersByTimeAsync(100);
		expect(controller.read()?.x).toBe(50);
		result.follow.resume();
		await vi.advanceTimersByTimeAsync(33);
		expect(controller.read()?.x).toBe(100);
		controller.panic();
		expect(await result.follow.done).toEqual({ status: 'cancelled', reason: 'panic' });
		expect(vi.getTimerCount()).toBe(0);
	});
});
