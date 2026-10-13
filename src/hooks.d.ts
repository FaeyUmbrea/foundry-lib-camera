import type { Camera3DStatus, Canvas3D } from './camera-3d.js';

declare module 'fvtt-types/configuration' {
	namespace Hooks {
		interface HookConfig {
			'lib-camera.3DStatusChanged': (status: Camera3DStatus) => void;
			'3DCanvasToggleMode': (active: boolean) => void;
			'3DCanvasSceneReady': (preview: Canvas3D) => void;
		}
	}
}
