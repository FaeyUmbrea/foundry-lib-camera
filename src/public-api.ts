export type { ModuleApi } from './api.js';
export type { CameraResult3D, CameraView3D, Vector3D } from './camera-3d.js';
export type { CameraSession, LocalConsumer, SessionResult } from './controller.js';
export type { CameraFollow } from './follow.js';
export type { CameraBounds, FrameOptions, ViewDimensions } from './framing.js';
export type { CameraPosition, MovementResult, MoveOptions } from './movement.js';

export type {
	CameraClaim,
	CameraConsumer,
	ClaimResult,
	ClaimSnapshot,
	ConsumerOptions,
	ConsumerSnapshot,
	Diagnostic,
	PriorityOverride,
	RejectionReason,
	ReleaseReason,
} from './ownership.js';
export type { CameraCoordinator } from './ownership.js';

export type { RemoteOptions, RemoteOutcome, RemoteUserResult, ViewportSample, ViewportSubscription } from './remote.js';
export type { TrackingMode } from './viewport-filter.js';
