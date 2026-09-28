import type { Canvas3D } from '../src/camera-3d.js';
import type { CameraModule } from './fixtures.js';
import { expect, test } from './fixtures.js';

test.describe('3D Canvas', () => {
	test.skip(process.env.TEST_3D_CANVAS !== '1', 'Requires the matching free 3D Canvas release in the copied fixture');

	test('reads and sets real vectors, respects ownership, and survives mode switches', async ({ pages: { gmPage } }) => {
		await gmPage.waitForFunction(() => !!(game as typeof game & { Levels3DPreview?: Canvas3D }).Levels3DPreview?.controls);
		await gmPage.evaluate(() => {
			const preview = (game as typeof game & { Levels3DPreview: Canvas3D & { toggle: (active: boolean) => void } }).Levels3DPreview;
			preview.toggle(true);
		});
		await gmPage.waitForFunction(() => (game as typeof game & { Levels3DPreview: Canvas3D }).Levels3DPreview._ready, undefined, { timeout: 30000 });
		const result = await gmPage.evaluate(async () => {
			const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
			const preview = (game as typeof game & { Levels3DPreview: Canvas3D & {
				toggle: (active: boolean) => void;
				GameCamera: Canvas3D['GameCamera'] & { toggle: () => void };
			}; }).Levels3DPreview;
			if (preview.GameCamera.enabled) preview.GameCamera.toggle();
			const before = api.read3D();
			if (!before) throw new Error('3D view unavailable');
			const consumer = api.register({ id: 'camera-test-3d', name: '3D runtime test' });
			const higher = api.register({ id: 'camera-test-3d-high', name: '3D higher priority', priority: 1 });
			try {
				const next = {
					position: { x: before.position.x + 0.2, y: before.position.y, z: before.position.z + 0.1 },
					target: { x: before.target.x + 0.2, y: before.target.y, z: before.target.z + 0.1 },
				};
				const damping = preview.controls.enableDamping;
				const moved = consumer.set3D(next);
				await new Promise(resolve => setTimeout(resolve, 150));
				const after = api.read3D();
				const owner = consumer.acquire();
				if (!owner.ok) throw new Error('Claim unavailable');
				const preempted = higher.set3D(before);
				const stale = owner.claim.set3D(next);
				preview.GameCamera.toggle();
				const blocked = consumer.set3D(next);
				preview.GameCamera.toggle();
				await api.panic();
				const disabled = consumer.set3D(next);
				await game.settings?.set('lib-camera', 'disabled', false);
				const resumed = consumer.set3D(before);
				const held = consumer.acquire();
				if (!held.ok) throw new Error('Claim unavailable after resume');
				preview.toggle(false);
				return {
					before,
					next,
					moved,
					after,
					preempted,
					stale,
					blocked,
					disabled,
					resumed,
					dampingRestored: preview.controls.enableDamping === damping,
					released: !held.claim.active,
					missing3D: api.read3D() === undefined,
					available2D: api.read() !== undefined,
				};
			} finally {
				consumer.unregister();
				higher.unregister();
				if (preview._active) preview.toggle(false);
			}
		});
		expect(result.moved.status).toBe('completed');
		for (const key of ['x', 'y', 'z'] as const) {
			expect(result.after?.position[key]).toBeCloseTo(result.next.position[key], 5);
			if (result.moved.status === 'completed') expect(result.moved.view.target[key]).toBeCloseTo(result.next.target[key], 5);
		}
		// Free-camera collision handling reprojects the target along the same viewing ray.
		const direction = (view: NonNullable<typeof result.after>) => {
			const delta = (['x', 'y', 'z'] as const).map(key => view.target[key] - view.position[key]);
			const length = Math.hypot(...delta);
			return delta.map(value => value / length);
		};
		expect(result.after).toBeDefined();
		const afterDirection = direction(result.after!);
		for (const [index, value] of direction(result.next).entries()) expect(afterDirection[index]).toBeCloseTo(value, 5);
		expect(result.preempted.status).toBe('completed');
		expect(result.stale).toEqual({ status: 'rejected', reason: 'inactive-claim' });
		expect(result.blocked).toEqual({ status: 'rejected', reason: 'unsupported-mode' });
		expect(result.disabled).toEqual({ status: 'rejected', reason: 'disabled' });
		expect(result.resumed.status).toBe('completed');
		expect(result.dampingRestored).toBe(true);
		expect(result.released).toBe(true);
		expect(result.missing3D).toBe(true);
		expect(result.available2D).toBe(true);
	});
});
