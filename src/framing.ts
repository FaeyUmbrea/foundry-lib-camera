import type { CameraPosition } from './movement.js';

export interface CameraBounds { x: number; y: number; width: number; height: number }
export interface FrameOptions {
	/** Margin on each side, expressed in grid tiles. */
	margin?: number;
	/** Minimum and maximum number of horizontal grid tiles visible. */
	closest?: number;
	widest?: number;
}
export interface ViewDimensions { width: number; height: number; gridSize: number }

/** Shared with OBS Utils: more visible tiles means a smaller scale. */
export function tilesToScale(tiles: number, screenWidth: number, gridSize: number): number {
	if (![tiles, screenWidth, gridSize].every(value => Number.isFinite(value) && value > 0)) throw new RangeError('Tile count, screen width and grid size must be positive');
	return screenWidth / (tiles * gridSize);
}

export function validBounds(bounds: CameraBounds): boolean {
	return !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height, bounds.x + bounds.width, bounds.y + bounds.height].every(Number.isFinite)
		&& bounds.width > 0 && bounds.height > 0;
}

/** OBS Utils framing, with explicit inputs instead of world settings. */
export function frameBounds(bounds: readonly CameraBounds[], screen: ViewDimensions, options: FrameOptions = {}): CameraPosition | undefined {
	if (!bounds.length || !bounds.every(validBounds) || ![screen.width, screen.height, screen.gridSize].every(value => Number.isFinite(value) && value > 0)) return;
	if (options.margin !== undefined && (!Number.isFinite(options.margin) || options.margin < 0)) return;
	if ([options.closest, options.widest].some(value => value !== undefined && (!Number.isFinite(value) || value <= 0))) return;
	const minX = Math.min(...bounds.map(b => b.x));
	const minY = Math.min(...bounds.map(b => b.y));
	const maxX = Math.max(...bounds.map(b => b.x + b.width));
	const maxY = Math.max(...bounds.map(b => b.y + b.height));
	const margin = (options.margin ?? 0) * screen.gridSize * 2;
	let scale = Math.min(screen.width / (maxX - minX + margin), screen.height / (maxY - minY + margin));
	if (options.closest !== undefined) scale = Math.min(scale, tilesToScale(options.closest, screen.width, screen.gridSize));
	if (options.widest !== undefined) scale = Math.max(scale, tilesToScale(Math.max(options.widest, options.closest ?? 0), screen.width, screen.gridSize));
	const result = { x: minX + (maxX - minX) / 2, y: minY + (maxY - minY) / 2, scale };
	return Object.values(result).every(Number.isFinite) && scale > 0 ? result : undefined;
}

/** Keep the viewport inside a rectangle, increasing scale when necessary (OBS Utils). */
export function clampView(position: CameraPosition, bounds: CameraBounds, screen: ViewDimensions): CameraPosition {
	const scale = Math.max(position.scale, screen.width / bounds.width, screen.height / bounds.height);
	const halfX = screen.width / scale / 2;
	const halfY = screen.height / scale / 2;
	return {
		x: Math.min(bounds.x + bounds.width - halfX, Math.max(bounds.x + halfX, position.x)),
		y: Math.min(bounds.y + bounds.height - halfY, Math.max(bounds.y + halfY, position.y)),
		scale,
	};
}
