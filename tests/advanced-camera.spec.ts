import type { CameraModule } from './fixtures.js';
import { expect, test } from './fixtures.js';

// Real server delivery supplies the second socket argument used by authorization.
test('remote movement reaches every session and refuses a forged GM identity', async ({ browser, pages: { gmPage, obsPage, playerPage } }) => {
	const context = await browser.newContext({ storageState: await obsPage.context().storageState() });
	try {
		const extra = await context.newPage();
		await extra.goto('/game');
		await extra.waitForFunction(() => typeof game !== 'undefined' && game.ready && typeof canvas !== 'undefined' && canvas?.ready);
		for (const page of [gmPage, obsPage, playerPage, extra]) {
			await page.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.register({ id: 'camera-remote-test', name: 'Remote test' }));
		}
		const playerIds = await Promise.all([obsPage, playerPage].map(page => page.evaluate(() => game.user!.id)));
		const results = await gmPage.evaluate(async (targets) => {
			return (game.modules?.get('lib-camera') as unknown as CameraModule).api.moveRemote('camera-remote-test', targets, { x: 1500, y: 1500, scale: 1, duration: 50, lockInput: true });
		}, playerIds);
		expect(results.map(result => result.status)).toEqual(['acknowledged', 'acknowledged']);
		expect(results[0].outcomes).toHaveLength(2);
		expect(results[1].outcomes).toHaveLength(1);
		for (const result of results) {
			for (const outcome of result.outcomes) expect(outcome.status).toBe('completed');
		}
		for (const page of [obsPage, playerPage, extra]) expect(await page.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.read()?.x)).toBe(1500);
		const before = await gmPage.evaluate(() => ({ id: game.user!.id, view: (game.modules?.get('lib-camera') as unknown as CameraModule).api.read() }));
		await obsPage.evaluate(({ id }) => {
			game.socket?.emit('module.lib-camera', { kind: 'request', id: crypto.randomUUID(), sender: id, consumer: 'camera-remote-test', sceneId: canvas?.scene?.id, action: 'move', data: { x: 999 } }, { recipients: [id] });
		}, before);
		await gmPage.waitForTimeout(150);
		expect(await gmPage.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.read())).toEqual(before.view);
	} finally {
		await context.close();
	}
});

test('frames tokens and follows a remote viewport through pause and resume', async ({ pages: { gmPage: obsPage, obsPage: gmPage } }) => {
	const target = await obsPage.evaluate(() => game.user!.id);
	await gmPage.evaluate((userId) => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		api.register({ id: 'camera-follow-test', name: 'Follow test' });
		const result = api.followUser('camera-follow-test', userId, { duration: 0 }, 'raw');
		if (!result.ok) throw new Error(result.reason);
		(window as typeof window & { cameraFollow: import('../src/follow.js').CameraFollow }).cameraFollow = result.follow;
	}, target);
	await obsPage.evaluate(() => canvas?.pan({ x: 1400, y: 1200, scale: 1 }));
	await expect.poll(() => gmPage.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.read()?.x)).toBe(1400);
	await gmPage.evaluate(() => (window as typeof window & { cameraFollow: import('../src/follow.js').CameraFollow }).cameraFollow.pause());
	await obsPage.evaluate(() => canvas?.pan({ x: 1600, y: 1200, scale: 1 }));
	await gmPage.waitForTimeout(150);
	expect(await gmPage.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.read()?.x)).toBe(1400);
	await gmPage.evaluate(() => (window as typeof window & { cameraFollow: import('../src/follow.js').CameraFollow }).cameraFollow.resume());
	await expect.poll(() => gmPage.evaluate(() => (game.modules?.get('lib-camera') as unknown as CameraModule).api.read()?.x)).toBe(1600);
	await gmPage.evaluate(() => (window as typeof window & { cameraFollow: import('../src/follow.js').CameraFollow }).cameraFollow.stop());
	const framing = await obsPage.evaluate(async () => {
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		const token = canvas?.tokens?.placeables.find(token => token.visible);
		if (!token?.id) throw new Error('Fixture needs a token');
		const frame = api.frameTokens([token.id], { margin: 1, closest: 10, widest: 40 });
		if (!frame) throw new Error('Token framing unavailable');
		const consumer = api.register({ id: 'camera-frame-test', name: 'Frame test' });
		try {
			return await consumer.move({ ...frame, bounds: true });
		} finally {
			consumer.unregister();
		}
	});
	expect(framing.status).toBe('completed');
});

test('changes a v14 floor before applying its viewport', async ({ pages: { gmPage } }) => {
	const result = await gmPage.evaluate(async () => {
		const scene = canvas?.scene as unknown as {
			levels?: { contents: { id: string }[] };
			createEmbeddedDocuments: (type: string, data: object[]) => Promise<{ id: string }[]>;
			deleteEmbeddedDocuments: (type: string, ids: string[]) => Promise<unknown>;
		};
		if (!scene.levels) return { supported: false };
		const original = (canvas as unknown as { level: { id: string } }).level.id;
		const [level] = await scene.createEmbeddedDocuments('Level', [{ name: 'libCamera runtime floor', elevation: { bottom: 20, top: 40 } }]);
		const api = (game.modules?.get('lib-camera') as unknown as CameraModule).api;
		const consumer = api.register({ id: 'camera-floor-test', name: 'Floor test' });
		try {
			const movement = await consumer.move({ level: level.id, x: 1500, y: 1300, scale: 1 });
			const actual = api.read();
			await consumer.move({ level: original, x: 1400 });
			return { supported: true, movement, actual, level: level.id };
		} finally {
			consumer.unregister();
			await scene.deleteEmbeddedDocuments('Level', [level.id]);
		}
	});
	test.skip(!result.supported, 'Scene Levels require Foundry 14');
	expect(result.movement?.status).toBe('completed');
	expect(result.actual).toMatchObject({ x: 1500, y: 1300, scale: 1, level: result.level });
});
