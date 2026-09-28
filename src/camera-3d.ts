import type { CameraClaim, RejectionReason } from './ownership.js';

/** Native 3D Canvas units: X/Z span the scene; Y is elevation. */
export interface Vector3D { x: number; y: number; z: number }
export interface CameraView3D {
	position: Readonly<Vector3D>;
	target: Readonly<Vector3D>;
}
export type CameraResult3D
	= | { status: 'completed'; view: Readonly<CameraView3D> }
		| { status: 'rejected'; reason: RejectionReason | 'invalid-input' | 'inactive-claim' | 'unavailable' | 'unsupported-mode' }
		| { status: 'failed'; reason: 'adapter-error' };

interface MutableVector extends Vector3D { set: (x: number, y: number, z: number) => unknown }
/** Shared exposed surface of 3D Canvas 8 (Foundry 13) and 9 (Foundry 14). */
export interface Canvas3D {
	_active: boolean;
	_ready: boolean;
	firstPersonMode: boolean;
	_toggleCameraLockPosition?: unknown;
	GameCamera: { enabled: boolean };
	cutsceneEngine: { isPlaying: boolean };
	camera: { position: MutableVector };
	controls: {
		target: MutableVector;
		enableDamping: boolean;
		autoRotate: boolean;
		update: () => unknown;
	};
	stopCameraAnimation: () => void;
}

function validVector(value: unknown): value is Vector3D {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	return ['x', 'y', 'z'].every(key => typeof Reflect.get(value, key) === 'number' && Number.isFinite(Reflect.get(value, key)));
}

export function validView3D(view: CameraView3D): boolean {
	if (!view || !validVector(view.position) || !validVector(view.target)) return false;
	// Orbit controls cannot represent a viewing direction with zero length.
	const distanceSquared = (view.position.x - view.target.x) ** 2 + (view.position.y - view.target.y) ** 2 + (view.position.z - view.target.z) ** 2;
	return Number.isFinite(distanceSquared) && distanceSquared > 0;
}

function snapshot(view: Canvas3D): Readonly<CameraView3D> {
	const copy = ({ x, y, z }: Vector3D) => Object.freeze({ x, y, z });
	return Object.freeze({ position: copy(view.camera.position), target: copy(view.controls.target) });
}

export class Camera3D {
	constructor(readonly getCanvas: () => Canvas3D | undefined) {}

	read(): Readonly<CameraView3D> | undefined {
		const view = this.getCanvas();
		if (!view?._active || !view._ready || !validVector(view.camera?.position) || !validVector(view.controls?.target)) return;
		return snapshot(view);
	}

	availability(): 'unavailable' | 'unsupported-mode' | undefined {
		const view = this.getCanvas();
		if (!this.read() || !view || typeof view.camera.position.set !== 'function'
			|| typeof view.controls.target.set !== 'function' || typeof view.controls.update !== 'function'
			|| typeof view.stopCameraAnimation !== 'function'
			|| typeof view.firstPersonMode !== 'boolean' || typeof view.GameCamera?.enabled !== 'boolean'
			|| typeof view.cutsceneEngine?.isPlaying !== 'boolean'
			|| typeof view.controls.enableDamping !== 'boolean' || typeof view.controls.autoRotate !== 'boolean') {
			return 'unavailable';
		}
		if (view.firstPersonMode || view.GameCamera.enabled || view.cutsceneEngine.isPlaying || view._toggleCameraLockPosition) return 'unsupported-mode';
	}

	/**
	 * Immediate write through native orbit controls, which may constrain the result.
	 * Free-camera collision handling can later reproject the target along the viewing ray.
	 * Preserves camera mode and control settings; does not hold the view against manual input.
	 */
	set(claim: CameraClaim, next: CameraView3D): CameraResult3D {
		if (!validView3D(next)) return { status: 'rejected', reason: 'invalid-input' };
		if (!claim.active) return { status: 'rejected', reason: 'inactive-claim' };
		const reason = this.availability();
		if (reason) return { status: 'rejected', reason };
		const view = this.getCanvas();
		if (!view) return { status: 'rejected', reason: 'unavailable' };
		const controls = view.controls;
		const damping = controls.enableDamping;
		const autoRotate = controls.autoRotate;
		try {
			view.stopCameraAnimation();
			controls.enableDamping = false;
			controls.autoRotate = false;
			// Consume pending orbit input before assigning the requested vectors.
			controls.update();
			if (!claim.active) return { status: 'rejected', reason: 'inactive-claim' };
			const currentReason = this.availability();
			if (currentReason || this.getCanvas() !== view) return { status: 'rejected', reason: currentReason ?? 'unavailable' };
			view.camera.position.set(next.position.x, next.position.y, next.position.z);
			controls.target.set(next.target.x, next.target.y, next.target.z);
			controls.update();
			if (!claim.active) return { status: 'rejected', reason: 'inactive-claim' };
			const actual = this.read();
			if (!actual) return { status: 'rejected', reason: 'unavailable' };
			return { status: 'completed', view: actual };
		} catch {
			return { status: 'failed', reason: 'adapter-error' };
		} finally {
			controls.enableDamping = damping;
			controls.autoRotate = autoRotate;
		}
	}
}
