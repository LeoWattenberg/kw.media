import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { convert, query } from 'pandoc-wasm';
import {
	DOCUMENT_OUTPUT_PROFILES,
	buildPandocOptions,
	buildPandocInputOptions,
	createTextPdf,
} from '../src/lib/tools/document-converter.js';

const markdown = '# Conversion test\n\nA paragraph with **bold text** and math $x^2 + y^2$.\n';

test('every document-converter target produces a non-empty output', async () => {
	const outputFormats = await query({ query: 'output-formats' });

	for (const profile of DOCUMENT_OUTPUT_PROFILES) {
		assert.ok(profile.pdf || outputFormats.includes(profile.format), `${profile.label} is supported by Pandoc`);
		const outputName = `output${profile.extension}`;
		const result = await convert({
			from: 'markdown',
			...buildPandocOptions(profile, outputName),
		}, markdown, {});

		if (profile.pdf) {
			const pdf = createTextPdf(result.stdout, 'Conversion test');
			const header = new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5));
			assert.equal(header, '%PDF-', `${profile.label} has a valid PDF header`);
			continue;
		}

		if (profile.binary) {
			const output = result.files[outputName];
			assert.ok(output instanceof Blob, `${profile.label} returns a Blob`);
			assert.ok(output.size > 0, `${profile.label} output is not empty`);
		} else {
			assert.ok(result.stdout.length > 0, `${profile.label} output is not empty`);
		}
	}
});

test('the real ODT fixture converts to HTML when Pandoc receives its input filename', async () => {
	const fileName = 'legal document.odt';
	const source = new Blob([await readFile(new URL(`../reference/${fileName}`, import.meta.url))]);
	const result = await convert({
		from: 'odt',
		...buildPandocInputOptions('odt', fileName),
		to: 'html',
		standalone: true,
	}, null, { [fileName]: source });

	assert.equal(result.stderr, '');
	assert.match(result.stdout, /<!DOCTYPE html>/i);
	assert.ok(result.stdout.length > 1000);
});

test('LaTeX output converts back into an HTML preview with native MathML', async () => {
	const latex = await convert({ from: 'markdown', to: 'latex' }, markdown, {});
	const preview = await convert({
		from: 'latex',
		to: 'html',
		standalone: true,
		'html-math-method': { method: 'mathml' },
	}, latex.stdout, {});

	assert.match(latex.stdout, /\\textbf\{bold text\}/);
	assert.match(preview.stdout, /<math[ >]/);
});
