import type { CameraBounds, FrameOptions, ViewDimensions } from './framing.js';
import type { InputLock } from './input-lock.js';
import type { CameraAdapter, CameraPosition, MoveOptions } from './movement.js';
import { clampView, frameBounds } from './framing.js';

/** Narrow interface shared by the supported Foundry generations. */
interface CanvasView {
	initializing?: Promise<unknown> | null;
	level?: { id: string };
	screenDimensions?: number[];
	scene?: null | {
		id: string;
		dimensions: { width: number; height: number; size: number };
		availableLevels?: Set<{ id: string }>;
		view: (options: { level: string }) => Promise<unknown>;
	};
	ready: boolean;
	stage?: { pivot: { x: number; y: number }; scale: { x: number } };
	pan: (position: CameraPosition) => void;
	tokens?: { get: (id: string) => { center: { x: number; y: number }; x: number; y: number; w: number; h: number; visible?: boolean } | undefined };
	grid?: { getCenterPoint: (offset: { i: number; j: number }) => { x: number; y: number } } | null;
}

interface AnimationEngine {
	animate: (attributes: { parent: CameraPosition; attribute: 'x' | 'y' | 'scale'; to: number }[], options: {
		name: symbol;
		duration: number;
		easing?: (progress: number) => number;
		ontick: () => void;
	}) => Promise<boolean | void>;
	terminateAnimation: (name: symbol) => void;
	easeInOutCosine: (progress: number) => number;
	easeInCircle?: (progress: number) => number;
	easeOutCircle?: (progress: number) => number;
	easeInOutCircle?: (progress: number) => number;
	easeInCosine?: (progress: number) => number;
	easeOutCosine?: (progress: number) => number;
}

export class FoundryCamera implements CameraAdapter {
	#levelTransition = false;
	get isLevelTransition(): boolean { return this.#levelTransition; }

	/** Floor changes redraw the canvas; callers retain their claim until the redraw settles. */
	async prepare(options: MoveOptions, signal: AbortSignal): Promise<boolean> {
		const view = this.getCanvas();
		if (!view) return false;
		if (!options.level || options.level === view.level?.id) return true;
		const scene = view.scene;
		if (!scene || !view.level || ![...(scene.availableLevels ?? [])].some(level => level.id === options.level)) return false;
		await view.initializing;
		if (signal.aborted || this.getCanvas()?.scene !== scene || this.#levelTransition) return false;
		this.#levelTransition = true;
		try {
			await scene.view({ level: options.level });
			return !signal.aborted && this.getCanvas()?.scene === scene && this.getCanvas()?.level?.id === options.level;
		} finally {
			this.#levelTransition = false;
		}
	}

	dimensions(): ViewDimensions | undefined {
		const view = this.getCanvas();
		if (!view?.ready || !view.screenDimensions || !view.scene) return;
		return { width: view.screenDimensions[0], height: view.screenDimensions[1], gridSize: view.scene.dimensions.size };
	}

	sceneBounds(): CameraBounds | undefined {
		const scene = this.getCanvas()?.scene;
		return scene ? { x: 0, y: 0, width: scene.dimensions.width, height: scene.dimensions.height } : undefined;
	}

	constrain(position: CameraPosition, bounds: true | CameraBounds): CameraPosition {
		const screen = this.dimensions();
		const rectangle = bounds === true ? this.sceneBounds() : bounds;
		if (!screen || !rectangle) throw new Error('Canvas bounds are unavailable');
		return clampView(position, rectangle, screen);
	}

	frame(bounds: readonly CameraBounds[], options?: FrameOptions): CameraPosition | undefined {
		const screen = this.dimensions();
		return screen ? frameBounds(bounds, screen, options) : undefined;
	}

	frameTokens(ids: readonly string[], options?: FrameOptions): CameraPosition | undefined {
		const view = this.getCanvas();
		if (!view?.ready || !Array.isArray(ids) || ids.length > 1000) return;
		const tokens = ids.map(id => view.tokens?.get(id));
		if (tokens.some(token => !token || token.visible === false)) return;
		return this.frame(tokens.map(token => ({ x: token!.x, y: token!.y, width: token!.w, height: token!.h })), options);
	}

	constructor(
		readonly getCanvas: () => CanvasView | undefined,
		readonly getAnimation: () => AnimationEngine,
		readonly input: InputLock,
	) {}

	read(): Readonly<CameraPosition> | undefined {
		const view = this.getCanvas();
		if (!view?.ready || !view.stage) return;
		return Object.freeze({ x: view.stage.pivot.x, y: view.stage.pivot.y, scale: view.stage.scale.x, ...(view.level ? { level: view.level.id } : {}) });
	}

	pan(position: CameraPosition): void {
		const view = this.getCanvas();
		if (!view?.ready) throw new Error('Canvas is unavailable');
		view.pan(position);
	}

	async animate(target: CameraPosition, options: Required<Pick<MoveOptions, 'duration' | 'easing'>>, signal: AbortSignal): Promise<boolean> {
		const position = this.read();
		if (!position || signal.aborted) return false;
		const current = { ...position };
		const engine = this.getAnimation();
		const name = Symbol('lib-camera movement');
		const stop = () => engine.terminateAnimation(name);
		signal.addEventListener('abort', stop, { once: true });
		try {
			const animation = engine.animate((['x', 'y', 'scale'] as const).map(attribute => ({ parent: current, attribute, to: target[attribute] })), {
				name,
				duration: options.duration,
				easing: options.easing === 'linear'
					? undefined
					: options.easing === 'easeOutCubic'
						? (p: number) => 1 - (1 - p) ** 3
						: options.easing === 'easeInOutCubic'
							? (p: number) => p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2
							: options.easing === 'cosine' ? engine.easeInOutCosine : engine[options.easing] ?? engine.easeInOutCosine,
				// Foundry removes a terminated animation's ticker asynchronously.
				ontick: () => { if (!signal.aborted) this.pan(current); },
			});
			if (signal.aborted) stop();
			return await animation === true;
		} finally {
			signal.removeEventListener('abort', stop);
		}
	}

	lockInput(): () => void { return this.input.acquire(); }

	tokenPosition(tokenId: string): Readonly<{ x: number; y: number }> | undefined {
		const view = this.getCanvas();
		if (!view?.ready || !view.stage) return;
		const center = view.tokens?.get(tokenId)?.center;
		return center ? Object.freeze({ x: center.x, y: center.y }) : undefined;
	}

	gridPosition(row: number, column: number): Readonly<{ x: number; y: number }> | undefined {
		if (!Number.isSafeInteger(row) || !Number.isSafeInteger(column)) return;
		const view = this.getCanvas();
		if (!view?.ready || !view.stage) return;
		const point = view.grid?.getCenterPoint({ i: row, j: column });
		return point ? Object.freeze({ ...point }) : undefined;
	}
}
