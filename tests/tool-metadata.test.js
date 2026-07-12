import test from 'node:test';
import assert from 'node:assert/strict';

import {
	fitMetaDescription,
	generatedDescriptionValue,
	loadToolCandidates,
	parseAstroToolCandidates,
	parseJsonResponse,
	readGeneratedToolMetadata,
	requestOllamaJson,
	validMetaDescription,
} from '../scripts/tool-metadata.mjs';

test('tool metadata parser finds translated Astro page metadata', () => {
	const source = `translations: {
		de: { path: '/de/tools/demo/', title: 'Demo Werkzeug', description: 'Kurze Beschreibung.' },
		en: { path: '/en/tools/demo/', title: 'Demo Tool', description: 'Short description.' },
	}`;
	assert.deepEqual(parseAstroToolCandidates(source, '/repo/demo.astro').map(({ path, title, locale }) => ({ path, title, locale })), [
		{ path: '/de/tools/demo/', title: 'Demo Werkzeug', locale: 'de' },
		{ path: '/en/tools/demo/', title: 'Demo Tool', locale: 'en' },
	]);
});

test('Ollama JSON requests retry validation failures instead of aborting the workflow', async () => {
	const originalFetch = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = async () => {
		calls += 1;
		return new Response(JSON.stringify({
			response: JSON.stringify({ description: calls === 1 ? 'Too short' : 'A'.repeat(110) }),
		}), { status: 200, headers: { 'content-type': 'application/json' } });
	};

	try {
		const result = await requestOllamaJson({
			ollamaUrl: 'http://ollama.test',
			model: 'test',
			prompt: 'Return JSON',
			validate: (value) => validMetaDescription(value.description),
		});
		assert.equal(result.description.length, 110);
		assert.equal(calls, 2);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('tool candidate inventory gives every virtual converter its own metadata candidate', async () => {
	const candidates = await loadToolCandidates();
	const png = candidates.find((candidate) => candidate.path === '/en/tools/converters/image-to-png/');
	const jpeg = candidates.find((candidate) => candidate.path === '/en/tools/converters/image-to-jpeg/');
	assert.equal(png?.title, 'Image to PNG');
	assert.equal(jpeg?.title, 'Image to JPEG');
	assert.notEqual(png?.path, jpeg?.path);
	assert.equal(png?.virtual, true);
	assert.equal(jpeg?.virtual, true);
	assert.equal(png?.metadataFile, 'converter/virtual-converters.json');
	assert.equal(candidates.find((candidate) => candidate.path === '/en/tools/audio-analyzer/')?.metadataFile, 'audio-analyzer.json');
});

test('split tool metadata sidecars load as one page-path registry', async () => {
	const metadata = await readGeneratedToolMetadata();

	assert.ok(Object.keys(metadata).length > 100);
	assert.ok(metadata['/en/tools/abx-tester/']?.description);
	assert.ok(metadata['/en/tools/converters/image-to-png/']?.content?.length);
});

test('tool description validation accepts fenced JSON recovery and strict SEO lengths', () => {
	assert.deepEqual(parseJsonResponse('```json\n{"description":"Valid"}\n```'), { description: 'Valid' });
	assert.equal(validMetaDescription('A'.repeat(109)), false);
	assert.equal(validMetaDescription('A'.repeat(110)), true);
	assert.equal(validMetaDescription('A'.repeat(155)), true);
	assert.equal(validMetaDescription('A'.repeat(156)), false);
});

test('tool descriptions recover common keys and fit overlong model output', () => {
	const parsed = { meta_description: `A useful browser tool for creators that ${'keeps the workflow clear and focused '.repeat(5)}` };
	const fitted = fitMetaDescription(generatedDescriptionValue(parsed), { title: 'Demo Tool', locale: 'en' });

	assert.equal(validMetaDescription(fitted), true);
	assert.ok(fitted.length <= 155);
});

test('short tool descriptions are completed with verified browser context', () => {
	const fitted = fitMetaDescription('Convert creator files locally and clearly.', { title: 'Demo Converter', locale: 'en' });

	assert.equal(validMetaDescription(fitted), true);
	assert.match(fitted, /^Demo Converter:/);
});
