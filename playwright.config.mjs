import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './tests/browser',
	timeout: 30000,
	expect: {
		timeout: 5000,
	},
	fullyParallel: true,
	webServer: {
		command: 'npm run preview -- --host 127.0.0.1 --port 4321',
		url: 'http://127.0.0.1:4321',
		reuseExistingServer: true,
		timeout: 30000,
	},
	use: {
		baseURL: 'http://127.0.0.1:4321',
		trace: 'on-first-retry',
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
