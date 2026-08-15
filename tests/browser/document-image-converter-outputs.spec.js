import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAup3Fixture } from '../aup3-fixture.js';
import { cacheCdnAssets } from './cdn-cache.mjs';

// These tests assert the produced files, not the panels around them: every
// download link is fetched inside the page and its bytes are checked. Only
// committed fixtures are used as input so the expectations stay reproducible.
const fixtureBuffer = (name) => readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)));

const photoUpload = { name: 'tiny-photo.jpg', mimeType: 'image/jpeg', buffer: fixtureBuffer('tiny-photo.jpg') };
const markdownUpload = (name, body) => ({ name, mimeType: 'text/markdown', buffer: Buffer.from(body) });
const documentUpload = markdownUpload('conversion-test.md', '# Conversion test\n\nA paragraph with **bold text** and math $x^2 + y^2$.\n');
// DOCX embeds its images, so the missing chart survives only as its alt text; the
// HTML profile links the same reference and loses nothing.
const illustratedUpload = markdownUpload('quarterly-report.md', '# Report\n\nText before the chart.\n\n![Quarterly chart](chart.png)\n');
// A zip local-file header followed by junk: pandoc opens it as a DOCX container and fails inside it.
const corruptDocxUpload = {
	name: 'corrupt.docx',
	mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8]),
};

const documentOutputs = [
	{ value: 'html', download: 'conversion-test.html', type: 'text/html', includes: '<h1 id="conversion-test">Conversion test</h1>' },
	{ value: 'markdown', download: 'conversion-test.md', type: 'text/markdown', includes: '# Conversion test' },
	{ value: 'plain', download: 'conversion-test.txt', type: 'text/plain', includes: 'A paragraph with bold text' },
	{ value: 'pdf', download: 'conversion-test.pdf', type: 'application/pdf', header: '255044462d', includes: '%PDF-' },
	{ value: 'docx', download: 'conversion-test.docx', header: '504b0304', includes: 'word/document.xml' },
	{ value: 'odt', download: 'conversion-test.odt', header: '504b0304', includes: 'application/vnd.oasis.opendocument.text' },
	// Pandoc warns about the empty EPUB title for this fixture, and the tool now repeats that.
	{ value: 'epub', download: 'conversion-test.epub', header: '504b0304', includes: 'application/epub+zip', warns: true },
	{ value: 'latex', download: 'conversion-test.tex', type: 'text/x-tex', includes: '\\textbf{bold text}' },
	{ value: 'rtf', download: 'conversion-test.rtf', type: 'text/rtf', includes: '\\pard' },
];

// The select carries uppercase ImageMagick format names while the download keeps
// a lowercase extension, so both halves are asserted for every option.
const imageOutputs = [
	{ value: 'PNG', label: 'PNG', download: 'tiny-photo.png', type: 'image/png', signature: [[0, '89504e470d0a1a0a'], [12, '49484452'], [16, '00000060'], [20, '00000040']] },
	{ value: 'JPEG', label: 'JPEG', download: 'tiny-photo.jpg', type: 'image/jpeg', signature: [[0, 'ffd8ff']] },
	{ value: 'WEBP', label: 'WebP', download: 'tiny-photo.webp', type: 'image/webp', signature: [[0, '52494646'], [8, '57454250']] },
	{ value: 'AVIF', label: 'AVIF', download: 'tiny-photo.avif', type: 'image/avif', signature: [[4, '6674797061766966']] },
	{ value: 'GIF', label: 'GIF', download: 'tiny-photo.gif', type: 'image/gif', signature: [[0, '474946383961'], [6, '6000'], [8, '4000']] },
	{ value: 'TIFF', label: 'TIFF', download: 'tiny-photo.tiff', type: 'image/tiff', signature: [[0, '49492a00']] },
	{ value: 'BMP', label: 'BMP', download: 'tiny-photo.bmp', type: 'image/bmp', signature: [[0, '424d']] },
	{ value: 'ICO', label: 'ICO', download: 'tiny-photo.ico', type: 'image/x-icon', signature: [[0, '00000100'], [4, '0100'], [6, '6040']] },
];

const readDownload = (link) => link.evaluate(async (node) => {
	const response = await fetch(node.href);
	const bytes = new Uint8Array(await response.arrayBuffer());
	let text = '';
	for (let index = 0; index < bytes.length; index += 1) text += String.fromCharCode(bytes[index]);
	return {
		type: response.headers.get('content-type') || '',
		byteLength: bytes.byteLength,
		header: Array.from(bytes.subarray(0, 32)).map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		text,
	};
});

const readWavHeader = (link) => link.evaluate(async (node) => {
	const bytes = new Uint8Array(await (await fetch(node.href)).arrayBuffer());
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const ascii = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
	return {
		riff: ascii(0, 4),
		wave: ascii(8, 12),
		audioFormat: view.getUint16(20, true),
		channels: view.getUint16(22, true),
		sampleRate: view.getUint32(24, true),
		bitDepth: view.getUint16(34, true),
		data: ascii(36, 40),
		dataSize: view.getUint32(40, true),
		byteLength: bytes.byteLength,
	};
});

const decodeWav = (link) => link.evaluate(async (node) => {
	const buffer = await (await fetch(node.href)).arrayBuffer();
	const audio = await new OfflineAudioContext(1, 1, 48000).decodeAudioData(buffer);
	return {
		numberOfChannels: audio.numberOfChannels,
		sampleRate: audio.sampleRate,
		length: audio.length,
		samples: Array.from(audio.getChannelData(0)),
	};
});

const hexAt = (header, offset) => header.slice(offset * 2);

const occurrences = (text, needle) => text.split(needle).length - 1;

// A hand-built animated GIF: every frame is a single colour, and the LZW stream
// resets before each pixel so the code width never grows. It decodes to one frame
// per entry in `frames`, which no committed fixture provides.
const buildAnimatedGif = ({ width, height, frames }) => {
	const bytes = [];
	const pushUint16 = (value) => bytes.push(value & 0xff, (value >> 8) & 0xff);
	const pushAscii = (text) => bytes.push(...[...text].map((character) => character.charCodeAt(0)));

	pushAscii('GIF89a');
	pushUint16(width);
	pushUint16(height);
	bytes.push(0x80, 0x00, 0x00);
	bytes.push(0x00, 0x00, 0x00, 0xff, 0xff, 0xff);
	bytes.push(0x21, 0xff, 0x0b);
	pushAscii('NETSCAPE2.0');
	bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

	for (const colourIndex of frames) {
		bytes.push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x2c);
		pushUint16(0);
		pushUint16(0);
		pushUint16(width);
		pushUint16(height);
		bytes.push(0x00, 0x02);

		const codes = [];
		for (let pixel = 0; pixel < width * height; pixel += 1) codes.push(4, colourIndex);
		codes.push(5);

		const data = [];
		let bitBuffer = 0;
		let bitCount = 0;
		for (const code of codes) {
			bitBuffer |= code << bitCount;
			bitCount += 3;
			while (bitCount >= 8) {
				data.push(bitBuffer & 0xff);
				bitBuffer >>= 8;
				bitCount -= 8;
			}
		}
		if (bitCount > 0) data.push(bitBuffer & 0xff);

		for (let offset = 0; offset < data.length; offset += 255) {
			const block = data.slice(offset, offset + 255);
			bytes.push(block.length, ...block);
		}
		bytes.push(0x00);
	}

	bytes.push(0x3b);
	return Buffer.from(bytes);
};

const animatedGifUpload = {
	name: 'animated-loop.gif',
	mimeType: 'image/gif',
	buffer: buildAnimatedGif({ width: 12, height: 10, frames: [0, 1, 0, 1] }),
};

const collectPageErrors = (page) => {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
};

test.describe('document converter artifacts', () => {
	test('every target profile downloads bytes its own format is recognisable from', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/document-converter/');

		const converter = page.locator('[data-document-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');
		const profileSelect = converter.locator('[data-profile-select]');

		await expect(profileSelect).toBeDisabled();
		await converter.locator('[data-file-input]').setInputFiles(documentUpload);
		await expect(profileSelect).toBeEnabled();
		await expect(profileSelect).toHaveValue('html');
		await expect(converter.locator('[data-process]')).toBeEnabled();
		await expect(converter.locator('[data-file-name]')).toHaveText('conversion-test.md');

		for (const output of documentOutputs) {
			await profileSelect.selectOption(output.value);
			await converter.locator('[data-process]').click();
			await expect(download).toHaveAttribute('download', output.download, { timeout: 90_000 });
			await expect(status).toHaveText(
				output.warns ? /^The document was converted, but Pandoc reported: .+/ : 'The document was converted successfully.',
			);
			await expect(download).toBeVisible();

			const produced = await readDownload(download);
			expect(produced.byteLength, `${output.value} is not empty`).toBeGreaterThan(0);
			expect(produced.text.includes(output.includes), `${output.value} contains ${output.includes}`).toBe(true);
			if (output.header) {
				expect(hexAt(produced.header, 0).startsWith(output.header), `${output.value} magic bytes`).toBe(true);
			}
			if (output.type) {
				expect(produced.type, `${output.value} blob type`).toContain(output.type);
			}
		}

		expect(pageErrors).toEqual([]);
	});

	test('the download carries the document that was converted, and Reset clears the workspace', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/document-converter/');

		const converter = page.locator('[data-document-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');
		const fileInput = converter.locator('[data-file-input]');

		await fileInput.setInputFiles(markdownUpload('alpha.md', '# ALPHA CONTENT\n'));
		await converter.locator('[data-profile-select]').selectOption('html');
		await expect(converter.locator('[data-process]')).toBeEnabled();

		// The picker and Reset are locked for the whole run: a file swapped mid-conversion
		// used to rename the download while the bytes stayed those of the first document.
		const lockedDuringRun = await converter.evaluate((root) => {
			root.querySelector('[data-process]').click();
			return {
				fileInput: root.querySelector('[data-file-input]').disabled,
				clear: root.querySelector('[data-clear]').disabled,
				process: root.querySelector('[data-process]').disabled,
			};
		});
		expect(lockedDuringRun).toEqual({ fileInput: true, clear: true, process: true });

		await expect(status).toHaveText('The document was converted successfully.', { timeout: 90_000 });
		await expect(fileInput).toBeEnabled();
		await expect(converter.locator('[data-clear]')).toBeEnabled();
		await expect(download).toHaveAttribute('download', 'alpha.html');
		await expect(converter.locator('[data-result-title]')).toHaveText('Selected file: alpha.md');
		const alpha = await readDownload(download);
		expect(alpha.text).toContain('ALPHA CONTENT');

		await fileInput.setInputFiles(markdownUpload('bravo.md', '# BRAVO CONTENT\n'));
		await expect(download).toBeHidden();
		expect(await download.getAttribute('href')).toBeNull();
		await expect(status).toHaveText('Preparing file…');

		await converter.locator('[data-process]').click();
		await expect(download).toHaveAttribute('download', 'bravo.html', { timeout: 90_000 });
		const bravo = await readDownload(download);
		expect(bravo.text).toContain('BRAVO CONTENT');
		expect(bravo.text).not.toContain('ALPHA CONTENT');

		await converter.locator('[data-clear]').click();
		await expect(status).toHaveText('Choose a document to start.');
		await expect(status).toHaveAttribute('data-state', 'info');
		await expect(converter.locator('[data-converter-output]')).toBeHidden();
		await expect(converter.locator('[data-document-preview]')).toBeHidden();
		await expect(download).toBeHidden();
		expect(await download.getAttribute('href')).toBeNull();
		expect(await download.getAttribute('download')).toBeNull();
		await expect(converter.locator('[data-profile-select]')).toBeDisabled();
		await expect(converter.locator('[data-profile-select]')).toHaveValue('');
		await expect(converter.locator('[data-profile-select] option')).toHaveCount(1);
		await expect(converter.locator('[data-process]')).toBeDisabled();
		await expect(converter.locator('[data-file-name]')).toHaveText('Select a file');
		expect(await fileInput.inputValue()).toBe('');

		expect(pageErrors).toEqual([]);
	});

	test('a conversion that dropped an image says so instead of reporting a clean run', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/document-converter/');

		const converter = page.locator('[data-document-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');
		const profileSelect = converter.locator('[data-profile-select]');

		await converter.locator('[data-file-input]').setInputFiles(illustratedUpload);
		await profileSelect.selectOption('docx');
		await converter.locator('[data-process]').click();

		// Pandoc writes the DOCX either way, so the status line is the only place the
		// replaced image can be reported.
		await expect(download).toHaveAttribute('download', 'quarterly-report.docx', { timeout: 90_000 });
		await expect(status).toHaveText(
			'The document was converted, but Pandoc reported: Could not fetch resource chart.png: replacing image with description',
			{ timeout: 30_000 },
		);
		await expect(status).toHaveAttribute('data-state', 'info');
		await expect(download).toBeVisible();

		const docx = await readDownload(download);
		expect(hexAt(docx.header, 0).startsWith('504b0304')).toBe(true);
		expect(docx.text.includes('word/document.xml')).toBe(true);

		// The same file loses nothing on the way to HTML, and that run still reads as a
		// plain success.
		await profileSelect.selectOption('html');
		await converter.locator('[data-process]').click();
		await expect(download).toHaveAttribute('download', 'quarterly-report.html', { timeout: 90_000 });
		await expect(status).toHaveText('The document was converted successfully.', { timeout: 30_000 });
		await expect(status).toHaveAttribute('data-state', 'success');
		expect((await readDownload(download)).text).toContain('<img src="chart.png"');

		expect(pageErrors).toEqual([]);
	});

	test('the PDF result points at its download instead of an embed the sandbox blocks', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/document-converter/');

		const converter = page.locator('[data-document-converter]');
		const download = converter.locator('[data-download]');
		const htmlPreview = converter.locator('[data-html-preview]');
		const pdfNote = converter.locator('[data-pdf-preview-note]');

		await converter.locator('[data-file-input]').setInputFiles(documentUpload);
		await converter.locator('[data-profile-select]').selectOption('pdf');
		await converter.locator('[data-process]').click();
		await expect(download).toHaveAttribute('download', 'conversion-test.pdf', { timeout: 90_000 });

		await expect(converter.locator('[data-document-preview]')).toBeVisible({ timeout: 30_000 });
		await expect(pdfNote).toBeVisible();
		await expect(pdfNote).toHaveText('The PDF is finished and ready to download. It cannot be shown here.');
		await expect(htmlPreview).toBeHidden();
		expect(await htmlPreview.getAttribute('src')).toBeNull();

		// The frame keeps the sandbox that made the embed impossible in the first place.
		const sandbox = await htmlPreview.getAttribute('sandbox');
		expect(sandbox, 'the preview frame stays sandboxed').not.toBeNull();
		expect(sandbox).not.toContain('allow-');

		const pdf = await readDownload(download);
		expect(pdf.type).toContain('application/pdf');
		expect(pdf.text.startsWith('%PDF-')).toBe(true);
		expect(pdf.text).toMatch(/\/Type\s*\/Page[^s]/);

		// A format that can be previewed takes the frame back and drops the note.
		await converter.locator('[data-profile-select]').selectOption('html');
		await converter.locator('[data-process]').click();
		await expect(htmlPreview).toBeVisible({ timeout: 90_000 });
		await expect(pdfNote).toBeHidden();

		expect(pageErrors).toEqual([]);
	});

	test('a container Pandoc cannot open reports the reason Pandoc gave', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/document-converter/');

		const converter = page.locator('[data-document-converter]');
		const status = converter.locator('[data-status]');
		await converter.locator('[data-file-input]').setInputFiles(corruptDocxUpload);
		await converter.locator('[data-profile-select]').selectOption('html');
		await converter.locator('[data-process]').click();

		await expect(status).toHaveAttribute('data-state', 'error', { timeout: 90_000 });
		await expect(status).toContainText("couldn't unpack docx container");
		await expect(status).not.toContainText('Unknown error');
		await expect(converter.locator('[data-download]')).toBeHidden();
		await expect(converter.locator('[data-file-input]')).toBeEnabled();
		await expect(converter.locator('[data-process]')).toBeEnabled();

		expect(pageErrors).toEqual([]);
	});
});

test.describe('image format converter artifacts', () => {
	test('each target format writes a file that format can be read from', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/image-format-converter/');

		const converter = page.locator('[data-image-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');
		const formatSelect = converter.locator('[data-format]');

		await expect(formatSelect).toHaveValue('PNG');
		await expect(converter.locator('[data-convert]')).toBeDisabled();
		await converter.locator('[data-file]').setInputFiles(photoUpload);
		await expect(converter.locator('[data-source-preview]')).toBeVisible();
		await expect(converter.locator('[data-source-image]')).toBeVisible();
		await expect(converter.locator('[data-convert]')).toBeEnabled();

		for (const output of imageOutputs) {
			await formatSelect.selectOption(output.value);
			await converter.locator('[data-convert]').click();
			await expect(status).toHaveText(`${output.download} was created as ${output.label}.`, { timeout: 120_000 });
			await expect(download).toBeVisible();
			await expect(download).toHaveAttribute('download', output.download);
			await expect(converter.locator('[data-output-format]')).toHaveText(output.label);
			await expect(converter.locator('[data-output-meta]')).toContainText('96 x 64px');
			await expect(converter.locator('[data-output-meta]')).toContainText('1 frame');

			const produced = await readDownload(download);
			expect(produced.type, `${output.value} blob type`).toBe(output.type);
			for (const [offset, expected] of output.signature) {
				expect(hexAt(produced.header, offset).startsWith(expected), `${output.value} bytes at ${offset}`).toBe(true);
			}

			// Only the formats the browser itself decodes are expected to preview.
			if (output.value === 'PNG' || output.value === 'JPEG') {
				await expect(converter.locator('[data-result]')).toBeVisible();
				await expect(converter.locator('[data-output-image]')).toBeVisible();
				await expect(converter.locator('[data-output-preview-note]')).toBeHidden();
			}
		}

		expect(pageErrors).toEqual([]);
	});

	test('the result panel counts the frames of the written file, not of the source', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/image-format-converter/');

		const converter = page.locator('[data-image-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');
		const outputMeta = converter.locator('[data-output-meta]');

		await converter.locator('[data-file]').setInputFiles(animatedGifUpload);
		await expect(converter.locator('[data-convert]')).toBeEnabled();

		// PNG cannot hold the four source frames, and the panel describes the PNG.
		await converter.locator('[data-format]').selectOption('PNG');
		await converter.locator('[data-convert]').click();
		await expect(status).toHaveText('animated-loop.png was created as PNG.', { timeout: 120_000 });
		await expect(outputMeta).toContainText('12 x 10px');
		await expect(outputMeta).toContainText('1 frame');
		await expect(outputMeta).not.toContainText('4 frames');

		const png = await readDownload(download);
		expect(hexAt(png.header, 0).startsWith('89504e470d0a1a0a')).toBe(true);
		expect(hexAt(png.header, 12).startsWith('49484452'), 'IHDR').toBe(true);
		expect(hexAt(png.header, 16).startsWith('0000000c'), 'PNG width 12').toBe(true);
		expect(hexAt(png.header, 20).startsWith('0000000a'), 'PNG height 10').toBe(true);
		expect(occurrences(png.text, 'IHDR'), 'a single PNG image').toBe(1);
		expect(png.text.includes('acTL'), 'not an animated PNG').toBe(false);

		// GIF keeps every frame, so the same source is reported differently.
		await converter.locator('[data-format]').selectOption('GIF');
		await converter.locator('[data-convert]').click();
		await expect(status).toHaveText('animated-loop.gif was created as GIF.', { timeout: 120_000 });
		await expect(outputMeta).toContainText('12 x 10px');
		await expect(outputMeta).toContainText('4 frames');

		const gif = await readDownload(download);
		expect(hexAt(gif.header, 0).startsWith('474946383961')).toBe(true);
		expect(hexAt(gif.header, 6).startsWith('0c00'), 'GIF width 12').toBe(true);
		expect(hexAt(gif.header, 8).startsWith('0a00'), 'GIF height 10').toBe(true);
		// 0x21 0xF9 introduces a graphic control extension: one per animation frame.
		expect(occurrences(gif.text, '!ù'), 'four graphic control extensions').toBe(4);

		expect(pageErrors).toEqual([]);
	});

	test('the quality slider changes the encoded JPEG, and the preview toggle and Clear undo the result', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/image-format-converter/');

		const converter = page.locator('[data-image-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');
		const quality = converter.locator('[data-quality]');

		await converter.locator('[data-file]').setInputFiles(photoUpload);
		await expect(converter.locator('[data-quality-control]')).toBeHidden();
		await converter.locator('[data-format]').selectOption('JPEG');
		await expect(converter.locator('[data-quality-control]')).toBeVisible();
		await expect(converter.locator('[data-quality-label]')).toHaveText('90');

		await quality.fill('5');
		await expect(converter.locator('[data-quality-label]')).toHaveText('5');
		await converter.locator('[data-convert]').click();
		await expect(status).toHaveText('tiny-photo.jpg was created as JPEG.', { timeout: 120_000 });
		const lowQuality = await readDownload(download);
		expect(hexAt(lowQuality.header, 0).startsWith('ffd8ff')).toBe(true);

		// Both runs end on the same status line, so the second result is recognised by its
		// fresh object URL: the link keeps no href while a conversion is in flight.
		const lowQualityHref = await download.getAttribute('href');
		await quality.fill('95');
		await expect(converter.locator('[data-quality-label]')).toHaveText('95');
		await converter.locator('[data-convert]').click();
		await expect
			.poll(async () => {
				const href = await download.getAttribute('href');
				return href && href !== lowQualityHref ? 'converted' : 'pending';
			}, { timeout: 120_000 })
			.toBe('converted');
		await expect(status).toHaveText('tiny-photo.jpg was created as JPEG.');
		await expect(download).toBeVisible();

		const highQuality = await readDownload(download);
		expect(hexAt(highQuality.header, 0).startsWith('ffd8ff')).toBe(true);
		expect(highQuality.byteLength).toBeGreaterThan(lowQuality.byteLength);

		const previewToggle = converter.locator('[data-preview-toggle]');
		await expect(previewToggle).toBeVisible();
		await expect(previewToggle).toHaveText('Show original');
		await expect(converter.locator('[data-result]')).toBeVisible();
		await expect(converter.locator('[data-source-preview]')).toBeHidden();

		await previewToggle.click();
		await expect(converter.locator('[data-source-preview]')).toBeVisible();
		await expect(converter.locator('[data-result]')).toBeHidden();
		await expect(previewToggle).toHaveText('Show converted image');
		await previewToggle.click();
		await expect(converter.locator('[data-result]')).toBeVisible();
		await expect(converter.locator('[data-source-preview]')).toBeHidden();
		await expect(previewToggle).toHaveText('Show original');

		await converter.locator('[data-clear]').click();
		await expect(status).toHaveText('The file has been cleared.');
		await expect(status).toHaveAttribute('data-state', 'info');
		await expect(converter.locator('[data-result]')).toBeHidden();
		await expect(download).toBeHidden();
		expect(await download.getAttribute('href')).toBeNull();
		await expect(previewToggle).toBeHidden();
		await expect(converter.locator('[data-source-preview]')).toBeHidden();
		await expect(converter.locator('[data-file-name]')).toHaveText('Choose image file');
		await expect(converter.locator('[data-convert]')).toBeDisabled();
		expect(await converter.locator('[data-file]').inputValue()).toBe('');

		expect(pageErrors).toEqual([]);
	});

	test('a jsDelivr connection that never answers still gives the tool back after 90 seconds', async ({ page }) => {
		// The status copy promises a 90-second budget, so this test has to wait it out:
		// a stalled module request used to leave every control disabled forever.
		test.setTimeout(180_000);
		let releaseStalledRequests = () => {};
		const stalled = new Promise((resolve) => {
			releaseStalledRequests = resolve;
		});
		await page.route('https://cdn.jsdelivr.net/**', async (route) => {
			await stalled;
			await route.abort();
		});
		await page.goto('/en/tools/converter/image-format-converter/');

		const converter = page.locator('[data-image-converter]');
		const status = converter.locator('[data-status]');
		await converter.locator('[data-file]').setInputFiles(photoUpload);
		await converter.locator('[data-convert]').click();
		await expect(status).toHaveText('Loading ImageMagick WASM...');
		await expect(converter.locator('[data-convert]')).toBeDisabled();
		await expect(converter.locator('[data-file]')).toBeDisabled();

		await expect(status).toHaveText(
			'ImageMagick WASM did not finish loading within 90 seconds. Check your connection and try again.',
			{ timeout: 150_000 },
		);
		await expect(status).toHaveAttribute('data-state', 'error');
		await expect(converter.locator('[data-convert]')).toBeEnabled();
		await expect(converter.locator('[data-file]')).toBeEnabled();
		await expect(converter.locator('[data-clear]')).toBeEnabled();
		await expect(converter.locator('[data-format]')).toBeEnabled();

		releaseStalledRequests();
	});
});

test.describe('AUP3 to WAV artifacts', () => {
	test('the 32-bit float option writes an IEEE float WAV holding the project samples', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		const samples = [0, 0.5, -0.5, 1, -1, 0.125];
		const fixture = await createAup3Fixture({ tracks: [{ name: 'Ramp', clips: [{ samples }] }] });
		await page.goto('/en/tools/converter/aup3-to-wav/');

		const converter = page.locator('[data-aup3-wav-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');

		await converter.locator('[data-file-input]').setInputFiles({
			name: 'float mix.aup3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(fixture),
		});
		await expect(status).toHaveText('float mix.aup3 is ready for local conversion.');
		await converter.locator('[data-format]').selectOption('float32');
		await converter.locator('[data-convert]').click();

		await expect(status).toHaveText('The dry WAV mix is ready.', { timeout: 60_000 });
		await expect(converter.locator('[data-warnings]')).toBeHidden();
		await expect(converter.locator('[data-result-title]')).toHaveText('float mix');
		await expect(converter.locator('[data-result-meta]')).toContainText('48,000 Hz');
		await expect(converter.locator('[data-result-meta]')).toContainText('1 channel');
		await expect(converter.locator('[data-result-meta]')).toContainText('1 track');
		await expect(converter.locator('[data-result-meta]')).toContainText('32-bit float');
		await expect(download).toHaveAttribute('download', 'float mix.wav');

		expect(await readWavHeader(download)).toEqual({
			riff: 'RIFF',
			wave: 'WAVE',
			audioFormat: 3,
			channels: 1,
			sampleRate: 48_000,
			bitDepth: 32,
			data: 'data',
			dataSize: samples.length * 4,
			byteLength: 44 + samples.length * 4,
		});

		const decoded = await decodeWav(download);
		expect(decoded.numberOfChannels).toBe(1);
		expect(decoded.sampleRate).toBe(48_000);
		expect(decoded.length).toBe(samples.length);
		for (const [index, expected] of samples.entries()) {
			expect(decoded.samples[index], `sample ${index}`).toBeCloseTo(expected, 5);
		}
		expect(Math.max(...decoded.samples.map(Math.abs))).toBeGreaterThan(0);

		expect(pageErrors).toEqual([]);
	});

	test('changing the audio format drops the stale mix and Reset restores the start state', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		const fixture = await createAup3Fixture();
		await page.goto('/en/tools/converter/aup3-to-wav/');

		const converter = page.locator('[data-aup3-wav-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');
		const formatSelect = converter.locator('[data-format]');

		await converter.locator('[data-file-input]').setInputFiles({
			name: 'session.aup3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(fixture),
		});
		await expect(formatSelect).toHaveValue('pcm16');
		await converter.locator('[data-convert]').click();
		await expect(status).toHaveText('The dry WAV mix is ready.', { timeout: 60_000 });
		await expect(download).toHaveAttribute('download', 'session.wav');
		expect(await readWavHeader(download)).toMatchObject({ audioFormat: 1, bitDepth: 16, byteLength: 52 });

		await formatSelect.selectOption('float32');
		await expect(converter.locator('[data-output]')).toBeHidden();
		await expect(download).toBeHidden();
		expect(await download.getAttribute('href')).toBeNull();
		expect(await download.getAttribute('download')).toBeNull();
		await expect(converter.locator('[data-output-audio]')).toBeHidden();
		expect(await converter.locator('[data-output-audio]').getAttribute('src')).toBeNull();
		await expect(status).toHaveText('session.aup3 is ready for local conversion.');

		await converter.locator('[data-reset]').click();
		await expect(status).toHaveText('Choose a saved AUP3 project.');
		await expect(status).toHaveAttribute('data-state', 'info');
		await expect(formatSelect).toHaveValue('pcm16');
		await expect(converter.locator('[data-convert]')).toBeDisabled();
		await expect(converter.locator('[data-file-name]')).toHaveText('Choose AUP3 project');
		await expect(converter.locator('[data-output]')).toBeHidden();
		await expect(converter.locator('[data-warning-list] li')).toHaveCount(0);
		expect(await converter.locator('[data-file-input]').inputValue()).toBe('');

		expect(pageErrors).toEqual([]);
	});

	test('conversion notes list the Audacity features that were not rendered', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		const noisy = await createAup3Fixture({
			realtimeEffect: true,
			tracks: [{ name: 'Effects track', clips: [{ samples: [0.5, -0.5, 0.25, -0.25], envelope: true }] }],
		});
		const clean = await createAup3Fixture();
		await page.goto('/en/tools/converter/aup3-to-wav/');

		const converter = page.locator('[data-aup3-wav-converter]');
		const status = converter.locator('[data-status]');
		const fileInput = converter.locator('[data-file-input]');

		await fileInput.setInputFiles({
			name: 'effects.aup3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(noisy),
		});
		await converter.locator('[data-convert]').click();
		await expect(status).toHaveText('The dry WAV mix is ready. Review the conversion notes.', { timeout: 60_000 });
		await expect(converter.locator('[data-warnings]')).toBeVisible();
		await expect(converter.locator('[data-warning-list] li')).toHaveText([
			'Audacity realtime and master effects were not rendered.',
			'Clip volume envelopes were not rendered.',
		]);
		await expect(converter.locator('[data-download]')).toHaveAttribute('download', 'effects.wav');

		await fileInput.setInputFiles({
			name: 'clean.aup3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(clean),
		});
		await expect(converter.locator('[data-warnings]')).toBeHidden();
		await converter.locator('[data-convert]').click();
		await expect(status).toHaveText('The dry WAV mix is ready.', { timeout: 60_000 });
		await expect(converter.locator('[data-warnings]')).toBeHidden();
		await expect(converter.locator('[data-warning-list] li')).toHaveCount(0);

		expect(pageErrors).toEqual([]);
	});

	test('the WAV download drops the .aup3 suffix and nothing else', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		const fixture = await createAup3Fixture();
		await page.goto('/en/tools/converter/aup3-to-wav/');

		const converter = page.locator('[data-aup3-wav-converter]');
		const download = converter.locator('[data-download]');

		await converter.locator('[data-file-input]').setInputFiles({
			name: 'live.set.2.aup3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(fixture),
		});
		await converter.locator('[data-convert]').click();

		// The tool now names the file with the shared aup3OutputName helper, which
		// strips the .aup3 suffix rather than whatever follows the last dot.
		await expect(converter.locator('[data-status]')).toHaveText('The dry WAV mix is ready.', { timeout: 60_000 });
		await expect(download).toHaveAttribute('download', 'live.set.2.wav');
		expect(await readWavHeader(download)).toMatchObject({ riff: 'RIFF', wave: 'WAVE', audioFormat: 1, bitDepth: 16 });

		expect(pageErrors).toEqual([]);
	});

	test('a finished mix survives the pagehide that precedes a back-forward cache restore', async ({ page }) => {
		test.setTimeout(180_000);
		const pageErrors = collectPageErrors(page);
		const fixture = await createAup3Fixture();
		await page.goto('/en/tools/converter/aup3-to-wav/');

		const converter = page.locator('[data-aup3-wav-converter]');
		const status = converter.locator('[data-status]');
		const download = converter.locator('[data-download]');

		await converter.locator('[data-file-input]').setInputFiles({
			name: 'kept.aup3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(fixture),
		});
		await converter.locator('[data-convert]').click();
		await expect(status).toHaveText('The dry WAV mix is ready.', { timeout: 60_000 });

		// Chromium under Playwright keeps the back-forward cache off, so the restore is
		// simulated by the event a bfcache entry fires: the result has to outlive it.
		await page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
		});
		await expect(status).toHaveText('The dry WAV mix is ready.');
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(converter.locator('[data-output]')).toBeVisible();
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'kept.wav');
		expect(await readWavHeader(download)).toMatchObject({ riff: 'RIFF', wave: 'WAVE', byteLength: 52 });

		// A real teardown still releases the object URL and the result panel.
		await page.evaluate(() => {
			window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
		});
		await expect(converter.locator('[data-output]')).toBeHidden();
		await expect(download).toBeHidden();
		expect(await download.getAttribute('href')).toBeNull();

		expect(pageErrors).toEqual([]);
	});
});
