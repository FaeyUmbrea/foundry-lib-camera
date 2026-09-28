import type { WrapperRegistry } from './input-lock.js';
import { describe, expect, it, vi } from 'vitest';
import { InputLock } from './input-lock.js';

function setup() {
	const wrappers = new Map<string, Parameters<WrapperRegistry['register']>[2]>();
	const registry: WrapperRegistry = {
		register: (_module, target, wrapper) => {
			wrappers.set(target, wrapper);
			return wrappers.size;
		},
		unregister: vi.fn(),
	};
	const input = new InputLock();
	input.install(registry);
	return { input, registry, wrappers };
}

describe('manual camera input', () => {
	it('blocks only input entry points and restores them after the last lock', () => {
		const { input, wrappers } = setup();
		const calls = [...wrappers].filter(([target]) => target.includes('Canvas.prototype'));
		const first = input.acquire();
		const second = input.acquire();
		const original = vi.fn(() => 'result');
		for (const [, wrapper] of calls) expect(wrapper(original, 'event')).toBeUndefined();
		expect(original).not.toHaveBeenCalled();
		first();
		first();
		expect(input.active).toBe(true);
		second();
		for (const [, wrapper] of calls) expect(wrapper(original, 'event')).toBe('result');
		expect(original).toHaveBeenCalledTimes(3);
		expect(original).toHaveBeenLastCalledWith('event');
	});

	it('preserves keyboard order, unrelated actions and key-up handlers', () => {
		const { input, wrappers } = setup();
		const keyboard = wrappers.get('foundry.helpers.interaction.KeyboardManager._getMatchingActions');
		if (!keyboard) throw new Error('Keyboard wrapper missing');
		const onDown = vi.fn();
		const onUp = vi.fn();
		const actions = [{ action: 'core.panUp', onDown, onUp }, { action: 'other.action', onDown, onUp }];
		const unlock = input.acquire();
		const blocked = keyboard(() => actions) as typeof actions;
		expect(blocked[0].onDown()).toBe(true);
		expect(onDown).not.toHaveBeenCalled();
		expect(blocked[0].onUp).toBe(onUp);
		expect(blocked[1]).toBe(actions[1]);
		expect(actions[0].onDown).toBe(onDown);
		unlock();
		expect(keyboard(() => actions)).toBe(actions);
	});

	it('rolls back a partial installation and refuses incomplete locks', () => {
		const input = new InputLock();
		const unregister = vi.fn();
		let count = 0;
		expect(() => input.install({
			register: () => {
				if (++count === 3) throw new Error('Missing method');
				return count;
			},
			unregister,
		})).toThrow('Missing method');
		expect(unregister.mock.calls).toEqual([['lib-camera', 1], ['lib-camera', 2]]);
		expect(input.available).toBe(false);
		expect(() => input.acquire()).toThrow('unavailable');
	});
});
