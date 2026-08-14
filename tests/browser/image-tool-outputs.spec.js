import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cacheCdnAssets } from './cdn-cache.mjs';

// Tools that pull ImageMagick WASM, MediaPipe or ImageTracer replay those bundles
// from .cache/ through cacheCdnAssets(), but a cold cache still has to fetch and
// store them, so those tests get their own budget instead of the 30 s default.
const CDN_TIMEOUT = 180_000;
const RUN_TIMEOUT = 120_000;

const fixtureFile = (name, mimeType) => ({
	name,
	mimeType,
	buffer: readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))),
});

/* 96x64: a blue-to-orange gradient with a white circle of radius 18 at (48, 32). */
const photoFixture = () => fixtureFile('tiny-photo.png', 'image/png');

/*
 * Paints a source inside the page and hands it to a picker as a real File, the way
 * scripts/generate-test-fixtures.mjs mints the committed fixtures: canvas.toBlob
 * writes genuine PNG bytes, so the tools decode real images and never a stub.
 */
const paintFile = (locator, spec) => locator.evaluate(async (input, options) => {
	const canvas = document.createElement('canvas');
	canvas.width = options.width;
	canvas.height = options.height;
	const context = canvas.getContext('2d');
	context.fillStyle = options.background;
	context.fillRect(0, 0, options.width, options.height);

	for (const shape of options.shapes || []) {
		context.fillStyle = shape.color;
		if (shape.type === 'circle') {
			context.beginPath();
			context.arc(shape.x, shape.y, shape.radius, 0, Math.PI * 2);
			context.fill();
		} else {
			context.fillRect(shape.x, shape.y, shape.width, shape.height);
		}
	}

	const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
	const transfer = new DataTransfer();
	transfer.items.add(new File([blob], options.name, { type: 'image/png' }));
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}, spec);

/* Range and color inputs are driven through the events the tools listen for. */
const setValue = (locator, value) => locator.evaluate((input, next) => {
	input.value = next;
	input.dispatchEvent(new Event('input', { bubbles: true }));
	input.dispatchEvent(new Event('change', { bubbles: true }));
}, String(value));

/* Waits for a re-render: the link only carries a fresh blob URL once a run finished. */
const waitForNewHref = async (link, previous, timeout = RUN_TIMEOUT) => {
	await expect.poll(async () => {
		const next = await link.getAttribute('href');
		return Boolean(next && next !== previous);
	}, { timeout }).toBe(true);

	return link.getAttribute('href');
};

/*
 * Reads a produced artifact back the way the AUP3 test does: fetch the blob URL
 * inside the page, keep the container bytes for the magic number, and decode the
 * image so assertions can talk about pixels instead of a visible download link.
 */
const inspectImage = (page, source, options = {}) => page.evaluate(async ({ source: from, options: settings }) => {
	const bytes = from.href
		? new Uint8Array(await (await fetch(from.href)).arrayBuffer())
		: Uint8Array.from(atob(from.base64), (character) => character.charCodeAt(0));
	const bitmap = await createImageBitmap(new Blob([bytes]));
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	context.drawImage(bitmap, 0, 0);
	const data = context.getImageData(0, 0, bitmap.width, bitmap.height).data;
	let colorMatches = 0;

	if (settings.color) {
		const [red, green, blue] = settings.color;
		const tolerance = settings.tolerance || 0;
		for (let index = 0; index < data.length; index += 4) {
			const hit = Math.abs(data[index] - red) <= tolerance
				&& Math.abs(data[index + 1] - green) <= tolerance
				&& Math.abs(data[index + 2] - blue) <= tolerance
				&& data[index + 3] === 255;
			if (hit) colorMatches += 1;
		}
	}

	return {
		head: [...bytes.subarray(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		ascii: String.fromCharCode(...bytes.subarray(0, 12)),
		byteLength: bytes.byteLength,
		width: bitmap.width,
		height: bitmap.height,
		colorMatches,
		pixels: (settings.points || []).map(([x, y]) => {
			const index = (y * bitmap.width + x) * 4;
			return [data[index], data[index + 1], data[index + 2], data[index + 3]];
		}),
	};
}, { source, options });

/* Counts pixels that differ between two same-sized images inside a region. */
const differingPixels = (page, first, second, region) => page.evaluate(async ({ first: a, second: b, region: box }) => {
	const load = async (from) => {
		const bytes = from.href
			? new Uint8Array(await (await fetch(from.href)).arrayBuffer())
			: Uint8Array.from(atob(from.base64), (character) => character.charCodeAt(0));
		const bitmap = await createImageBitmap(new Blob([bytes]));
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d', { willReadFrequently: true });
		context.drawImage(bitmap, 0, 0);
		return { width: bitmap.width, height: bitmap.height, data: context.getImageData(0, 0, bitmap.width, bitmap.height).data };
	};

	const left = await load(a);
	const right = await load(b);

	if (left.width !== right.width || left.height !== right.height) {
		throw new Error(`size mismatch: ${left.width}x${left.height} vs ${right.width}x${right.height}`);
	}

	const [x0, y0, width, height] = box || [0, 0, left.width, left.height];
	let differences = 0;

	for (let y = y0; y < y0 + height; y += 1) {
		for (let x = x0; x < x0 + width; x += 1) {
			const index = (y * left.width + x) * 4;
			const changed = left.data[index] !== right.data[index]
				|| left.data[index + 1] !== right.data[index + 1]
				|| left.data[index + 2] !== right.data[index + 2]
				|| left.data[index + 3] !== right.data[index + 3];
			if (changed) differences += 1;
		}
	}

	return differences;
}, { first, second, region });

/* Uncaught exceptions only: the watermark picker used to throw on every selection. */
function collectPageErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
}

test.describe('image tool outputs', () => {
	test('Watermarker burns a chosen watermark image into the exported PNG', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/image-video-watermark/');
		const tool = page.locator('[data-watermarker]');

		await tool.locator('[data-source-file]').setInputFiles(photoFixture());
		await expect(tool.locator('[data-source-name]')).toHaveText('tiny-photo.png');
		await expect(tool.locator('[data-status]')).toContainText('tiny-photo.png is selected');

		await tool.locator('[data-mode]').selectOption('image');
		await expect(tool.locator('[data-image-group]')).toBeVisible();
		await expect(tool.locator('[data-text-group]')).toBeHidden();
		await expect(tool.locator('[data-color-group]')).toBeHidden();
		await expect(tool.locator('[data-process]')).toBeDisabled();

		await paintFile(tool.locator('[data-watermark-file]'), {
			name: 'stamp.png',
			width: 40,
			height: 40,
			background: '#ff00ff',
		});

		/* Selecting a watermark used to throw here, so the tool never armed itself. */
		await expect(tool.locator('[data-watermark-name]')).toHaveText('stamp.png');
		await expect(tool.locator('[data-status]')).toHaveText('stamp.png will be used as the watermark.');
		await expect(tool.locator('[data-process]')).toBeEnabled();

		await setValue(tool.locator('[data-opacity]'), 100);
		await setValue(tool.locator('[data-size]'), 30);
		await setValue(tool.locator('[data-margin]'), 10);
		await tool.locator('[data-position]').selectOption('center');
		await expect(tool.locator('[data-opacity-label]')).toHaveText('100%');
		await expect(tool.locator('[data-size-label]')).toHaveText('30%');
		await expect(tool.locator('[data-margin-label]')).toHaveText('10%');

		await tool.locator('[data-process]').click();
		await expect(tool.locator('[data-status]')).toHaveText('The watermarked image is ready.', { timeout: 30_000 });
		await expect(tool.locator('[data-output-preview]')).toBeVisible();
		await expect(tool.locator('[data-output-image]')).toBeVisible();
		await expect(tool.locator('[data-output-video]')).toBeHidden();
		await expect(tool.locator('[data-output-details]')).toContainText('96 x 64px');

		const download = tool.locator('[data-download]');
		await expect(download).toHaveAttribute('download', 'tiny-photo.png');
		const href = await download.getAttribute('href');
		/* A 30% stamp is centred over a 96x64 source, so (48, 32) is stamp, (2, 2) is not. */
		const output = await inspectImage(page, { href }, { points: [[48, 32], [2, 2]] });
		const base64 = photoFixture().buffer.toString('base64');
		const source = await inspectImage(page, { base64 }, { points: [[48, 32], [2, 2]] });

		expect(output.head.startsWith('89504e47')).toBe(true);
		expect({ width: output.width, height: output.height }).toEqual({ width: 96, height: 64 });
		expect(source.pixels[0]).toEqual([255, 255, 255, 255]);
		expect(output.pixels[0]).toEqual([255, 0, 255, 255]);
		expect(output.pixels[1]).toEqual(source.pixels[1]);
		expect(await differingPixels(page, { base64 }, { href })).toBeGreaterThan(400);

		expect(errors).toEqual([]);
	});

	test('Watermarker text controls change the exported pixels and Reset clears the run', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/image-video-watermark/');
		const tool = page.locator('[data-watermarker]');
		const download = tool.locator('[data-download]');
		const base64 = photoFixture().buffer.toString('base64');

		await tool.locator('[data-source-file]').setInputFiles(photoFixture());
		await expect(tool.locator('[data-process]')).toBeEnabled();

		await tool.locator('[data-watermark-text]').fill('');
		await expect(tool.locator('[data-process]')).toBeDisabled();
		await tool.locator('[data-watermark-text]').fill('kw.media');
		await expect(tool.locator('[data-process]')).toBeEnabled();

		await setValue(tool.locator('[data-opacity]'), 100);
		await setValue(tool.locator('[data-watermark-color]'), '#ff0000');
		await tool.locator('[data-position]').selectOption('bottom-right');
		await tool.locator('[data-process]').click();
		await expect(tool.locator('[data-status]')).toHaveText('The watermarked image is ready.', { timeout: 30_000 });

		const plainHref = await download.getAttribute('href');
		const plain = await inspectImage(page, { href: plainHref }, { color: [255, 0, 0], tolerance: 40 });
		const sourceRed = await inspectImage(page, { base64 }, { color: [255, 0, 0], tolerance: 40 });

		expect(plain.head.startsWith('89504e47')).toBe(true);
		/* The chosen text color has to reach the file: the source carries no red at all. */
		expect(sourceRed.colorMatches).toBe(0);
		expect(plain.colorMatches).toBeGreaterThan(0);
		/* Bottom-right placement cannot reach the top-left quadrant. */
		expect(await differingPixels(page, { base64 }, { href: plainHref }, [0, 0, 48, 32])).toBe(0);

		await tool.locator('[data-tile]').check();
		await tool.locator('[data-process]').click();
		await expect(tool.locator('[data-status]')).toHaveText('The watermarked image is ready.', { timeout: 30_000 });
		const tiledHref = await waitForNewHref(download, plainHref, 30_000);
		/* Repeating has to cover the areas a single placement never touches. */
		expect(await differingPixels(page, { base64 }, { href: tiledHref }, [0, 0, 48, 32])).toBeGreaterThan(0);

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-status]')).toHaveText('The tool has been reset.');
		await expect(tool.locator('[data-output-preview]')).toBeHidden();
		await expect(download).toBeHidden();
		await expect(tool.locator('[data-source-name]')).toHaveText('Choose image or video');
		await expect(tool.locator('[data-process]')).toBeDisabled();

		expect(errors).toEqual([]);
	});

	test('Object extractor keeps the clicked object and drops the background', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		const errors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/image-object-extractor/');
		const tool = page.locator('[data-object-extractor]');

		await paintFile(tool.locator('[data-file]'), {
			name: 'disc.png',
			width: 512,
			height: 512,
			background: '#ffffff',
			shapes: [{ type: 'circle', x: 256, y: 256, radius: 140, color: '#d62828' }],
		});
		await expect(tool.locator('[data-canvas-wrap]')).toBeVisible();
		await expect(tool.locator('[data-file-name]')).toHaveText('disc.png');

		await setValue(tool.locator('[data-threshold]'), 50);
		await setValue(tool.locator('[data-feather]'), 0);
		await expect(tool.locator('[data-threshold-label]')).toHaveText('50%');
		await expect(tool.locator('[data-feather-label]')).toHaveText('0px');

		await tool.locator('[data-canvas]').click();
		await expect(tool.locator('[data-target]')).toBeVisible();
		await expect(tool.locator('[data-status]')).toHaveText('Point selected. Ready to extract.');
		await expect(tool.locator('[data-cut]')).toBeEnabled();

		await tool.locator('[data-cut]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Object extracted.', { timeout: RUN_TIMEOUT });
		await expect(tool.locator('[data-result-panel]')).toBeVisible();
		await expect(tool.locator('[data-result-image]')).toBeVisible();

		const download = tool.locator('[data-download]');
		await expect(download).toHaveAttribute('download', 'cut-object.png');
		const pngHref = await download.getAttribute('href');
		/* The clicked disc must survive and the far corners must be cut away, not the reverse. */
		const png = await inspectImage(page, { href: pngHref }, { points: [[256, 256], [6, 6], [505, 505]] });

		expect(png.head.startsWith('89504e47')).toBe(true);
		expect({ width: png.width, height: png.height }).toEqual({ width: 512, height: 512 });
		expect(png.pixels[0][3]).toBe(255);
		expect(png.pixels[1][3]).toBe(0);
		expect(png.pixels[2][3]).toBe(0);

		await tool.locator('[data-format]').selectOption('image/webp');
		await tool.locator('[data-cut]').click();
		await expect(download).toHaveAttribute('download', 'cut-object.webp', { timeout: RUN_TIMEOUT });
		const webpHref = await download.getAttribute('href');
		const webp = await inspectImage(page, { href: webpHref }, { points: [[256, 256], [6, 6]] });

		expect(webp.ascii.startsWith('RIFF')).toBe(true);
		expect(webp.ascii.slice(8, 12)).toBe('WEBP');
		expect(webp.pixels[0][3]).toBe(255);
		expect(webp.pixels[1][3]).toBe(0);

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Choose an image, then click the object.');
		await expect(tool.locator('[data-canvas-wrap]')).toBeHidden();
		await expect(tool.locator('[data-result-panel]')).toBeHidden();
		await expect(tool.locator('[data-cut]')).toBeDisabled();

		expect(errors).toEqual([]);
	});

	test('Face redactor surfaces a failed detection and forgets the image on Reset', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		await cacheCdnAssets(page);
		/* Page routes win over the context routes above, so only the object model is cut off. */
		await page.route(/object_detector/, (route) => route.abort());
		await page.goto('/en/tools/face-object-redactor/');
		const tool = page.locator('[data-redactor]');
		const status = tool.locator('[data-status]');

		await tool.locator('[data-file]').setInputFiles(photoFixture());
		await expect(tool.locator('[data-canvas]')).toBeVisible();
		await expect(tool.locator('[data-file-name]')).toHaveText('tiny-photo.png');
		await expect(status).toHaveText(/regions detected\./, { timeout: RUN_TIMEOUT });

		await setValue(tool.locator('[data-strength]'), 32);
		await expect(tool.locator('[data-strength-label]')).toHaveText('32');
		await tool.locator('[data-style]').selectOption('pixel');

		await expect(tool.locator('[data-detect]')).toBeEnabled();
		await tool.locator('[data-detect]').click();
		await expect(status).toHaveText(/regions detected\./, { timeout: RUN_TIMEOUT });

		/* The object model is blocked, so the failure has to surface and disarm Apply. */
		await tool.locator('[data-target]').selectOption('objects');
		await expect(status).toHaveAttribute('data-state', 'error', { timeout: RUN_TIMEOUT });
		await expect(status).toContainText('Redaction failed:');
		await expect(tool.locator('[data-apply]')).toBeDisabled();
		await expect(tool.locator('[data-result-panel]')).toBeHidden();

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('Choose an image.');
		await expect(tool.locator('[data-canvas]')).toBeHidden();

		/* Reset dropped the picture, so changing the target must not re-detect on it. */
		await tool.locator('[data-target]').selectOption('faces');
		await expect(status).toHaveText('Choose an image.');
		await expect(tool.locator('[data-detect]')).toBeDisabled();
		await expect(tool.locator('[data-apply]')).toBeDisabled();
		await expect(tool.locator('[data-canvas]')).toBeHidden();
		await expect(tool.locator('[data-result-panel]')).toBeHidden();
	});

	test('Metadata Remover writes the scrubbed bytes under a matching extension', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/metadata-remover/');
		const tool = page.locator('[data-metadata-scrubber]');
		const download = tool.locator('[data-download]');
		const status = tool.locator('[data-status]');

		await expect(tool.locator('[data-scrub]')).toBeDisabled();
		await tool.locator('[data-file]').setInputFiles(photoFixture());
		await expect(tool.locator('[data-file-name]')).toHaveText('tiny-photo.png');
		await expect(tool.locator('[data-scrub]')).toBeEnabled();
		await expect(tool.locator('[data-metadata-before]')).toContainText('media', { timeout: RUN_TIMEOUT });

		await tool.locator('[data-scrub]').click();
		await expect(status).toHaveText('Metadata removed.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'tiny-photo-scrubbed.png');
		await expect(tool.locator('[data-result-meta]')).toContainText('tiny-photo-scrubbed.png');
		await expect(tool.locator('[data-metadata-after]')).toContainText('"Format": "PNG"');

		const pngHref = await download.getAttribute('href');
		const png = await inspectImage(page, { href: pngHref }, { points: [[48, 32]] });
		expect(png.head.startsWith('89504e47')).toBe(true);
		expect({ width: png.width, height: png.height }).toEqual({ width: 96, height: 64 });
		expect(png.pixels[0]).toEqual([255, 255, 255, 255]);

		await tool.locator('[data-file]').setInputFiles(fixtureFile('tiny-photo.webp', 'image/webp'));
		await expect(tool.locator('[data-result-panel]')).toBeHidden();
		await tool.locator('[data-scrub]').click();
		await expect(status).toHaveText('Metadata removed.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'tiny-photo-scrubbed.webp');

		const webpHref = await waitForNewHref(download, pngHref);
		const webp = await inspectImage(page, { href: webpHref });
		expect(webp.ascii.startsWith('RIFF')).toBe(true);
		expect(webp.ascii.slice(8, 12)).toBe('WEBP');
		expect({ width: webp.width, height: webp.height }).toEqual({ width: 96, height: 64 });

		await tool.locator('[data-file]').setInputFiles(fixtureFile('tiny-photo.jpg', 'image/jpeg'));
		await tool.locator('[data-scrub]').click();
		await expect(status).toHaveText('Metadata removed.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'tiny-photo-scrubbed.jpg');

		const jpegHref = await waitForNewHref(download, webpHref);
		const jpeg = await inspectImage(page, { href: jpegHref });
		expect(jpeg.head.startsWith('ffd8ff')).toBe(true);
		expect({ width: jpeg.width, height: jpeg.height }).toEqual({ width: 96, height: 64 });

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('Choose a file.');
		await expect(tool.locator('[data-scrub]')).toBeDisabled();
		await expect(tool.locator('[data-result-panel]')).toBeHidden();
		await expect(tool.locator('[data-metadata-panel]')).toBeHidden();
		await expect(download).toBeHidden();
	});

	test('Raster/SVG Studio reports its fallback and drops the other direction on a mode switch', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.route(/imagetracerjs/, (route) => route.abort());
		await page.goto('/en/tools/raster-svg-studio/');
		const tool = page.locator('[data-raster-svg]');
		const status = tool.locator('[data-status]');

		await tool.locator('[data-raster]').setInputFiles(photoFixture());
		await expect(status).toHaveText('tiny-photo.png loaded.');
		await setValue(tool.locator('[data-colors]'), 8);
		await setValue(tool.locator('[data-detail]'), 40);
		await expect(tool.locator('[data-colors-label]')).toHaveText('8');
		await expect(tool.locator('[data-detail-label]')).toHaveText('40%');

		await tool.locator('[data-run]').click();
		/* Without ImageTracer the SVG is a rect grid, and saying so has to outlive the run. */
		await expect(status).toHaveText('ImageTracer did not load, used pixel-vector fallback.', { timeout: 30_000 });
		await expect(tool.locator('[data-result-panel]')).toBeVisible();
		await expect(tool.locator('[data-download-svg]')).toBeVisible();
		await expect(tool.locator('[data-download-svg]')).toHaveAttribute('download', 'tiny-photo.svg');

		const svgHref = await tool.locator('[data-download-svg]').getAttribute('href');
		const svg = await page.evaluate((url) => fetch(url).then((response) => response.text()), svgHref);
		expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 64"')).toBe(true);
		expect(svg).toContain('<rect ');
		expect(svg).not.toContain('<path');

		await tool.locator('[data-mode]').selectOption('png');
		await expect(tool.locator('[data-run]')).toHaveText('Create PNG');
		await expect(status).toHaveText('Choose a file.');
		/* The vector result must not stay downloadable while the tool says no file is chosen. */
		await expect(tool.locator('[data-result-panel]')).toBeHidden();
		await expect(tool.locator('[data-preview]')).toBeHidden();
		await expect(tool.locator('[data-download-svg]')).toBeHidden();

		await tool.locator('[data-svg-text]').fill('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><circle cx="10" cy="5" r="4" fill="#2f80ed"/></svg>');
		await setValue(tool.locator('[data-scale]'), 3);
		await expect(tool.locator('[data-scale-label]')).toHaveText('3x');
		await tool.locator('[data-background]').selectOption('white');
		await tool.locator('[data-run]').click();
		await expect(status).toHaveText('PNG created.', { timeout: 30_000 });
		await expect(tool.locator('[data-download-png]')).toHaveAttribute('download', 'rasterized-svg.png');
		await expect(tool.locator('[data-download-svg]')).toBeHidden();

		const whiteHref = await tool.locator('[data-download-png]').getAttribute('href');
		const white = await inspectImage(page, { href: whiteHref }, { points: [[1, 1], [30, 15]] });
		expect(white.head.startsWith('89504e47')).toBe(true);
		expect({ width: white.width, height: white.height }).toEqual({ width: 60, height: 30 });
		expect(white.pixels[0]).toEqual([255, 255, 255, 255]);
		expect(white.pixels[1]).toEqual([47, 128, 237, 255]);

		await tool.locator('[data-background]').selectOption('transparent');
		await tool.locator('[data-run]').click();
		const clearHref = await waitForNewHref(tool.locator('[data-download-png]'), whiteHref, 30_000);
		const clear = await inspectImage(page, { href: clearHref }, { points: [[1, 1], [30, 15]] });
		expect(clear.pixels[0][3]).toBe(0);
		expect(clear.pixels[1]).toEqual([47, 128, 237, 255]);

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('Choose a file.');
		await expect(tool.locator('[data-result-panel]')).toBeHidden();
		await expect(tool.locator('[data-svg-text]')).toHaveValue('');

		expect(errors).toEqual([]);
	});

	test('Raster/SVG Studio traces with ImageTracer when the library loads', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/raster-svg-studio/');
		const tool = page.locator('[data-raster-svg]');

		await tool.locator('[data-raster]').setInputFiles(photoFixture());
		await tool.locator('[data-run]').click();
		await expect(tool.locator('[data-status]')).toHaveText('SVG created.', { timeout: RUN_TIMEOUT });
		await expect(tool.locator('[data-download-svg]')).toHaveAttribute('download', 'tiny-photo.svg');

		const href = await tool.locator('[data-download-svg]').getAttribute('href');
		const svg = await page.evaluate((url) => fetch(url).then((response) => response.text()), href);
		expect(svg).toContain('<svg');
		expect(svg).toContain('<path');
	});

	test('Background remover cuts from the chosen file on every run and follows the format', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/background-remover/');
		const tool = page.locator('[data-background-remover]');
		const download = tool.locator('[data-download]');
		const sourceImage = tool.locator('[data-source-image]');
		const status = tool.locator('[data-status]');

		await paintFile(tool.locator('[data-file]'), {
			name: 'badge.png',
			width: 120,
			height: 90,
			background: '#ffffff',
			shapes: [{ type: 'rect', x: 40, y: 30, width: 40, height: 30, color: '#d62828' }],
		});
		await expect(tool.locator('[data-source-preview]')).toBeVisible();
		await expect(sourceImage).toBeVisible();
		await expect(tool.locator('[data-clear]')).toBeEnabled();
		await expect(download).toBeHidden();

		/* Clicking the white corner seeds the flood fill and starts the removal. */
		await expect.poll(() => sourceImage.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
		await sourceImage.click({ position: { x: 3, y: 3 } });
		await expect(tool.locator('[data-seed-value]')).toHaveText('#ffffff');
		await expect(status).toHaveText('badge-no-bg.png was created.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'badge-no-bg.png');
		await expect(tool.locator('[data-source-meta]')).toContainText('120 x 90px');

		const firstHref = await download.getAttribute('href');
		const first = await inspectImage(page, { href: firstHref }, { points: [[2, 2], [60, 45]] });
		expect(first.head.startsWith('89504e47')).toBe(true);
		expect({ width: first.width, height: first.height }).toEqual({ width: 120, height: 90 });
		expect(first.pixels[0][3]).toBe(0);
		/* ImageMagick may re-tag the PNG, so the badge is checked as "still red and opaque". */
		expect(first.pixels[1][3]).toBe(255);
		expect(first.pixels[1][0]).toBeGreaterThan(180);
		expect(first.pixels[1][1]).toBeLessThan(80);
		expect(first.pixels[1][2]).toBeLessThan(80);

		/* Tolerance has to re-render the download instead of leaving the old file behind. */
		await setValue(tool.locator('[data-fuzz]'), 20);
		await expect(tool.locator('[data-fuzz-label]')).toHaveText('20%');
		const tolerantHref = await waitForNewHref(download, firstHref);
		const tolerant = await inspectImage(page, { href: tolerantHref }, { points: [[2, 2], [60, 45]] });
		expect(tolerant.pixels[0][3]).toBe(0);
		expect(tolerant.pixels[1][3]).toBe(255);

		/* Switching the output format must hand over that format, not the stale PNG. */
		await tool.locator('[data-format]').selectOption('WEBP');
		await expect(tool.locator('[data-quality-control]')).toBeVisible();
		await expect(download).toHaveAttribute('download', 'badge-no-bg.webp', { timeout: RUN_TIMEOUT });
		const webpHref = await download.getAttribute('href');
		const webp = await inspectImage(page, { href: webpHref }, { points: [[2, 2], [60, 45]] });
		expect(webp.ascii.startsWith('RIFF')).toBe(true);
		expect(webp.ascii.slice(8, 12)).toBe('WEBP');
		expect(webp.pixels[0][3]).toBe(0);
		expect(webp.pixels[1][3]).toBe(255);

		await setValue(tool.locator('[data-quality]'), 40);
		await expect(tool.locator('[data-quality-label]')).toHaveText('40');
		const qualityHref = await waitForNewHref(download, webpHref);
		await expect(status).toHaveText('badge-no-bg.webp was created.', { timeout: RUN_TIMEOUT });

		/*
		 * The next click has to start from the chosen file again: seeding the red badge
		 * removes the badge and brings the white background back, which is impossible
		 * when the run is fed its own previous cutout.
		 */
		await expect.poll(() => sourceImage.evaluate((image) => image.src)).toBe(qualityHref);
		await expect.poll(() => sourceImage.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
		await sourceImage.click();
		const secondHref = await waitForNewHref(download, qualityHref);
		await expect(status).toHaveText('badge-no-bg.webp was created.', { timeout: RUN_TIMEOUT });
		const second = await inspectImage(page, { href: secondHref }, { points: [[2, 2], [60, 45]] });
		expect(second.pixels[0][3]).toBe(255);
		expect(second.pixels[1][3]).toBe(0);

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('The file has been cleared.');
		await expect(tool.locator('[data-source-preview]')).toBeHidden();
		await expect(tool.locator('[data-seed-display]')).toBeHidden();
		await expect(download).toBeHidden();
		await expect(tool.locator('[data-clear]')).toBeDisabled();
	});

	test('YouTube thumbnail preview drives every card, the device frames and the clear button', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/youtube-thumbnail-preview/');
		const tool = page.locator('[data-thumbnail-preview]');
		const previews = tool.locator('[data-preview-image]');
		const placeholders = tool.locator('[data-thumbnail-placeholder]');

		await expect(previews).toHaveCount(4);
		await expect(placeholders.first()).toBeVisible();

		await tool.locator('[data-thumbnail-file]').setInputFiles(photoFixture());
		await expect(tool.locator('[data-file-name]')).toHaveText('tiny-photo.png');
		await expect(tool.locator('[data-file-meta]')).toHaveText('image/png (7.5 KB)');
		for (let index = 0; index < 4; index += 1) {
			await expect(previews.nth(index)).toBeVisible();
			await expect(placeholders.nth(index)).toBeHidden();
		}
		const sources = await previews.evaluateAll((images) => images.map((image) => image.getAttribute('src')));
		expect(new Set(sources).size).toBe(1);
		expect(sources[0].startsWith('blob:')).toBe(true);

		await tool.locator('[data-title-input]').fill('Readable at 86 pixels wide');
		await expect(tool.locator('[data-title-count]')).toHaveText('26 characters');
		await expect(tool.locator('[data-title-preview]').first()).toHaveText('Readable at 86 pixels wide');
		await expect(tool.locator('[data-title-preview]').last()).toHaveText('Readable at 86 pixels wide');

		await tool.locator('[data-title-input]').fill('');
		await expect(tool.locator('[data-title-count]')).toHaveText('0 characters');
		await expect(tool.locator('[data-title-preview]').first()).toHaveText('Enter a title');

		const frame = tool.locator('[data-mobile-device-frame]');
		await expect(frame).toHaveAttribute('data-mobile-device', 'iphone-17');
		await tool.locator('[data-mobile-device-option="iphone-se"]').click();
		await expect(frame).toHaveAttribute('data-mobile-device', 'iphone-se');
		await expect(tool.locator('[data-mobile-device-label]')).toHaveText('iPhone SE · 138.4 × 67.3 mm');
		await expect(tool.locator('[data-mobile-device-option="iphone-se"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(tool.locator('[data-mobile-device-option="iphone-17"]')).toHaveAttribute('aria-pressed', 'false');
		expect(await frame.evaluate((node) => node.style.getPropertyValue('--device-body-width-mm'))).toBe('67.3');

		await tool.locator('[data-mobile-device-option="galaxy-s26-ultra"]').click();
		await expect(frame).toHaveAttribute('data-mobile-device', 'galaxy-s26-ultra');
		await expect(tool.locator('[data-mobile-device-label]')).toHaveText('Galaxy S26 Ultra · 162.8 × 77.6 mm');
		expect(await frame.evaluate((node) => node.style.getPropertyValue('--device-screen-height-mm'))).toBe('159.13');

		await tool.locator('[data-clear-image]').click();
		await expect(tool.locator('[data-file-name]')).toHaveText('Choose thumbnail');
		await expect(tool.locator('[data-file-meta]')).toHaveText('JPG, PNG, GIF, WebP, or AVIF, ideally 16:9');
		for (let index = 0; index < 4; index += 1) {
			await expect(previews.nth(index)).toBeHidden();
			await expect(placeholders.nth(index)).toBeVisible();
		}
		expect(await previews.evaluateAll((images) => images.every((image) => !image.hasAttribute('src')))).toBe(true);

		expect(errors).toEqual([]);
	});
});
