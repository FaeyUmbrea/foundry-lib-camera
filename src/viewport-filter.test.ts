import { afterEach, describe, expect, it, vi } from 'vitest';
import { ViewportFilter } from './viewport-filter.js';

afterEach(() => vi.useRealTimers());
describe('viewport synchronization', () => {
	it('averages nearby pans but resets across floors, zoom jumps and scenes', () => {
		const received = vi.fn();
		const filter = new ViewportFilter('smooth', received);
		const sample = (x: number, sceneId = 'scene', level = 'ground') => ({ userId: 'user', sceneId, position: { x, y: 0, scale: 1, level } });
		filter.push(sample(10));
		filter.push(sample(20));
		expect(received.mock.lastCall?.[0].position.x).toBe(15);
		filter.push(sample(30, 'scene', 'upstairs'));
		expect(received.mock.lastCall?.[0].position.x).toBe(30);
		filter.push(sample(40, 'other'));
		expect(received.mock.lastCall?.[0].position.x).toBe(40);
		filter.push(sample(500, 'other'));
		expect(received.mock.lastCall?.[0].position.x).toBe(500);
	});
	it('emits the last drag sample and cancels pending callbacks on disposal', async () => {
		vi.useFakeTimers();
		const received = vi.fn();
		const filter = new ViewportFilter('dragRelease', received);
		const sample = { userId: 'user', sceneId: 'scene', position: { x: 10, y: 20, scale: 1 } };
		filter.push(sample);
		await vi.advanceTimersByTimeAsync(100);
		filter.push({ ...sample, position: { ...sample.position, x: 50 } });
		await vi.advanceTimersByTimeAsync(150);
		expect(received).toHaveBeenCalledOnce();
		expect(received.mock.lastCall?.[0].position.x).toBe(50);
		filter.push(sample);
		filter.dispose();
		await vi.advanceTimersByTimeAsync(150);
		expect(received).toHaveBeenCalledOnce();
	});
});
