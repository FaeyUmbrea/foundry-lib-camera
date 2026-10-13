import { describe, expect, it, vi } from 'vitest';
import { FoundryCamera } from './foundry-camera.js';
import { InputLock } from './input-lock.js';

describe('foundry camera adapter', () => {
	it('does not reuse live vectors, and delegates grid geometry to Foundry', () => {
		const pivot = { x: 10, y: 20 };
		const grid = { getCenterPoint: vi.fn(() => ({ x: 100, y: 200 })) };
		const adapter = new FoundryCamera(() => ({ ready: true, stage: { pivot, scale: { x: 2 } }, pan: vi.fn(), grid }), () => {
			throw new Error('Unexpected animation');
		}, new InputLock());
		const snapshot = adapter.read();
		pivot.x = 50;
		expect(snapshot).toEqual({ x: 10, y: 20, scale: 2 });
		expect(Object.isFrozen(snapshot)).toBe(true);
		expect(adapter.gridPosition(2, 3)).toEqual({ x: 100, y: 200 });
		expect(grid.getCenterPoint).toHaveBeenCalledWith({ i: 2, j: 3 });
		expect(adapter.gridPosition(0.5, 1)).toBeUndefined();
	});

	it('guards late animation ticks and cancels an abort during the first synchronous tick', async () => {
		const abort = new AbortController();
		const pan = vi.fn(() => abort.abort());
		let tick: (() => void) | undefined;
		let finish: ((completed: boolean) => void) | undefined;
		const terminateAnimation = vi.fn(() => finish?.(false));
		const adapter = new FoundryCamera(() => ({ ready: true, stage: { pivot: { x: 0, y: 0 }, scale: { x: 1 } }, pan }), () => ({
			animate: (_attributes, options) => {
				tick = options.ontick;
				tick();
				return new Promise<boolean>((resolve) => {
					finish = resolve;
				});
			},
			terminateAnimation,
			easeInOutCosine: progress => progress,
		}), new InputLock());
		expect(await adapter.animate({ x: 10, y: 20, scale: 1 }, { duration: 10, easing: 'cosine' }, abort.signal)).toBe(false);
		tick?.();
		expect(pan).toHaveBeenCalledOnce();
		expect(terminateAnimation).toHaveBeenCalled();
	});
});

it('frames an unrendered floor token using its document geometry and visibility', () => {
	const document = { x: 800, y: 900, visible: true, getSize: () => ({ width: 100, height: 100 }) };
	const adapter = new FoundryCamera(() => ({ ready: true, screenDimensions: [1920, 1080], scene: { id: 'scene', dimensions: { width: 4000, height: 2000, size: 100 }, view: async () => {}, tokens: { get: id => id === 'upper' ? document : undefined } }, tokens: { get: id => id === 'upper' ? { x: 0, y: 0, w: 100, h: 100, center: { x: 50, y: 50 } } : undefined }, pan: vi.fn() }), () => {
		throw new Error('Unexpected animation');
	}, new InputLock());
	expect(adapter.frameTokens(['upper'])).toMatchObject({ x: 850, y: 950 });
	document.visible = false;
	expect(adapter.frameTokens(['upper'])).toBeUndefined();
	// No placeable or document can supply this token.
	expect(adapter.frameTokens(['missing'])).toBeUndefined();
});
