import type { CameraBounds } from './framing.js';
import type { CameraClaim, ReleaseReason } from './ownership.js';
import { validBounds } from './framing.js';

export interface CameraPosition {
	x: number;
	y: number;
	scale: number;
	level?: string;
}

export interface MoveOptions extends Partial<CameraPosition> {
	/** Milliseconds; zero applies the view immediately. Maximum: one minute. */
	duration?: number;
	easing?: 'linear' | 'cosine' | 'easeInCircle' | 'easeOutCircle' | 'easeInOutCircle' | 'easeInCosine' | 'easeOutCosine' | 'easeInOutCosine' | 'easeOutCubic' | 'easeInOutCubic';
	/** true constrains to scene bounds; a rectangle constrains to that region. */
	bounds?: true | CameraBounds;
	/** Suppress manual camera input only for this operation. */
	lockInput?: boolean;
}

export type MovementResult
	= | { status: 'completed'; position: Readonly<CameraPosition> }
		| { status: 'cancelled'; reason: ReleaseReason | 'cancelled' | 'interrupted' | 'retargeted' }
		| { status: 'rejected'; reason: 'invalid-input' | 'inactive-claim' | 'busy' | 'unavailable' }
		| { status: 'failed'; reason: 'adapter-error' };

/** Boundary to Foundry. Adapters must stop writing synchronously when aborted. */
export interface CameraAdapter {
	read: () => Readonly<CameraPosition> | undefined;
	pan: (position: CameraPosition) => void;
	animate: (position: CameraPosition, options: Required<Pick<MoveOptions, 'duration' | 'easing'>>, signal: AbortSignal) => Promise<boolean>;
	lockInput: () => () => void;
	prepare?: (options: MoveOptions, signal: AbortSignal) => Promise<boolean>;
	constrain?: (position: CameraPosition, bounds: NonNullable<MoveOptions['bounds']>) => CameraPosition;
}

export function validMove(options: MoveOptions): boolean {
	if (!options || typeof options !== 'object' || Array.isArray(options)) return false;
	if (!['x', 'y', 'scale', 'level'].some(key => options[key as keyof CameraPosition] !== undefined)) return false;
	if (['x', 'y', 'scale'].some((key) => {
		const value = options[key as keyof CameraPosition];
		return value !== undefined && (typeof value !== 'number' || !Number.isFinite(value));
	})) {
		return false;
	}
	if (options.scale !== undefined && options.scale <= 0) return false;
	if (options.duration !== undefined && (!Number.isFinite(options.duration) || options.duration < 0 || options.duration > 60000)) return false;
	if (options.easing !== undefined && !['linear', 'cosine', 'easeInCircle', 'easeOutCircle', 'easeInOutCircle', 'easeInCosine', 'easeOutCosine', 'easeInOutCosine', 'easeOutCubic', 'easeInOutCubic'].includes(options.easing)) return false;
	if (options.level !== undefined && (typeof options.level !== 'string' || !options.level.trim())) return false;
	if (options.bounds !== undefined && options.bounds !== true && !validBounds(options.bounds)) return false;
	return options.lockInput === undefined || typeof options.lockInput === 'boolean';
}

/** One operation per claim. Cancellation never releases a caller's longer-lived claim. */
export class CameraMovement {
	#running = new WeakSet<CameraClaim>();
	constructor(readonly adapter: CameraAdapter) {}

	async move(claim: CameraClaim, options: MoveOptions, signal?: AbortSignal): Promise<MovementResult> {
		if (!validMove(options)) return { status: 'rejected', reason: 'invalid-input' };
		if (!claim.active) return { status: 'rejected', reason: 'inactive-claim' };
		if (this.#running.has(claim)) return { status: 'rejected', reason: 'busy' };
		if (signal?.aborted) return { status: 'cancelled', reason: 'cancelled' };
		this.#running.add(claim);
		const controller = new AbortController();
		let unlock: (() => void) | undefined;
		const restoreInput = () => {
			const release = unlock;
			unlock = undefined;
			release?.();
		};
		const cancelClaim = () => {
			controller.abort(claim.signal.reason);
			restoreInput();
		};
		const cancelOperation = () => {
			controller.abort('cancelled');
			restoreInput();
		};
		claim.signal.addEventListener('abort', cancelClaim, { once: true });
		signal?.addEventListener('abort', cancelOperation, { once: true });
		try {
			if (options.level && !this.adapter.prepare) return { status: 'rejected', reason: 'unavailable' };
			if (options.level && this.adapter.prepare && !await this.adapter.prepare(options, controller.signal)) {
				if (controller.signal.aborted) return { status: 'cancelled', reason: controller.signal.reason };
				return { status: 'rejected', reason: 'unavailable' };
			}
			if (controller.signal.aborted) return { status: 'cancelled', reason: controller.signal.reason };
			const current = this.adapter.read();
			if (!current) return { status: 'rejected', reason: 'unavailable' };
			let position: CameraPosition = { x: options.x ?? current.x, y: options.y ?? current.y, scale: options.scale ?? current.scale };
			if (options.bounds) {
				if (!this.adapter.constrain) return { status: 'rejected', reason: 'unavailable' };
				position = this.adapter.constrain(position, options.bounds);
			}
			if (options.lockInput) unlock = this.adapter.lockInput();
			if (controller.signal.aborted) return { status: 'cancelled', reason: controller.signal.reason };
			let completed = true;
			if (options.duration) {
				completed = await this.adapter.animate(position, { duration: options.duration, easing: options.easing ?? 'cosine' }, controller.signal);
			} else {
				this.adapter.pan(position);
			}
			if (controller.signal.aborted) return { status: 'cancelled', reason: controller.signal.reason };
			if (!completed) return { status: 'cancelled', reason: 'interrupted' };
			const actual = this.adapter.read();
			if (!actual) return { status: 'rejected', reason: 'unavailable' };
			return { status: 'completed', position: Object.freeze({ ...actual }) };
		} catch {
			return { status: 'failed', reason: 'adapter-error' };
		} finally {
			claim.signal.removeEventListener('abort', cancelClaim);
			signal?.removeEventListener('abort', cancelOperation);
			restoreInput();
			this.#running.delete(claim);
		}
	}
}
