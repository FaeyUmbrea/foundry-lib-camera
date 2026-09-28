import type { CameraController } from './controller.js';
import type { PriorityOverride } from './ownership.js';

declare global {
	interface SettingConfig {
		'lib-camera.priorities': Record<string, number>;
		'lib-camera.localPriorities': Record<string, number>;
		'lib-camera.disabled': boolean;
		'lib-camera.worldDisabled': boolean;
	}
}

const moduleId = 'lib-camera';

export function getSettings() {
	if (!game.settings) throw new Error('Foundry settings are not initialized');
	return game.settings;
}

export function readPriorities(value: unknown, userId?: string): PriorityOverride[] {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid camera priorities');
	return Object.entries(value).map(([consumerId, priority]) => {
		if (!consumerId.trim() || !Number.isSafeInteger(priority)) throw new TypeError('Camera priorities must be integers');
		return { consumerId, priority: priority as number, ...(userId ? { userId } : {}) };
	});
}

export function registerSettings(controller: CameraController): () => void {
	const applyPriorities = () => {
		const userId = game.user?.id;
		if (!userId) return;
		controller.ownership.setPriorities([
			...readPriorities(getSettings().get(moduleId, 'priorities')),
			...readPriorities(getSettings().get(moduleId, 'localPriorities'), userId),
		]);
	};
	const applyLocal = () => {
		const userId = game.user?.id;
		if (!userId) return;
		if (getSettings().get(moduleId, 'disabled')) controller.ownership.panic(userId);
		else controller.ownership.resume(userId);
	};
	const applyWorld = () => {
		if (getSettings().get(moduleId, 'worldDisabled')) controller.panic();
		else controller.resume();
	};
	for (const [key, scope] of [['priorities', 'world'], ['localPriorities', 'client']] as const) {
		getSettings().register(moduleId, key, { scope, config: false, type: Object, default: {}, onChange: applyPriorities });
	}
	getSettings().register(moduleId, 'disabled', { scope: 'client', config: false, type: Boolean, default: false, onChange: applyLocal });
	getSettings().register(moduleId, 'worldDisabled', { scope: 'world', config: false, type: Boolean, default: false, onChange: applyWorld });
	return () => {
		applyLocal();
		applyWorld();
		applyPriorities();
	};
}

/** Stop immediately; persistence must never delay a user's escape from camera control. */
export async function panicLocal(controller: CameraController): Promise<void> {
	const userId = game.user?.id;
	if (userId) controller.ownership.panic(userId);
	else controller.panic();
	await getSettings().set(moduleId, 'disabled', true);
}
