import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const repoFile = (path) => readFileSync(join(root, path), 'utf8');
const componentDir = 'src/components/tools/stream';
const streamToolIds = [...repoFile('src/data/stream-tools.ts').matchAll(/\bid: '([a-z-]+)'/g)].map((match) => match[1]);
const route = repoFile('src/pages/stream-tools/[tool].astro');

// Mirrors KitToolApp.astro and the standalone app components: the scripts are inlined
// into one document, so each composed script must at least compile.
const fakeBrand = JSON.stringify({ light: 'data:image/svg+xml;base64,', dark: 'data:image/svg+xml;base64,', icon: 'data:image/png;base64,', ar: 2.5 });

function appComponent(id) {
	const name = new RegExp(`'${id}': (\\w+),`).exec(route)?.[1];
	assert.ok(name, `${id} has no app in src/pages/stream-tools/[tool].astro`);
	assert.match(route, new RegExp(`import ${name} from '../../components/tools/stream/${name}\\.astro';`));
	const path = `${componentDir}/${name}.astro`;
	return { path, source: repoFile(path) };
}

function rawImports({ path, source }) {
	return Object.fromEntries(
		[...source.matchAll(/import (\w+) from '([^']+)\?raw';/g)].map(([, name, relative]) => [name, readFileSync(join(root, dirname(path), relative), 'utf8')]),
	);
}

function composedScript(id) {
	const app = appComponent(id);
	const raw = rawImports(app);

	if (app.source.includes('<KitToolApp')) {
		const core = repoFile('src/lib/tools/stream/kit/core.js');
		return `(()=>{\n'use strict';\nconst KWM_BRAND=${fakeBrand};\n${raw.config}\n${core}\n${raw.logic}\ncoreStart();\n})();`;
	}

	return `const KWM_BRAND=${fakeBrand};\nconst KWM_HOSTED_URL='https://kw.media/stream-tools/${id}/';\n${raw.js}`;
}

test('the stream tool registry lists the seven tools', () => {
	assert.deepEqual(streamToolIds, ['tier-list', 'stream-bingo', 'chat-hotwords', 'spin-wheel', 'tournament-bracket', 'stream-scenes', 'death-counter']);
	assert.match(repoFile('src/data/stream-tools.ts'), /return `\/stream-tools\/\$\{tool\.id\}\/`;/);
});

test('every stream tool has both tool pages, a category slot, an eyebrow, and short descriptions', () => {
	const categories = repoFile('src/data/tool-categories.ts');
	const eyebrows = repoFile('src/data/tools.ts');
	const streamCategory = categories.slice(categories.indexOf("id: 'stream'"));

	for (const id of streamToolIds) {
		const page = repoFile(`src/data/tools/${id}.astro`);
		assert.match(page, new RegExp(`path: '/de/tools/${id}/'`), `${id} German page`);
		assert.match(page, new RegExp(`path: '/en/tools/${id}/'`), `${id} English page`);
		assert.match(page, new RegExp(`<StreamToolEmbed tool=\\{tool\\} streamToolId="${id}" />`), `${id} embeds its own app`);
		assert.match(streamCategory, new RegExp(`'${id}'`), `${id} is listed in the stream category`);
		assert.match(eyebrows, new RegExp(`'${id}': \\{ de: '[^']+', en: '[^']+' \\}`), `${id} eyebrow`);

		for (const description of page.matchAll(/description: '([^']+)'/g)) {
			assert.ok(description[1].length <= 155, `${id} meta description is too long`);
		}
	}

	const categoryPage = repoFile('src/data/tools/stream.astro');
	assert.match(categoryPage, /path: '\/de\/tools\/stream\/'/);
	assert.match(categoryPage, /path: '\/en\/tools\/stream\/'/);
});

test('every stream tool has an app component whose raw sources exist', () => {
	assert.match(route, /streamTools\.map\(\(tool\) => \(\{ params: \{ tool: tool\.id \} \}\)\)/);

	for (const id of streamToolIds) {
		const app = appComponent(id);
		const raw = rawImports(app);
		const expected = app.source.includes('<KitToolApp') ? ['config', 'logic', 'css'] : ['css', 'js'];
		assert.deepEqual(Object.keys(raw).sort(), expected.sort(), `${id} raw imports`);
		assert.match(app.source, /title="[^"]+ · kw\.media"/, `${id} document title`);
	}
});

test('composed stream tool scripts compile and can be inlined safely', () => {
	for (const id of streamToolIds) {
		const script = composedScript(id);
		assert.doesNotThrow(() => new Function(script), `${id} script does not compile`);
		assert.doesNotMatch(script, /<\/script|<!--/i, `${id} script would break out of its inline <script>`);
		assert.doesNotMatch(script, /%%[A-Z_]+%%/, `${id} still has an old build placeholder`);
		assert.match(script, /KWM_BRAND\.light/, `${id} does not use the shared logos`);
	}
});

test('the kit honors the embed parameters the tool pages pass', () => {
	const core = repoFile('src/lib/tools/stream/kit/core.js');
	const css = repoFile('src/lib/tools/stream/kit/core.css');
	assert.match(core, /QS\.get\('lang'\)/);
	assert.match(core, /QS\.get\('embed'\)==='1'/);
	assert.match(css, /html\.embedded \.topbar \.brand/);

	for (const id of ['tier-list', 'stream-bingo']) {
		const script = composedScript(id);
		assert.match(script, /QS\.get\('lang'\)/, `${id} ignores ?lang=`);
		assert.match(script, /QS\.get\('embed'\)==='1'/, `${id} ignores ?embed=1`);
	}
});

test('the inlined brand assets come from public/', () => {
	const brand = repoFile('src/lib/tools/stream/brand.ts');
	const assets = [...brand.matchAll(/'([^']+\.(?:svg|png))'/g)].map((match) => match[1]);
	assert.deepEqual(assets, ['logo/logo-weiß.svg', 'logo/logo-schwarz.svg', 'favicon-32x32.png', 'logo/logo-weiß.svg']);
	for (const asset of assets) {
		assert.ok(existsSync(join(root, 'public', asset)), `public/${asset} is missing`);
	}

	const viewBox = /viewBox="([^"]+)"/.exec(repoFile('public/logo/logo-weiß.svg'))?.[1].split(/\s+/).map(Number);
	assert.equal(viewBox?.length, 4);
	assert.ok(viewBox[2] / viewBox[3] > 2 && viewBox[2] / viewBox[3] < 3.5, 'logo aspect ratio looks wrong');
});

test('the standalone app documents stay out of the sitemap', () => {
	assert.match(repoFile('astro.config.mjs'), /!page\.startsWith\(streamToolAppsUrl\)/);
	assert.match(repoFile(`${componentDir}/StreamToolHtml.astro`), /<meta name="robots" content="noindex" \/>/);
});
