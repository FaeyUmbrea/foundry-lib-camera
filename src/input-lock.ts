type Wrapped = (...args: unknown[]) => unknown;

export interface WrapperRegistry {
	register: (moduleId: string, target: string, wrapper: (wrapped: Wrapped, ...args: unknown[]) => unknown, type: 'MIXED' | 'WRAPPER') => number;
	unregister: (moduleId: string, target: number) => void;
}

const panActions = new Set([
	'core.panUp',
	'core.panDown',
	'core.panLeft',
	'core.panRight',
	'core.panUpLeft',
	'core.panUpRight',
	'core.panDownLeft',
	'core.panDownRight',
	'core.zoomIn',
	'core.zoomOut',
]);

/** Wrap input entry points, not pan(), so ownership does not block other modules. */
export class InputLock {
	#locks = new Set<symbol>();
	#registrations: number[] = [];
	#registry?: WrapperRegistry;

	get active(): boolean { return this.#locks.size > 0; }
	get available(): boolean { return this.#registrations.length === 4; }

	install(registry: WrapperRegistry): void {
		if (this.#registry) throw new Error('Input wrappers are already installed');
		this.#registry = registry;
		try {
			for (const method of ['_onDragRightMove', '_onDragCanvasPan', '_onMouseWheel']) {
				this.#registrations.push(registry.register('lib-camera', `foundry.canvas.Canvas.prototype.${method}`, (wrapped, ...args) => {
					if (!this.active) return wrapped(...args);
				}, 'MIXED'));
			}
			this.#registrations.push(registry.register('lib-camera', 'foundry.helpers.interaction.KeyboardManager._getMatchingActions', (wrapped, ...args) => {
				const actions = wrapped(...args) as { action: string; onDown?: unknown }[];
				if (!this.active) return actions;
				// Preserve key-up processing and binding precedence, including remapped keys.
				return actions.map(action => panActions.has(action.action) ? { ...action, onDown: () => true } : action);
			}, 'WRAPPER'));
		} catch (error) {
			this.dispose();
			throw error;
		}
	}

	acquire(): () => void {
		if (!this.available) throw new Error('Camera input wrappers are unavailable');
		const lock = Symbol('camera input');
		this.#locks.add(lock);
		return () => {
			this.#locks.delete(lock);
		};
	}

	dispose(): void {
		this.#locks.clear();
		for (const target of this.#registrations) this.#registry?.unregister('lib-camera', target);
		this.#registrations = [];
		this.#registry = undefined;
	}
}
