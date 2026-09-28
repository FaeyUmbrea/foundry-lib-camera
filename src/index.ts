import type { ModuleApi } from './api.js';
import type { Canvas3D } from './camera-3d.js';
import type { WrapperRegistry } from './input-lock.js';
import { Camera3D } from './camera-3d.js';
import { createControlPanel } from './control-panel.js';
import { CameraController } from './controller.js';
import { FoundryCamera } from './foundry-camera.js';
import { InputLock } from './input-lock.js';
import { RemoteCamera } from './remote.js';
import { getSettings, panicLocal, registerSettings } from './settings.js';
import './styles/main.styl';

const MODULE_ID = 'lib-camera';
const input = new InputLock();
const get3D = (): Canvas3D | undefined => (game as typeof game & { Levels3DPreview?: Canvas3D }).Levels3DPreview;
const camera3D = new Camera3D(get3D);
const camera = new FoundryCamera(
	() => get3D()?._active ? undefined : canvas,
	() => foundry.canvas.animation.CanvasAnimation,
	input,
);
const controller = new CameraController(camera, () => game.user?.id, camera3D);
const remote = new RemoteCamera(controller, {
	userId: () => game.user?.id,
	users: () => game.users?.contents.map(user => ({ id: user.id, isGM: user.isGM, active: user.active })) ?? [],
	sceneId: () => canvas?.scene?.id,
	read: camera.read.bind(camera),
	emit: (packet, recipients) => {
		if (!game.socket) throw new Error('Foundry socket is unavailable');
		game.socket.emit('module.lib-camera', packet, { recipients });
	},
});
const ControlPanel = createControlPanel(controller, input);
let panel: InstanceType<typeof ControlPanel> | undefined;

export const api: ModuleApi = Object.freeze({
	id: MODULE_ID,
	apiMajor: 1,
	moveRemote: remote.move.bind(remote),
	set3DRemote: remote.set3D.bind(remote),
	observeUser: remote.watch.bind(remote),
	followUser: remote.followUser.bind(remote),
	frame: camera.frame.bind(camera),
	frameTokens: camera.frameTokens.bind(camera),
	sceneBounds: camera.sceneBounds.bind(camera),
	register: controller.register.bind(controller),
	read: camera.read.bind(camera),
	read3D: camera3D.read.bind(camera3D),
	tokenPosition: camera.tokenPosition.bind(camera),
	gridPosition: camera.gridPosition.bind(camera),
	panic: () => panicLocal(controller),
	openControls: () => {
		panel ??= new ControlPanel();
		void panel.render({ force: true });
	},
});

Hooks.once('init', () => {
	const applySettings = registerSettings(controller);
	Hooks.once('ready', applySettings);
	getSettings().registerMenu(MODULE_ID, 'controls', {
		name: 'LIBCAMERA.Controls.Title',
		label: 'LIBCAMERA.Controls.Open',
		hint: 'LIBCAMERA.Controls.Intro',
		icon: 'fa-solid fa-camera',
		type: ControlPanel,
		restricted: false,
	});
	game.keybindings?.register(MODULE_ID, 'panic', {
		name: 'LIBCAMERA.Controls.Panic',
		hint: 'LIBCAMERA.Controls.PanicHint',
		editable: [{ key: 'Escape', modifiers: [foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS.CONTROL, foundry.helpers.interaction.KeyboardManager.MODIFIER_KEYS.SHIFT] }],
		onDown: () => {
			void api.panic().catch(() => ui.notifications?.error('Unable to save camera opt-out. Camera control is stopped for this session.'));
			return true;
		},
	});
	const module = game.modules?.get(MODULE_ID);
	if (module) (module as typeof module & { api: ModuleApi }).api = api;
});

Hooks.once('ready', () => {
	game.socket?.on('module.lib-camera', (packet: unknown, sender: unknown) => {
		void remote.receive(packet, sender).catch(error => console.error('libCamera: remote request failed', error));
	});
	const registry = (globalThis as typeof globalThis & { libWrapper?: WrapperRegistry }).libWrapper;
	if (!registry) return;
	try {
		input.install(registry);
		// Foundry terminates animations before emitting canvasTearDown.
		registry.register(MODULE_ID, 'foundry.canvas.Canvas.prototype.tearDown', (wrapped, ...args) => {
			if (!camera.isLevelTransition) controller.reset();
			return wrapped(...args);
		}, 'WRAPPER');
	} catch (error) {
		console.error('libCamera: camera input locks are unavailable', error);
	}
});

Hooks.on('canvasTearDown', () => {
	if (!camera.isLevelTransition) controller.reset();
});

// The toggle hook runs before 3D Canvas changes mode. End claims before either view changes.
Hooks.on('3DCanvasToggleMode', () => controller.reset());
Hooks.on('3DCanvasSceneReady', () => controller.reset());

Hooks.on('canvasPan', () => remote.publish());
let viewedScene: string | undefined;
Hooks.on('canvasReady', () => {
	const sceneId = canvas?.scene?.id;
	if (viewedScene && sceneId !== viewedScene) controller.reset();
	viewedScene = sceneId;
	remote.publish();
});
