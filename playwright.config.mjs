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
	webServer: {
		command: `npm run preview -- --host 127.0.0.1 --port ${port}`,
		url: baseURL,
		reuseExistingServer: false,
		timeout: 30000,
	},
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
