import { expect, test } from '@playwright/test';

test('fits the real scene through libCamera using one browser client', async ({ page }) => {
	await page.goto('/join');
	await page.locator('select[name="userid" i]').selectOption({ label: 'Gamemaster' });
	await page.locator('input[name=password]').fill(process.env.TEST_INSTALL_PASSWORD ?? '');
	await page.getByRole('button', { name: 'Join Game Session' }).click();
	await page.waitForFunction(() => typeof game !== 'undefined' && game.ready && typeof canvas !== 'undefined' && canvas?.ready);
	const changed = await page.evaluate(async () => {
		if (!['obs-fixture-v13', 'obs-fixture-v14'].includes(game.world?.id ?? '')) throw new Error('Requires an isolated fixture');
		if (game.modules?.get('lib-camera')?.active && !game.modules?.get('obs-utils-premium')?.active && !game.modules?.get('levels-3d-preview')?.active) return false;
		await game.settings?.set('core', 'moduleConfiguration', { 'lib-wrapper': true, 'lib-camera': true });
		return true;
	});
	if (changed) await page.reload();
	await page.waitForFunction(() => typeof game !== 'undefined' && game.ready && typeof canvas !== 'undefined' && canvas?.ready);
	const result = await page.evaluate(async () => {
		const api = (game.modules?.get('lib-camera') as unknown as { api: import('../src/api.js').ModuleApi }).api;
		await game.settings?.set('lib-camera', 'worldDisabled', false);
		const consumer = api.register({ id: 'fit-test', name: 'Scene fit test' });
		try {
			const expected = api.frame([api.sceneBounds()!]);
			const movement = await api.fitScene('fit-test', { duration: 0 });
			const documents = canvas?.scene?.tokens?.contents ?? [];
			const otherFloor = documents.find(document => !document.object);
			const tokenFrame = otherFloor?.id ? api.frameTokens([otherFloor.id]) : undefined;
			const size = (otherFloor as unknown as { getSize?: () => { width: number; height: number } })?.getSize?.();
			const tokenCenter = otherFloor && size ? { x: otherFloor.x + size.width / 2, y: otherFloor.y + size.height / 2 } : undefined;
			return { expected, movement, actual: api.read(), tokenFrame, tokenCenter };
		} finally { consumer.unregister(); }
	});
	expect(result.movement.status).toBe('completed');
	expect(result.actual).toMatchObject({ ...result.expected });
	if (result.tokenCenter) expect(result.tokenFrame).toMatchObject({ ...result.tokenCenter });
});
