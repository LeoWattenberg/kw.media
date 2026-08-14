import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.PLAYWRIGHT_PORT ?? 4322);
const baseURL = `http://127.0.0.1:${port}`;
const crossBrowserProjects = process.env.PLAYWRIGHT_CROSS_BROWSER === '1'
	? [
		{
			name: 'firefox',
			use: { ...devices['Desktop Firefox'] },
		},
		{
			name: 'webkit',
			use: { ...devices['Desktop Safari'] },
		},
		{
			name: 'mobile-chromium',
			use: { ...devices['Pixel 7'] },
		},
		{
			name: 'mobile-webkit',
			use: { ...devices['iPhone 14'] },
		},
	]
	: [];

export default defineConfig({
	testDir: './tests/browser',
	timeout: 30000,
	expect: {
		timeout: 5000,
	},
	fullyParallel: true,
	// `astro preview` daemonizes, so Playwright's webServer helper cannot own it:
	// tests/browser/global-setup.mjs starts and waits for the daemon instead.
	globalSetup: './tests/browser/global-setup.mjs',
	globalTeardown: './tests/browser/global-teardown.mjs',
	use: {
		baseURL,
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		// Opt in with PLAYWRIGHT_CROSS_BROWSER=1 after installing Firefox and WebKit.
		...crossBrowserProjects,
	],
});
