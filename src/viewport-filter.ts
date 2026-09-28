import type { ViewportSample } from './remote.js';

export type TrackingMode = 'raw' | 'smooth' | 'dragRelease';

/** OBS Utils' five-sample smoothing and drag-release behavior, scoped to one subscription. */
export class ViewportFilter {
	#samples: ViewportSample[] = [];
	#timer?: ReturnType<typeof setTimeout>;
	constructor(readonly mode: TrackingMode, readonly callback: (sample: ViewportSample) => void) {}

	push(sample: ViewportSample): void {
		if (this.mode === 'dragRelease') {
			clearTimeout(this.#timer);
			this.#timer = setTimeout(() => this.callback(sample), 150);
			return;
		}
		if (this.mode === 'raw') {
			this.callback(sample);
			return;
		}
		const last = this.#samples.at(-1);
		if (last && (last.sceneId !== sample.sceneId || last.position.level !== sample.position.level
			|| Math.hypot(last.position.x - sample.position.x, last.position.y - sample.position.y) > 100
			|| Math.abs(last.position.scale - sample.position.scale) > 0.1)) {
			this.#samples = [];
		}
		this.#samples.push(sample);
		if (this.#samples.length > 5) this.#samples.shift();
		const x = this.#samples.reduce((sum, entry) => sum + entry.position.x, 0) / this.#samples.length;
		const y = this.#samples.reduce((sum, entry) => sum + entry.position.y, 0) / this.#samples.length;
		this.callback({ ...sample, position: Object.freeze({ ...sample.position, x, y }) });
	}

	dispose(): void {
		clearTimeout(this.#timer);
		this.#samples = [];
	}
}
