import { afterEach, describe, expect, it, vi } from 'vitest';
import { CameraController } from './controller.js';
import { panicLocal, readPriorities, registerSettings } from './settings.js';

afterEach(() => vi.unstubAllGlobals());

function setup() {
	const values = new Map<string, unknown>();
	const changes = new Map<string, () => void>();
	const settings = {
		register: (_module: string, key: string, config: { default: unknown; onChange: () => void }) => {
			values.set(key, config.default);
			changes.set(key, config.onChange);
		},
		get: (_module: string, key: string) => values.get(key),
		set: vi.fn(async (_module: string, key: string, value: unknown) => {
			values.set(key, value);
			changes.get(key)?.();
		}),
	};
	vi.stubGlobal('game', { user: { id: 'player' }, settings });
	const controller = new CameraController({
		read: () => ({ x: 0, y: 0, scale: 1 }),
		pan: vi.fn(),
		animate: vi.fn(),
		lockInput: vi.fn(),
	}, () => 'player');
	registerSettings(controller)();
	return { settings, controller };
}

describe('camera settings', () => {
	it('keeps a panic stop when persistence fails and unrelated settings change', async () => {
		const { settings, controller } = setup();
		settings.set.mockRejectedValueOnce(new Error('Storage failed'));
		await expect(panicLocal(controller)).rejects.toThrow('Storage failed');
		expect(controller.ownership.isDisabled('player')).toBe(true);
		await settings.set('lib-camera', 'priorities', { 'obs-utils': 5 });
		expect(controller.ownership.isDisabled('player')).toBe(true);
		await settings.set('lib-camera', 'worldDisabled', true);
		await settings.set('lib-camera', 'worldDisabled', false);
		expect(controller.ownership.isDisabled('player')).toBe(true);
		await settings.set('lib-camera', 'disabled', false);
		expect(controller.ownership.isDisabled('player')).toBe(false);
	});

	it('local resume cannot override a world-wide stop', async () => {
		const { settings, controller } = setup();
		await settings.set('lib-camera', 'worldDisabled', true);
		await settings.set('lib-camera', 'disabled', false);
		expect(controller.ownership.isDisabled('player')).toBe(true);
	});

	it('validates persisted priorities without accepting inherited properties', () => {
		expect(readPriorities({ 'obs-utils': -5 }, 'player')).toEqual([{ consumerId: 'obs-utils', userId: 'player', priority: -5 }]);
		expect(readPriorities(Object.create({ unexpected: 10 }))).toEqual([]);
		for (const invalid of [null, [], { bad: '5' }, { bad: Infinity }, { '': 1 }]) {
			expect(() => readPriorities(invalid)).toThrow(TypeError);
		}
	});
});
