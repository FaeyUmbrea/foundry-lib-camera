import { describe, expect, it } from 'vitest';
import { clampView, frameBounds, tilesToScale } from './framing.js';

describe('oBS Utils camera framing', () => {
	it('keeps tile counts independent of grid size and viewport width', () => {
		for (const grid of [50, 100, 200]) {
			for (const width of [1920, 2560]) expect(width / tilesToScale(10, width, grid) / grid).toBeCloseTo(10);
		}
		expect(tilesToScale(40, 1920, 100)).toBeLessThan(tilesToScale(10, 1920, 100));
		expect(tilesToScale(10, 1920, 100)).toBeCloseTo(1.92);
	});
	it('frames negative coordinates, per-side margins and rectangular viewports', () => {
		expect(frameBounds([{ x: -200, y: -100, width: 100, height: 50 }, { x: 100, y: 100, width: 100, height: 100 }], { width: 1000, height: 500, gridSize: 100 }, { margin: 1 })).toEqual({ x: 0, y: 50, scale: 1 });
	});
	it('rejects empty and nonfinite bounds instead of producing a false origin', () => {
		const screen = { width: 100, height: 100, gridSize: 100 };
		expect(frameBounds([], screen)).toBeUndefined();
		expect(frameBounds([{ x: NaN, y: 0, width: 10, height: 10 }], screen)).toBeUndefined();
	});
	it('clamps against offset scene rectangles and raises scale to fit', () => {
		expect(clampView({ x: -100, y: 9000, scale: 0.1 }, { x: 100, y: 200, width: 1000, height: 1000 }, { width: 1000, height: 500, gridSize: 100 })).toEqual({ x: 600, y: 950, scale: 1 });
	});
});
