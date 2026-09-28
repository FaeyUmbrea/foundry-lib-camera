import type { Page } from '@playwright/test';
import type { ModuleApi } from '../src/api.js';
import { expect, test as testBase } from '@playwright/test';

export interface CameraModule { api: ModuleApi; active: boolean }

// Same users, login flow and separate browser contexts as OBS Utils' fixture.
async function join(page: Page, name: string): Promise<void> {
	await page.goto('/join');
	await page.locator('select[name="userid"]').selectOption({ label: name });
	await page.locator('input[name=password]').fill(process.env.TEST_INSTALL_PASSWORD ?? '');
	await page.getByRole('button', { name: 'Join Game Session' }).click();
	await expect(page).toHaveURL('/game');
	await page.waitForFunction(() => typeof game !== 'undefined' && game.ready && typeof canvas !== 'undefined' && canvas?.ready);
}

export const test = testBase.extend<{ pages: { gmPage: Page; obsPage: Page; playerPage: Page } }>({
	pages: async ({ browser }, use) => {
		const gmContext = await browser.newContext();
		const obsContext = await browser.newContext();
		const playerContext = await browser.newContext();
		try {
			const gmPage = await gmContext.newPage();
			await join(gmPage, 'Gamemaster');
			const enabled = await gmPage.evaluate(async (with3D) => {
				if (!['obs-fixture-v13', 'obs-fixture-v14'].includes(game.world?.id ?? '')) throw new Error('Tests require an OBS Utils fixture world');
				if ((game.modules?.get('lib-camera') as unknown as CameraModule)?.active && (!with3D || game.modules?.get('levels-3d-preview')?.active)) return true;
				if (!game.settings) throw new Error('Settings are unavailable');
				await game.settings.set('core', 'moduleConfiguration', { 'lib-wrapper': true, 'lib-camera': true, ...(with3D ? { 'levels-3d-preview': true } : {}) });
				return false;
			}, process.env.TEST_3D_CANVAS === '1');
			if (!enabled) {
				await gmPage.reload();
				await gmPage.waitForFunction(() => typeof game !== 'undefined' && game.ready && typeof canvas !== 'undefined' && canvas?.ready);
			}
			await gmPage.evaluate(async () => {
				await game.settings?.set('lib-camera', 'worldDisabled', false);
				await game.settings?.set('lib-camera', 'priorities', {});
			});
			const obsPage = await obsContext.newPage();
			const playerPage = await playerContext.newPage();
			await Promise.all([join(obsPage, 'Player2'), join(playerPage, 'Player3')]);
			for (const page of [gmPage, obsPage, playerPage]) {
				await page.waitForFunction(() => !!(game.modules?.get('lib-camera') as unknown as CameraModule)?.api);
			}
			await use({ gmPage, obsPage, playerPage });
		} finally {
			await Promise.all([gmContext.close(), obsContext.close(), playerContext.close()]);
		}
	},
});

export { expect };

declare global {
	interface Window {
		cameraTestMovement: ReturnType<import('../src/controller.js').LocalConsumer['move']>;
		cameraTestLow: import('../src/controller.js').LocalConsumer;
		cameraTestHigh: import('../src/controller.js').LocalConsumer;
	}
}
