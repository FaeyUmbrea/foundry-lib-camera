import type { CameraView3D } from './camera-3d.js';
import type { LocalConsumer } from './controller.js';
import type { CameraBounds, FrameOptions } from './framing.js';
import type { CameraPosition } from './movement.js';
import type { ConsumerOptions } from './ownership.js';
import type { RemoteCamera } from './remote.js';

export interface ModuleApi {
	readonly id: 'lib-camera';
	readonly apiMajor: 1;
	moveRemote: RemoteCamera['move'];
	set3DRemote: RemoteCamera['set3D'];
	observeUser: RemoteCamera['watch'];
	followUser: RemoteCamera['followUser'];
	/** Compute views without taking ownership or moving the camera. */
	frame: (bounds: readonly CameraBounds[], options?: FrameOptions) => CameraPosition | undefined;
	frameTokens: (tokenIds: readonly string[], options?: FrameOptions) => CameraPosition | undefined;
	sceneBounds: () => CameraBounds | undefined;
	/** Registration is available at init; movement requires a ready canvas. */
	register: (options: ConsumerOptions) => LocalConsumer;
	read: () => Readonly<CameraPosition> | undefined;
	/** Native 3D position and look-at target; absent unless 3D Canvas is active and ready. */
	read3D: () => Readonly<CameraView3D> | undefined;
	tokenPosition: (tokenId: string) => Readonly<{ x: number; y: number }> | undefined;
	gridPosition: (row: number, column: number) => Readonly<{ x: number; y: number }> | undefined;
	/** Stop this client immediately and persist its opt-out. */
	panic: () => Promise<void>;
	openControls: () => void;
}
