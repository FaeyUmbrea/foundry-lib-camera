import { expect, test } from '@playwright/test';

interface PackageSetup {
	installPackage: (options: { type: string; manifest: string; notify: boolean; dependencies: boolean }) => Promise<{ id: string; version: string }>;
	checkPackage: (options: { type: string; id: string; manifest: string }) => Promise<{ isUpgrade?: boolean; availability?: number }>;
	installDependencies: (pkg: unknown, options: { notify: boolean }) => Promise<unknown>;
	post: (options: { action: string; type: string; id: string }) => Promise<unknown>;
	reload: () => Promise<void>;
}

test.beforeEach(async ({ page }) => {
	await page.addInitScript(() => {
		// The clean v13 setup opens its three-step backup tour over dependency dialogs.
		localStorage.setItem('core.tourProgress', JSON.stringify({ core: { backupsOverview: 3 } }));
	});
});

test('installs a compatible missing dependency and refuses an API-2 dependency', async ({ page }) => {
	await page.goto('/setup');
	await page.waitForFunction(() => typeof game !== 'undefined' && !!(game as unknown as PackageSetup).installPackage);
	// This suite must run against the disposable installer fixture, never an existing world.
	expect(new URL(page.url()).port).toBe('30099');
	for (const name of ['incompatible', 'compatible']) {
		await page.evaluate(async (name) => {
			const setup = game as unknown as PackageSetup;
			if (game.modules?.has('lib-camera')) {
				await setup.post({ action: 'uninstallPackage', type: 'module', id: 'lib-camera' });
				await setup.reload();
			}
			await setup.installPackage({ type: 'module', manifest: `http://127.0.0.1:30097/${name}/module.json`, notify: false, dependencies: false });
		}, name);
		const installing = page.evaluate(async name => (game as unknown as PackageSetup).installDependencies(game.modules?.get(`lib-camera-test-${name}`), { notify: false }), name);
		const dialog = page.locator('#setup-install-dependencies');
		await expect(dialog).toBeVisible();
		if (name === 'incompatible') {
			await expect(dialog.locator('[data-action="automatic"]')).toBeDisabled();
			await expect(dialog.locator('.manual')).toContainText('1.999');
			await dialog.locator('[data-action="manual"]').click();
		} else {
			await expect(dialog.locator('[data-action="automatic"]')).toBeEnabled();
			await dialog.locator('[data-action="automatic"]').click();
		}
		await installing;
		expect(await page.evaluate(() => game.modules?.has('lib-camera'))).toBe(name === 'compatible');
	}
});

test('installs the archive, updates a four-part hotfix and checks API dependency compatibility', async ({ page }) => {
	await page.goto('/setup');
	await page.waitForFunction(() => typeof game !== 'undefined' && !!(game as unknown as PackageSetup).installPackage);
	const generation = Number(process.env.TEST_FOUNDRY_GENERATION);
	if (![13, 14].includes(generation)) throw new Error('Set TEST_FOUNDRY_GENERATION');
	const install = (version: string) => page.evaluate(async (version) => {
		const installed = await (game as unknown as PackageSetup).installPackage({ type: 'module', manifest: `http://127.0.0.1:30097/${version}/module.json`, notify: false, dependencies: false });
		return { id: installed.id, version: installed.version };
	}, version);
	expect(await install(`1.${generation}.0`)).toEqual({ id: 'lib-camera', version: `1.${generation}.0` });
	const update = await page.evaluate(async generation => (game as unknown as PackageSetup).checkPackage({ type: 'module', id: 'lib-camera', manifest: `http://127.0.0.1:30097/1.${generation}.0.1/module.json` }), generation);
	expect(update.isUpgrade).toBe(true);
	expect(await install(`1.${generation}.0.1`)).toEqual({ id: 'lib-camera', version: `1.${generation}.0.1` });
	const compatible = () => page.evaluate(() => {
		const pkg = game.modules?.get('lib-camera');
		const Package = foundry.packages.Module as unknown as { testDependencyCompatibility: (range: { minimum: string; maximum: string }, pkg: unknown) => boolean };
		return Package.testDependencyCompatibility({ minimum: '1.13.0', maximum: '1.999' }, pkg);
	});
	expect(await compatible()).toBe(true);
	expect(await install(`2.${generation}.0`)).toEqual({ id: 'lib-camera', version: `2.${generation}.0` });
	expect(await compatible()).toBe(false);
	await install('compatible');
	// Foundry skips dependency version checks once the dependency is installed.
	// Record that host limitation instead of promising reverse-dependency protection.
	await page.evaluate(async () => (game as unknown as PackageSetup).installDependencies(game.modules?.get('lib-camera-test-compatible'), { notify: false }));
	await expect(page.locator('#setup-install-dependencies')).not.toBeVisible();
	const other = generation === 13 ? 14 : 13;
	await expect(install(`1.${other}.0`)).rejects.toThrow();
});
