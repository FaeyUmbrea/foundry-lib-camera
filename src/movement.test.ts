import type { CameraAdapter, CameraPosition } from './movement.js';
import { describe, expect, it, vi } from 'vitest';
import { CameraController } from './controller.js';

function setup() {
	let position: CameraPosition = { x: 100, y: 200, scale: 1 };
	const unlock = vi.fn();
	const adapter: CameraAdapter = {
		read: vi.fn(() => ({ ...position })),
		pan: vi.fn((next) => { position = { ...next }; }),
		animate: vi.fn(async (next) => {
			position = { ...next };
			return true;
		}),
		lockInput: vi.fn(() => unlock),
	};
	const controller = new CameraController(adapter, () => 'user');
	const consumer = controller.register({ id: 'obs-utils', name: 'OBS Utils' });
	return { adapter, controller, consumer, unlock };
}

describe('camera movement', () => {
	it('starts ordinary input locks synchronously without awaiting floor preparation', async () => {
		const { adapter, consumer } = setup();
		adapter.prepare = vi.fn(async () => true);
		const movement = consumer.move({ x: 300, lockInput: true });
		expect(adapter.lockInput).toHaveBeenCalledOnce();
		expect(adapter.prepare).not.toHaveBeenCalled();
		expect((await movement).status).toBe('completed');
	});

	it('merges partial views, reports the actual view, and releases temporary claims', async () => {
		const { consumer, controller, unlock } = setup();
		expect(await consumer.move({ x: 300, lockInput: true })).toEqual({ status: 'completed', position: { x: 300, y: 200, scale: 1 } });
		expect(unlock).toHaveBeenCalledOnce();
		expect(controller.ownership.getClaims()).toEqual([]);
	});

	it.each([{ x: NaN }, { scale: 0 }, { y: Infinity }, { x: 1, duration: -1 }, { x: 1, duration: 60001 }, {}])('rejects invalid movement %j without touching the adapter', async (options) => {
		const { consumer, adapter } = setup();
		expect(await consumer.move(options)).toMatchObject({ status: 'rejected', reason: 'invalid-input' });
		expect(adapter.pan).not.toHaveBeenCalled();
		expect(adapter.animate).not.toHaveBeenCalled();
		expect(adapter.lockInput).not.toHaveBeenCalled();
	});

	it.each(['panic', 'reset'] as const)('restores input synchronously on %s and reports why movement stopped', async (action) => {
		const { consumer, adapter, controller, unlock } = setup();
		adapter.animate = vi.fn<CameraAdapter['animate']>((_next, _options, signal) => new Promise<boolean>(resolve => signal.addEventListener('abort', () => resolve(false))));
		const moving = consumer.move({ x: 500, duration: 100, lockInput: true });
		controller[action]();
		expect(unlock).toHaveBeenCalledOnce();
		expect(await moving).toEqual({ status: 'cancelled', reason: action === 'panic' ? 'panic' : 'canvas-teardown' });
		expect(unlock).toHaveBeenCalledOnce();
	});

	it('preemption restores the old lock before the new owner takes control', async () => {
		const { consumer, adapter, controller, unlock } = setup();
		adapter.animate = (_next, _options, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(false)));
		const moving = consumer.move({ x: 500, duration: 100, lockInput: true });
		const higher = controller.register({ id: 'higher', name: 'Higher', priority: 1 });
		const next = higher.acquire();
		expect(next.ok).toBe(true);
		expect(unlock).toHaveBeenCalledOnce();
		expect(await moving).toEqual({ status: 'cancelled', reason: 'superseded' });
		if (next.ok) expect(next.claim.active).toBe(true);
	});

	it('keeps explicit claims through completion and cancellation; rejects overlapping moves', async () => {
		const { consumer, adapter } = setup();
		adapter.animate = (_next, _options, signal) => new Promise(resolve => signal.addEventListener('abort', () => resolve(false)));
		const result = consumer.acquire();
		if (!result.ok) throw new Error(result.reason);
		const abort = new AbortController();
		const moving = result.claim.move({ x: 1, duration: 10 }, abort.signal);
		expect(await result.claim.move({ y: 2 })).toEqual({ status: 'rejected', reason: 'busy' });
		abort.abort();
		expect(await moving).toEqual({ status: 'cancelled', reason: 'cancelled' });
		expect(result.claim.active).toBe(true);
		expect(await result.claim.move({ x: 5 })).toMatchObject({ status: 'completed' });
		result.claim.release();
		expect(await result.claim.move({ x: 6 })).toEqual({ status: 'rejected', reason: 'inactive-claim' });
	});

	it('releases input and ownership after an adapter error', async () => {
		const { consumer, adapter, unlock, controller } = setup();
		adapter.animate = async () => {
			throw new Error('Renderer failed');
		};
		expect(await consumer.move({ x: 5, duration: 10, lockInput: true })).toEqual({ status: 'failed', reason: 'adapter-error' });
		expect(unlock).toHaveBeenCalledOnce();
		expect(controller.ownership.getClaims()).toEqual([]);
	});

	it('rejects an unavailable canvas and honours an already cancelled operation', async () => {
		const { consumer, adapter } = setup();
		expect(await consumer.move({ x: 5 }, AbortSignal.abort())).toEqual({ status: 'cancelled', reason: 'cancelled' });
		expect(adapter.pan).not.toHaveBeenCalled();
		adapter.read = () => undefined;
		expect(consumer.acquire()).toEqual({ ok: false, reason: 'unavailable' });
	});
});
