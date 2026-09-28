import type { CameraModule } from './fixtures.js';
import { expect, test } from './fixtures.js';

test('moves a real viewport and renders the native control panel', async ({ pages: { gmPage, obsPage } }) => {
	const result = await obsPage.evaluate(async () => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		const consumer = api.register({ id: 'lib-camera-test', name: 'Test camera' });
		try {
			return await consumer.move({ x: 1500, y: 1500, scale: 1, duration: 100, lockInput: true });
		} finally {
			consumer.unregister();
		}
	});
	expect(result).toMatchObject({ status: 'completed', position: { x: 1500, y: 1500, scale: 1 } });
	await gmPage.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.openControls());
	const panel = gmPage.locator('#lib-camera-controls');
	await expect(panel).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Stop and disable camera control', exact: true })).toBeVisible();
	await expect(panel.getByRole('button', { name: 'Stop and disable for everyone', exact: true })).toBeVisible();
});

test('panic interrupts movement, restores wheel input and persists until resumed', async ({ pages: { obsPage } }) => {
	await obsPage.evaluate(() => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		const consumer = api.register({ id: 'lib-camera-test', name: 'Test camera' });
		window.cameraTestMovement = consumer.move({ x: 2500, duration: 10000, lockInput: true });
		api.openControls();
	});
	const panel = obsPage.locator('#lib-camera-controls');
	await expect(panel).toBeVisible();
	await expect(panel.getByText('Temporarily locked', { exact: true })).toBeVisible();
	const locked = await obsPage.evaluate(() => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		const before = api.read()?.scale;
		Reflect.get(canvas!, '_onMouseWheel').call(canvas, { delta: -1 });
		return { before, after: api.read()?.scale };
	});
	expect(locked.after).toBe(locked.before);
	await panel.getByRole('button', { name: 'Stop and disable camera control', exact: true }).click();
	expect(await obsPage.evaluate(() => window.cameraTestMovement)).toEqual({ status: 'cancelled', reason: 'panic' });
	await expect(panel.getByText('Available', { exact: true })).toBeVisible();
	const free = await obsPage.evaluate(() => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		const before = api.read()?.scale;
		Reflect.get(canvas!, '_onMouseWheel').call(canvas, { delta: -1 });
		return { before, after: api.read()?.scale };
	});
	expect(free.after).not.toBe(free.before);
	await obsPage.reload();
	await obsPage.waitForFunction(() => game.ready && canvas?.ready);
	expect(await obsPage.evaluate(() => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		return api.register({ id: 'lib-camera-test', name: 'Test camera' }).acquire();
	})).toEqual({ ok: false, reason: 'disabled' });
	await obsPage.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.openControls());
	await obsPage.locator('#lib-camera-controls').getByRole('button', { name: 'Re-enable on this client', exact: true }).click();
	await expect.poll(() => obsPage.evaluate(() => game.settings?.get('lib-camera', 'disabled'))).toBe(false);
});

test('priorities save through the panel and preempt only lower-priority claims', async ({ pages: { gmPage } }) => {
	await gmPage.evaluate(() => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		window.cameraTestLow = api.register({ id: 'lib-camera-low', name: 'Low' });
		window.cameraTestHigh = api.register({ id: 'lib-camera-high', name: 'High' });
		window.cameraTestLow.acquire();
		api.openControls();
	});
	const panel = gmPage.locator('#lib-camera-controls');
	await panel.getByLabel('High — This client', { exact: true }).fill('10');
	await panel.getByRole('button', { name: 'Save priorities', exact: true }).click();
	await expect.poll(() => gmPage.evaluate(() => game.settings?.get('lib-camera', 'localPriorities'))).toEqual({ 'lib-camera-high': 10 });
	expect(await gmPage.evaluate(() => {
		const acquired = window.cameraTestHigh.acquire();
		return { acquired: acquired.ok, lower: window.cameraTestLow.acquire().ok };
	})).toEqual({ acquired: true, lower: false });
	await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
	await expect(panel.getByText('lib-camera-high', { exact: true }).first()).toBeVisible();
	await panel.getByRole('button', { name: 'Release current claim', exact: true }).click();
	expect(await gmPage.evaluate(() => window.cameraTestLow.acquire().ok)).toBe(true);
});

test('world-wide stop reaches every client and global resume preserves local opt-outs', async ({ pages: { gmPage, obsPage, playerPage } }) => {
	for (const page of [gmPage, obsPage, playerPage]) {
		await page.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.openControls());
	}
	await expect(obsPage.getByRole('button', { name: 'Stop and disable for everyone', exact: true })).toHaveCount(0);
	await obsPage.getByRole('button', { name: 'Stop and disable camera control', exact: true }).click();
	await gmPage.getByRole('button', { name: 'Stop and disable for everyone', exact: true }).click();
	for (const page of [obsPage, playerPage]) {
		await expect.poll(() => page.evaluate(() => game.settings?.get('lib-camera', 'worldDisabled'))).toBe(true);
		expect(await page.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.register({ id: 'lib-camera-test', name: 'Test' }).acquire().ok)).toBe(false);
	}
	await gmPage.getByRole('button', { name: 'Re-enable for everyone', exact: true }).click();
	await expect.poll(() => playerPage.evaluate(() => game.settings?.get('lib-camera', 'worldDisabled'))).toBe(false);
	expect(await playerPage.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.register({ id: 'lib-camera-resume', name: 'Resume' }).acquire().ok)).toBe(true);
	await expect.poll(() => obsPage.evaluate(() => game.settings?.get('lib-camera', 'worldDisabled'))).toBe(false);
	expect(await obsPage.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.register({ id: 'lib-camera-resume', name: 'Resume' }).acquire())).toEqual({ ok: false, reason: 'disabled' });
});

test('canvas teardown cancels the active claim before the scene is drawn again', async ({ pages: { gmPage } }) => {
	const result = await gmPage.evaluate(async () => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		const consumer = api.register({ id: 'lib-camera-test', name: 'Test camera' });
		const moving = consumer.move({ x: 2500, duration: 10000, lockInput: true });
		const scene = canvas?.scene;
		await canvas?.tearDown();
		const cancelled = await moving;
		await canvas?.draw(scene);
		const next = await consumer.move({ x: 1500, duration: 50, lockInput: true });
		consumer.unregister();
		return { cancelled, next };
	});
	expect(result.cancelled).toEqual({ status: 'cancelled', reason: 'canvas-teardown' });
	expect(result.next.status).toBe('completed');
});
