import { defineConfig, devices } from '@playwright/test';

// Keep the browser and viewport configuration aligned with OBS Utils.
export default defineConfig({
	testDir: './tests',
	testMatch: process.env.TEST_INSTALL === '1' ? '**/install.spec.ts' : '**/*.spec.ts',
	testIgnore: process.env.TEST_INSTALL === '1' ? [] : ['**/install.spec.ts'],
	timeout: 45000,
	workers: 1,
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	reporter: 'list',
	outputDir: 'test-results/playwright',
	use: {
		baseURL: process.env.TEST_URL ?? 'http://localhost:30001',
		headless: true,
		trace: 'retain-on-failure',
		launchOptions: {
			args: ['--use-gl=angle', '--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
		},
	},
	projects: [{ name: 'Desktop Chromium', use: { ...devices['Desktop Chrome'], viewport: { height: 1080, width: 1920 } } }],
});
