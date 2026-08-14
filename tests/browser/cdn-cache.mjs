// The heavy tools pull their engines from public CDNs at runtime: ffmpeg.wasm
// from unpkg, ImageMagick WASM from jsDelivr, MediaPipe from Google storage.
// Downloading tens of megabytes per test would make real conversion tests too
// slow to keep, so the first run stores each response under .cache/ and later
// runs replay it. The tools still execute the genuine WebAssembly builds — only
// the transport is short-circuited.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CACHE_DIR = fileURLToPath(new URL('../../.cache/browser-cdn/', import.meta.url));

export const CDN_PATTERNS = [
	'https://unpkg.com/**',
	'https://cdn.jsdelivr.net/**',
	'https://storage.googleapis.com/**',
];

const entryPath = (url) => path.join(CACHE_DIR, createHash('sha256').update(url).digest('hex').slice(0, 32));

const readEntry = async (url) => {
	const base = entryPath(url);
	try {
		const [meta, body] = await Promise.all([
			readFile(`${base}.json`, 'utf8'),
			readFile(`${base}.bin`),
		]);
		return { ...JSON.parse(meta), body };
	} catch {
		return null;
	}
};

/*
 * Playwright runs several workers at once and they all warm the same cold cache, so a plain
 * write would let one worker read a half-written 30 MB wasm file. Writing to a private name
 * and renaming makes every entry appear complete or not at all, and the metadata lands only
 * after its body so a reader never sees a described entry whose bytes are missing.
 */
const writeEntry = async (url, meta, body) => {
	const base = entryPath(url);
	const pending = `${base}.${randomUUID()}.part`;
	await writeFile(pending, body);
	await rename(pending, `${base}.bin`);

	const pendingMeta = `${base}.${randomUUID()}.part`;
	await writeFile(pendingMeta, JSON.stringify({ ...meta, url }));
	await rename(pendingMeta, `${base}.json`);
};

/**
 * Replays CDN responses from disk, fetching and storing them on a cache miss.
 * Routes are installed on the browser context so requests started inside the
 * ffmpeg web worker are served too.
 */
export async function cacheCdnAssets(page, patterns = CDN_PATTERNS) {
	await mkdir(CACHE_DIR, { recursive: true });

	for (const pattern of patterns) {
		await page.context().route(pattern, async (route) => {
			const url = route.request().url();
			const cached = await readEntry(url);
			if (cached) {
				await route.fulfill({ status: cached.status, headers: cached.headers, body: cached.body });
				return;
			}

			let response;
			try {
				response = await fetch(url);
			} catch (error) {
				await route.abort();
				throw new Error(`Could not reach ${url}: ${error.message}`);
			}

			const body = Buffer.from(await response.arrayBuffer());
			const headers = {
				'content-type': response.headers.get('content-type') ?? 'application/octet-stream',
				'access-control-allow-origin': '*',
				'cache-control': 'public, max-age=31536000',
			};

			if (response.ok) {
				await writeEntry(url, { status: response.status, headers }, body);
			}

			await route.fulfill({ status: response.status, headers, body });
		});
	}
}
