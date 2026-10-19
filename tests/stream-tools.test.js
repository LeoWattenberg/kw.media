import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
	OUTPUT_DIR,
	STREAM_TOOL_IDS,
	applyBrand,
	buildStreamTools,
	readBrand,
	staleStreamTools,
} from '../scripts/build-stream-tools.mjs';

const repoFile = (path) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

test('committed stream tool files match their sources', () => {
	assert.deepEqual(staleStreamTools(), [], 'run npm run build:stream-tools and commit public/stream-tools/');
});

test('every stream tool builds into one self-contained HTML file', () => {
	const files = buildStreamTools();
	assert.deepEqual([...files.keys()].sort(), STREAM_TOOL_IDS.map((id) => `${id}.html`).sort());

	for (const [name, html] of files) {
		assert.match(html, /^<!doctype html>/i, name);
		assert.doesNotMatch(html, /%%[A-Z_]+%%/, `${name} still has a brand placeholder`);
		assert.doesNotMatch(html, /<script[^>]+\bsrc=/i, `${name} loads an external script`);
		assert.doesNotMatch(html, /<link[^>]+rel=["']?stylesheet/i, `${name} loads an external stylesheet`);
		assert.match(html, /data:image\/png;base64,/, `${name} has no embedded logo`);
		assert.match(html, /QS\.get\('lang'\)/, `${name} ignores the ?lang= parameter`);
		assert.match(html, /QS\.get\('embed'\)==='1'/, `${name} ignores the ?embed=1 parameter`);
		assert.match(html, /html\.embedded \.topbar \.brand/, `${name} keeps its own logo when embedded`);
	}
});

test('brand placeholders are replaced with the shared logo data', () => {
	const brand = readBrand();
	assert.equal(applyBrand('%%LOGO_AR%%|%%ICON%%', brand), `${brand.ar}|${brand.icon}`);
	assert.ok(brand.light.startsWith('data:image/'));
	assert.ok(brand.dark.startsWith('data:image/'));
});

test('bingo viewer links point to the hosted file on kw.media', () => {
	const bingo = buildStreamTools().get('stream-bingo.html');
	assert.match(bingo, /const HOSTED_URL='https:\/\/kw\.media\/stream-tools\/stream-bingo\.html';/);
	assert.ok(existsSync(`${OUTPUT_DIR}/stream-bingo.html`));
});

test('every stream tool has a registry entry, both tool pages, a category slot, and an eyebrow', () => {
	const registry = repoFile('src/data/stream-tools.ts');
	const categories = repoFile('src/data/tool-categories.ts');
	const eyebrows = repoFile('src/data/tools.ts');
	const streamCategory = categories.slice(categories.indexOf("id: 'stream'"));

	for (const id of STREAM_TOOL_IDS) {
		assert.match(registry, new RegExp(`id: '${id}',\\s*file: '${id}\\.html'`), `${id} registry entry`);
		const page = repoFile(`src/data/tools/${id}.astro`);
		assert.match(page, new RegExp(`path: '/de/tools/${id}/'`), `${id} German page`);
		assert.match(page, new RegExp(`path: '/en/tools/${id}/'`), `${id} English page`);
		assert.match(page, new RegExp(`streamToolId="${id}"`), `${id} embeds its own file`);
		assert.match(streamCategory, new RegExp(`'${id}'`), `${id} is listed in the stream category`);
		assert.match(eyebrows, new RegExp(`'${id}': \\{ de: '[^']+', en: '[^']+' \\}`), `${id} eyebrow`);

		for (const description of page.matchAll(/description: '([^']+)'/g)) {
			assert.ok(description[1].length <= 155, `${id} meta description is too long`);
		}
	}
});
