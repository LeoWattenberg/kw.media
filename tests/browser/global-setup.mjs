// Astro 7's `astro preview` detaches into a background daemon whenever it thinks
// a coding agent is driving it (astro/dist/cli/preview/index.js checks
// `isRunByAgent()`), and stays in the foreground otherwise. Playwright's built-in
// `webServer` cannot survive both shapes: under an agent the foreground command
// exits at once and Playwright reports "Process from config.webServer exited
// early", while the daemon it leaves behind makes the next run fail with "is
// already used". Owning the server here removes the guesswork — `--background`
// forces the same daemon in CI and on a developer machine alike, so every run
// stops whatever was left over, starts one server, and waits for it to answer.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const READY_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 250;

const astro = (args) => spawnSync('npx', ['astro', ...args], {
	cwd: REPO_ROOT,
	encoding: 'utf8',
	stdio: ['ignore', 'pipe', 'pipe'],
});

export const stopPreviewServer = () => {
	astro(['preview', 'stop']);
};

const waitForServer = async (baseURL) => {
	const deadline = Date.now() + READY_TIMEOUT_MS;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(baseURL, { redirect: 'manual' });
			if (response.status < 500) {
				return;
			}
		} catch {
			// The daemon is still booting; keep polling until the deadline.
		}

		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	throw new Error(`Preview server did not answer at ${baseURL} within ${READY_TIMEOUT_MS} ms.`);
};

export default async function globalSetup(config) {
	const { baseURL } = config.projects[0].use;
	const port = new URL(baseURL).port;

	stopPreviewServer();
	const started = astro(['preview', '--background', '--host', '127.0.0.1', '--port', port]);
	if (started.status !== 0) {
		throw new Error(`Could not start the preview server: ${started.stderr || started.stdout}`);
	}

	await waitForServer(baseURL);
}
