import type { Canvas3D } from './camera-3d.js';

declare module 'fvtt-types/configuration' {
	namespace Hooks {
		interface HookConfig {
			'3DCanvasToggleMode': (active: boolean) => void;
			'3DCanvasSceneReady': (preview: Canvas3D) => void;
		}
	}
}
