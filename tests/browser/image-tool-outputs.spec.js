import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cacheCdnAssets } from './cdn-cache.mjs';
import { createAviUpload } from './media-fixtures.mjs';

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

/*
 * Hands a picker a File built from real bytes, optionally without a MIME type at all: a download or
 * an unknown source arrives with an empty `file.type`, and setInputFiles always supplies one.
 */
const dropFile = (locator, spec) => locator.evaluate((input, options) => {
	const bytes = Uint8Array.from(atob(options.base64), (character) => character.charCodeAt(0));
	const file = options.type
		? new File([bytes], options.name, { type: options.type })
		: new File([bytes], options.name);
	const transfer = new DataTransfer();
	transfer.items.add(file);
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}, spec);

/*
 * A real GIF built here instead of committed: a four-colour table, one image descriptor per frame
 * and a genuine LZW stream. Emitting a clear code before every pixel keeps the code width at the
 * initial three bits, which is wasteful but exactly what every decoder expects to read.
 */
const gifFixture = ({ frames = [2], name = 'loop.gif', width = 96, height = 64, delay = 10, comment = '' } = {}) => {
	const bytes = [];
	const pushUint16 = (value) => bytes.push(value & 0xff, (value >> 8) & 0xff);

	bytes.push(...[...'GIF89a'].map((character) => character.charCodeAt(0)));
	pushUint16(width);
	pushUint16(height);
	/* 0x81: global colour table of four entries, which is what LZW code size 2 addresses. */
	bytes.push(0x81, 0x00, 0x00);
	bytes.push(0x10, 0x20, 0x40, 0xd6, 0x28, 0x28, 0xf2, 0xf2, 0xf2, 0x2f, 0x8f, 0x4f);
	bytes.push(0x21, 0xff, 0x0b);
	bytes.push(...[...'NETSCAPE2.0'].map((character) => character.charCodeAt(0)));
	bytes.push(0x03, 0x01, 0x00, 0x00, 0x00);

	/* A comment extension is where a GIF keeps the note EXIF carries in other formats. */
	if (comment) {
		bytes.push(0x21, 0xfe);
		for (let at = 0; at < comment.length; at += 255) {
			const part = comment.slice(at, at + 255);
			bytes.push(part.length, ...[...part].map((character) => character.charCodeAt(0)));
		}
		bytes.push(0x00);
	}

	for (const colourIndex of frames) {
		bytes.push(0x21, 0xf9, 0x04, 0x00, delay & 0xff, (delay >> 8) & 0xff, 0x00, 0x00);
		bytes.push(0x2c);
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
	return { name, mimeType: 'image/gif', buffer: Buffer.from(bytes) };
};

/*
 * Reads a GIF the way a player parses it: 0x21 0xF9 opens a graphic control extension, one per
 * frame, and the digest is what says the bytes are not simply the source handed back.
 */
const inspectGif = (page, source) => page.evaluate(async (from) => {
	const bytes = from.href
		? new Uint8Array(await (await fetch(from.href)).arrayBuffer())
		: Uint8Array.from(atob(from.base64), (character) => character.charCodeAt(0));
	let graphicControlExtensions = 0;
	let digest = 2166136261;

	for (let index = 0; index < bytes.length; index += 1) {
		if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9) graphicControlExtensions += 1;
		digest = Math.imul(digest ^ bytes[index], 16777619) >>> 0;
	}

	/*
	 * Following the block chain instead of scanning for a byte pair: image descriptors are the real
	 * frame count, and a comment extension is the metadata a scrub has to leave behind.
	 */
	const text = (at, length) => {
		let out = '';
		for (let index = 0; index < length; index += 1) out += String.fromCharCode(bytes[at + index] || 0);
		return out;
	};
	const colorTable = (flags) => ((flags & 0x80) ? 3 * (2 ** ((flags & 0x07) + 1)) : 0);
	let frames = 0;
	const comments = [];
	let at = 13 + colorTable(bytes[10]);

	while (at < bytes.length && bytes[at] !== 0x3b) {
		if (bytes[at] === 0x21) {
			const label = bytes[at + 1];
			const parts = [];
			at += 2;
			while (at < bytes.length && bytes[at] !== 0x00) {
				parts.push(text(at + 1, bytes[at]));
				at += bytes[at] + 1;
			}
			at += 1;
			if (label === 0xfe) comments.push(parts.join(''));
		} else if (bytes[at] === 0x2c) {
			frames += 1;
			at += 10 + colorTable(bytes[at + 9]) + 1;
			while (at < bytes.length && bytes[at] !== 0x00) at += bytes[at] + 1;
			at += 1;
		} else {
			break;
		}
	}

	return {
		ascii: String.fromCharCode(...bytes.subarray(0, 6)),
		byteLength: bytes.byteLength,
		graphicControlExtensions,
		digest,
		frames,
		comments,
	};
}, source);



/* Container bytes of anything a tool produced, for outputs that are not still images. */
const readOutput = (page, href) => page.evaluate(async (url) => {
	const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
	return {
		byteLength: bytes.byteLength,
		head: [...bytes.subarray(0, 12)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		ascii: String.fromCharCode(...bytes.subarray(0, 12)),
	};
}, href);

/* Decodes a produced video the way a viewer would, so the size comes from the file and not the UI. */
const videoSize = (page, href) => page.evaluate((url) => new Promise((resolve, reject) => {
	const video = document.createElement('video');
	video.preload = 'metadata';
	video.muted = true;
	video.onloadedmetadata = () => resolve({ width: video.videoWidth, height: video.videoHeight });
	video.onerror = () => reject(new Error('the produced video did not decode'));
	video.src = url;
}), href);

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

	test('Watermarker renders a video whose dimensions the browser cannot read', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		const errors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/image-video-watermark/');
		const tool = page.locator('[data-watermarker]');
		const status = tool.locator('[data-status]');

		/* A real MJPEG AVI: Chromium has no demuxer for it, so the size can only come from FFmpeg. */
		await tool.locator('[data-source-file]').setInputFiles(createAviUpload());
		await expect(tool.locator('[data-source-name]')).toHaveText('mjpeg-clip.avi');
		/* AVI, WMV and some MOV files report no size here, and the tool used to stay armed at nothing. */
		await expect(status).toContainText('mjpeg-clip.avi is selected');
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(tool.locator('[data-process]')).toBeEnabled();

		await setValue(tool.locator('[data-opacity]'), 100);
		await tool.locator('[data-position]').selectOption('center');
		await tool.locator('[data-process]').click();
		await expect(status).toHaveText('The watermarked video is ready.', { timeout: RUN_TIMEOUT });
		await expect(tool.locator('[data-output-video]')).toBeVisible();
		await expect(tool.locator('[data-output-image]')).toBeHidden();
		/* The AVI is 96x64, a geometry no committed fixture shares: only FFmpeg could have reported it. */
		await expect(tool.locator('[data-output-details]')).toContainText('96 x 64px');

		const download = tool.locator('[data-download]');
		await expect(download).toHaveAttribute('download', 'mjpeg-clip.mp4');
		const href = await download.getAttribute('href');
		const output = await readOutput(page, href);

		expect(output.ascii.slice(4, 8)).toBe('ftyp');
		expect(output.byteLength).toBeGreaterThan(1000);
		expect(await videoSize(page, href)).toEqual({ width: 96, height: 64 });

		expect(errors).toEqual([]);
	});

	test('Watermarker keeps every frame of an animated GIF and writes a GIF back', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		const errors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/image-video-watermark/');
		const tool = page.locator('[data-watermarker]');
		const status = tool.locator('[data-status]');
		const download = tool.locator('[data-download]');
		/* Near-white, dark blue and red: three frames that differ, so a flattened export is obvious. */
		const animated = gifFixture({ frames: [2, 0, 1] });
		const animatedBase64 = animated.buffer.toString('base64');

		/* Nothing may announce a downgrade any more, so the notice is gone from the page entirely. */
		await expect(tool.locator('[data-animated-notice]')).toHaveCount(0);

		await tool.locator('[data-source-file]').setInputFiles(animated);
		await expect(tool.locator('[data-source-name]')).toHaveText('loop.gif');
		await expect(status).toContainText('loop.gif is selected');

		await tool.locator('[data-mode]').selectOption('image');
		await paintFile(tool.locator('[data-watermark-file]'), {
			name: 'stamp.png',
			width: 40,
			height: 40,
			background: '#ff00ff',
		});
		await expect(tool.locator('[data-watermark-name]')).toHaveText('stamp.png');
		await setValue(tool.locator('[data-opacity]'), 100);
		await setValue(tool.locator('[data-size]'), 30);
		await tool.locator('[data-position]').selectOption('center');
		await expect(tool.locator('[data-process]')).toBeEnabled();

		await tool.locator('[data-process]').click();
		await expect(status).toHaveText('The watermarked animated GIF is ready.', { timeout: RUN_TIMEOUT });
		await expect(tool.locator('[data-output-image]')).toBeVisible();
		await expect(tool.locator('[data-output-video]')).toBeHidden();
		await expect(tool.locator('[data-output-details]')).toContainText('96 x 64px');
		/* The panel counts the frames of the file that was written, not of the source. */
		await expect(tool.locator('[data-output-details]')).toContainText('3 frames');

		/* The animation is what was handed in, so a GIF is what has to come back out. */
		await expect(download).toHaveAttribute('download', 'loop.gif');
		const href = await download.getAttribute('href');
		const produced = await inspectGif(page, { href });
		const source = await inspectGif(page, { base64: animatedBase64 });

		expect(produced.ascii).toBe('GIF89a');
		/* One graphic control extension per frame: a flattened export would carry a single one. */
		expect(produced.graphicControlExtensions).toBeGreaterThan(1);
		expect(produced.graphicControlExtensions).toBeGreaterThanOrEqual(3);
		expect(source.graphicControlExtensions).toBe(3);
		/* Re-encoded with the stamp burned in, so the bytes cannot be the ones that went in. */
		expect(produced.digest).not.toBe(source.digest);

		/* The first frame decodes with the magenta stamp over the near-white ground of frame one. */
		const stamp = { color: [255, 0, 255], tolerance: 24, points: [[48, 32], [2, 2]] };
		const output = await inspectImage(page, { href }, stamp);
		const before = await inspectImage(page, { base64: animatedBase64 }, stamp);

		expect({ width: output.width, height: output.height }).toEqual({ width: 96, height: 64 });
		expect(before.colorMatches).toBe(0);
		expect(output.colorMatches).toBeGreaterThan(400);
		expect(Math.abs(output.pixels[1][0] - before.pixels[1][0])).toBeLessThan(24);

		/* A GIF with one frame has nothing to animate and keeps taking the canvas path. */
		await tool.locator('[data-source-file]').setInputFiles(gifFixture({ name: 'still.gif', frames: [1] }));
		await expect(tool.locator('[data-source-name]')).toHaveText('still.gif');
		await expect(status).toContainText('still.gif is selected');
		await tool.locator('[data-process]').click();
		await expect(status).toHaveText('The watermarked image is ready.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'still.png');

		const stillHref = await download.getAttribute('href');
		const still = await inspectImage(page, { href: stillHref }, stamp);

		expect(still.head.startsWith('89504e47')).toBe(true);
		expect({ width: still.width, height: still.height }).toEqual({ width: 96, height: 64 });
		expect(still.colorMatches).toBeGreaterThan(400);

		expect(errors).toEqual([]);
	});

	/*
	 * The preview canvas is the morph itself, so a pixel read from it at a given progress is the
	 * assertion that the distance fields blend rather than cross-fade: a part with no partner in
	 * the other picture is gone halfway through instead of lingering at half opacity.
	 */
	const previewPixel = async (tool, t, x, y) => {
		await setValue(tool.locator('[data-scrub]'), t);
		return tool.locator('[data-preview-canvas]').evaluate(
			(canvas, point) => [...canvas.getContext('2d').getImageData(point.x, point.y, 1, 1).data],
			{ x, y },
		);
	};

	test('Image Morph previews a distance-field morph and renders it as MP4 and WebM', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		const errors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/image-morph/');
		const tool = page.locator('[data-image-morph]');
		const status = tool.locator('[data-status]');
		const render = tool.locator('[data-render]');

		/* A square and a circle that overlap in the middle: each has a side the other never reaches. */
		await paintFile(tool.locator('[data-slot="a"] [data-file]'), {
			name: 'square.png', width: 96, height: 64, background: '#ffffff',
			shapes: [{ type: 'rect', x: 16, y: 16, width: 40, height: 32, color: '#000000' }],
		});
		await expect(tool.locator('[data-slot="a"] [data-file-name]')).toHaveText('square.png');
		await expect(tool.locator('[data-slot="a"] [data-file-meta]')).toContainText('96 x 64px');
		await expect(status).toHaveText('square.png is loaded (96 x 64px).');
		await expect(render).toBeDisabled();
		await expect(tool.locator('[data-preview]')).toBeHidden();

		await paintFile(tool.locator('[data-slot="b"] [data-file]'), {
			name: 'circle.png', width: 96, height: 64, background: '#ffffff',
			shapes: [{ type: 'circle', x: 60, y: 32, radius: 16, color: '#000000' }],
		});
		await expect(status).toHaveText('circle.png is loaded (96 x 64px).');
		await expect(render).toBeEnabled();
		await expect(tool.locator('[data-preview]')).toBeVisible();
		await expect(tool.locator('[data-preview-canvas]')).toHaveAttribute('width', '320');

		/*
		 * Preview pixels at source x = 20 (square only), 50 (both) and 74 (circle only), scaled by
		 * 320 / 96. Halfway, the overlap is solid while both lone sides have already shrunk away.
		 */
		const dark = (pixel) => pixel[0] < 64 && pixel[3] === 255;
		const light = (pixel) => pixel[0] > 192 && pixel[3] === 255;
		expect(dark(await previewPixel(tool, 0, 67, 107))).toBe(true);
		expect(dark(await previewPixel(tool, 0, 167, 107))).toBe(true);
		expect(light(await previewPixel(tool, 0, 247, 107))).toBe(true);
		expect(light(await previewPixel(tool, 0.5, 67, 107))).toBe(true);
		expect(dark(await previewPixel(tool, 0.5, 167, 107))).toBe(true);
		expect(light(await previewPixel(tool, 0.5, 247, 107))).toBe(true);
		expect(light(await previewPixel(tool, 1, 67, 107))).toBe(true);
		expect(dark(await previewPixel(tool, 1, 167, 107))).toBe(true);
		expect(dark(await previewPixel(tool, 1, 247, 107))).toBe(true);

		/* 0.2 s hold, 0.5 s morph at 12 fps: eleven frames, which the output meta has to report. */
		await setValue(tool.locator('[data-hold]'), 0.2);
		await setValue(tool.locator('[data-duration]'), 0.5);
		await expect(tool.locator('[data-hold-label]')).toHaveText('0.2 s');
		await expect(tool.locator('[data-duration-label]')).toHaveText('0.5 s');
		await tool.locator('[data-easing]').selectOption('linear');
		await tool.locator('[data-fps]').selectOption('12');
		await tool.locator('[data-size]').selectOption('360');
		await render.click();
		await expect(status).toHaveText('The morph video is ready.', { timeout: RUN_TIMEOUT });
		await expect(tool.locator('[data-result]')).toBeVisible();
		await expect(tool.locator('[data-output-meta]')).toHaveText(/^360 x 240px \| 11 frames \| 0\.9 s \| /);

		const download = tool.locator('[data-download]');
		await expect(download).toHaveAttribute('download', 'square-to-circle.mp4');
		const mp4Href = await download.getAttribute('href');
		const mp4 = await readOutput(page, mp4Href);
		expect(mp4.ascii.slice(4, 8)).toBe('ftyp');
		expect(mp4.byteLength).toBeGreaterThan(1000);
		expect(await videoSize(page, mp4Href)).toEqual({ width: 360, height: 240 });

		/* Looping back doubles the morph, and WebM has to come out as EBML, not as a renamed MP4. */
		await tool.locator('[data-format]').selectOption('webm');
		await tool.locator('[data-loop]').check();
		await render.click();
		const webmHref = await waitForNewHref(download, mp4Href);
		await expect(status).toHaveText('The morph video is ready.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'square-to-circle.webm');
		await expect(tool.locator('[data-output-meta]')).toContainText('17 frames | 1.4 s');
		const webm = await readOutput(page, webmHref);
		expect(webm.head.startsWith('1a45dfa3')).toBe(true);
		expect(await videoSize(page, webmHref)).toEqual({ width: 360, height: 240 });

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('The tool has been reset.');
		await expect(render).toBeDisabled();
		await expect(tool.locator('[data-preview]')).toBeHidden();
		await expect(tool.locator('[data-result]')).toBeHidden();
		await expect(tool.locator('[data-slot="b"] [data-file-name]')).toHaveText('Choose image');

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
		/* 512px stays under the cap, so nothing was resized and the panel must not claim otherwise. */
		await expect(tool.locator('[data-result-size]')).toHaveText('Export: 512 x 512px');
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
		await expect(tool.locator('[data-result-size]')).toBeHidden();
		await expect(tool.locator('[data-cut]')).toBeDisabled();

		expect(errors).toEqual([]);
	});

	test('Object extractor exports at the source resolution, not the segmentation canvas', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		const errors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/image-object-extractor/');
		const tool = page.locator('[data-object-extractor]');

		await paintFile(tool.locator('[data-file]'), {
			name: 'wide.png',
			width: 1600,
			height: 400,
			background: '#ffffff',
			shapes: [{ type: 'circle', x: 800, y: 200, radius: 150, color: '#d62828' }],
		});
		await expect(tool.locator('[data-canvas-wrap]')).toBeVisible();
		await expect(tool.locator('[data-status]')).toHaveText('Model ready. Click the object.', { timeout: RUN_TIMEOUT });

		await tool.locator('[data-canvas]').click();
		await expect(tool.locator('[data-cut]')).toBeEnabled();
		await tool.locator('[data-cut]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Object extracted.', { timeout: RUN_TIMEOUT });

		/* Segmentation still runs on a 1200px canvas, but the export is the size that was handed in. */
		await expect(tool.locator('[data-result-size]')).toHaveText('Export: 1600 x 400px');

		const href = await tool.locator('[data-download]').getAttribute('href');
		const output = await inspectImage(page, { href });

		expect(output.head.startsWith('89504e47')).toBe(true);
		expect({ width: output.width, height: output.height }).toEqual({ width: 1600, height: 400 });

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

	/* Nothing is downgraded any more, so the note may not warn about a format that turns into PNG. */
	test('Metadata Remover promises every format back in both locales', async ({ page }) => {
		await page.goto('/en/tools/metadata-remover/');
		await expect(page.locator('[data-preserve-note]')).toHaveText(
			'The detected image format and media container are kept: GIF stays GIF, TIFF stays TIFF, an animated GIF keeps its frames, and SVG is cleaned as XML.',
		);

		await page.goto('/de/tools/metadaten-entfernen/');
		await expect(page.locator('[data-preserve-note]')).toHaveText(
			'Das erkannte Bildformat und der erkannte Mediencontainer bleiben erhalten: GIF bleibt GIF, TIFF bleibt TIFF, ein animiertes GIF behält seine Frames, und SVG wird als XML bereinigt.',
		);
	});

	/*
	 * A GIF used to come back as PNG because canvas.toBlob writes nothing else, which cost the file
	 * both its container and its animation. ImageMagick writes the GIF back instead, and its strip is
	 * what takes the comment extension — a GIF's own place for the note EXIF holds elsewhere — away.
	 */
	test('Metadata Remover gives back an animated GIF with its frames and without its comment', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/metadata-remover/');
		const tool = page.locator('[data-metadata-scrubber]');
		const download = tool.locator('[data-download]');
		const status = tool.locator('[data-status]');

		const secret = 'GPS 51.4934 N 0.0098 W';
		const source = gifFixture({ frames: [2, 0, 1], comment: secret });

		/* The reader has to find both halves in the source, or its verdict on the output means nothing. */
		const before = await inspectGif(page, { base64: source.buffer.toString('base64') });
		expect(before.frames).toBe(3);
		expect(before.comments).toEqual([secret]);

		await tool.locator('[data-file]').setInputFiles(source);
		await expect(tool.locator('[data-file-name]')).toHaveText('loop.gif');
		await expect(tool.locator('[data-scrub]')).toBeEnabled();

		await tool.locator('[data-scrub]').click();
		await expect(status).toHaveText('Metadata removed.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'loop-scrubbed.gif');
		await expect(tool.locator('[data-result-meta]')).toContainText('loop-scrubbed.gif');

		const href = await download.getAttribute('href');
		const after = await inspectGif(page, { href });
		expect(after.ascii).toMatch(/^GIF8[79]a$/);
		expect(after.frames).toBe(3);
		expect(after.comments).toEqual([]);
		/* Re-encoded rather than handed straight back, and still a picture a decoder can open. */
		expect(after.digest).not.toBe(before.digest);

		const decoded = await inspectImage(page, { href });
		expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 96, height: 64 });
	});

	/* SVG is XML, so its metadata is cut out of the markup instead of being rasterised away. */
	test('Metadata Remover cleans an SVG as markup and keeps it an SVG', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/metadata-remover/');
		const tool = page.locator('[data-metadata-scrubber]');
		const download = tool.locator('[data-download]');

		const source = [
			'<?xml version="1.0" encoding="UTF-8"?>',
			'<!-- Created with Inkscape by Jane Doe -->',
			'<svg xmlns="http://www.w3.org/2000/svg" xmlns:dc="http://purl.org/dc/elements/1.1/"',
			'  sodipodi:docname="holiday-plan.svg" width="20" height="10">',
			'  <metadata><rdf:RDF><dc:creator>Jane Doe</dc:creator></rdf:RDF></metadata>',
			'  <title>Blue dot</title>',
			'  <circle cx="10" cy="5" r="4" fill="#2f80ed"/>',
			'</svg>',
		].join('\n');

		await dropFile(tool.locator('[data-file]'), {
			name: 'logo.svg',
			type: 'image/svg+xml',
			base64: Buffer.from(source, 'utf8').toString('base64'),
		});
		await expect(tool.locator('[data-file-name]')).toHaveText('logo.svg');
		await tool.locator('[data-scrub]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Metadata removed.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'logo-scrubbed.svg');

		const href = await download.getAttribute('href');
		const svg = await page.evaluate((url) => fetch(url).then((response) => response.text()), href);

		expect(svg).toContain('<circle cx="10" cy="5" r="4" fill="#2f80ed"/>');
		expect(svg).toContain('<title>Blue dot</title>');
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
		for (const trace of ['Jane Doe', 'holiday-plan.svg', '<metadata', 'rdf:RDF', '<!--']) {
			expect(svg).not.toContain(trace);
		}
	});

	test('Metadata Remover scrubs an image that arrives without a MIME type', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/metadata-remover/');
		const tool = page.locator('[data-metadata-scrubber]');
		const download = tool.locator('[data-download]');

		/* An empty file.type used to send the image to FFmpeg, which cannot scrub a still picture. */
		await dropFile(tool.locator('[data-file]'), {
			name: 'tiny-photo.webp',
			base64: fixtureFile('tiny-photo.webp', 'image/webp').buffer.toString('base64'),
		});
		await expect(tool.locator('[data-file-name]')).toHaveText('tiny-photo.webp');
		await expect(tool.locator('[data-file-meta]')).toContainText('· file');
		await expect(tool.locator('[data-scrub]')).toBeEnabled();

		await tool.locator('[data-scrub]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Metadata removed.', { timeout: RUN_TIMEOUT });
		await expect(download).toHaveAttribute('download', 'tiny-photo-scrubbed.webp');

		const href = await download.getAttribute('href');
		const webp = await inspectImage(page, { href }, { points: [[48, 32]] });

		/* The name is only honest if the bytes under it really are a WebP of the same picture. */
		expect(webp.ascii.startsWith('RIFF')).toBe(true);
		expect(webp.ascii.slice(8, 12)).toBe('WEBP');
		expect({ width: webp.width, height: webp.height }).toEqual({ width: 96, height: 64 });
		/* The white circle in the middle of the fixture survives the re-encode. */
		expect(webp.pixels[0][3]).toBe(255);
		expect(Math.min(...webp.pixels[0].slice(0, 3))).toBeGreaterThan(230);

		/* The committed fixture carries an ICC profile chunk, and a scrub that kept it would be no scrub. */
		const riffChunks = (source) => page.evaluate(async (from) => {
			const bytes = from.href
				? new Uint8Array(await (await fetch(from.href)).arrayBuffer())
				: Uint8Array.from(atob(from.base64), (character) => character.charCodeAt(0));
			const names = [];
			for (let at = 12; at + 8 <= bytes.length;) {
				names.push(String.fromCharCode(...bytes.subarray(at, at + 4)));
				const size = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] * 0x1000000);
				at += 8 + size + (size % 2);
			}
			return names;
		}, source);

		expect(await riffChunks({ base64: fixtureFile('tiny-photo.webp', 'image/webp').buffer.toString('base64') })).toContain('ICCP');
		expect(await riffChunks({ href })).not.toContain('ICCP');
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

	test('Background remover runs from the corner when the preview cannot show the file', async ({ page }) => {
		test.setTimeout(CDN_TIMEOUT);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/background-remover/');
		const tool = page.locator('[data-background-remover]');
		const cornerButton = tool.locator('[data-corner-run]');
		const download = tool.locator('[data-download]');
		const sourceImage = tool.locator('[data-source-image]');
		const status = tool.locator('[data-status]');

		await expect(cornerButton).toBeDisabled();
		await paintFile(tool.locator('[data-file]'), {
			name: 'badge.png',
			width: 120,
			height: 90,
			background: '#ffffff',
			shapes: [{ type: 'rect', x: 40, y: 30, width: 40, height: 30, color: '#d62828' }],
		});
		await expect(cornerButton).toBeEnabled();

		/*
		 * TIFF, PSD and HEIC end up in this state: the browser cannot display them, so clicking the
		 * preview — the only way to start a run — is impossible even though ImageMagick reads them.
		 */
		await sourceImage.evaluate((image) => image.dispatchEvent(new Event('error')));
		await expect(sourceImage).toBeHidden();
		await expect(tool.locator('[data-source-preview-note]')).toBeVisible();
		await expect(tool.locator('[data-seed-display]')).toBeHidden();
		await expect(download).toBeHidden();

		await cornerButton.click();
		await expect(status).toHaveText('badge-no-bg.png was created.', { timeout: RUN_TIMEOUT });
		await expect(tool.locator('[data-seed-display]')).toBeVisible();
		await expect(tool.locator('[data-seed-value]')).toHaveText('Top-left corner');
		/* No colour was sampled in the browser, so the swatch must not claim one. */
		await expect(tool.locator('[data-seed-swatch]')).toBeHidden();
		await expect(download).toHaveAttribute('download', 'badge-no-bg.png');
		await expect(tool.locator('[data-source-meta]')).toContainText('120 x 90px');

		const href = await download.getAttribute('href');
		const cutout = await inspectImage(page, { href }, { points: [[2, 2], [60, 45]] });

		expect(cutout.head.startsWith('89504e47')).toBe(true);
		expect({ width: cutout.width, height: cutout.height }).toEqual({ width: 120, height: 90 });
		/* The corner pixel seeded the fill: the white ground is gone and the badge is untouched. */
		expect(cutout.pixels[0][3]).toBe(0);
		expect(cutout.pixels[1][3]).toBe(255);
		expect(cutout.pixels[1][0]).toBeGreaterThan(180);
		expect(cutout.pixels[1][1]).toBeLessThan(80);

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('The file has been cleared.');
		await expect(cornerButton).toBeDisabled();
		await expect(tool.locator('[data-seed-display]')).toBeHidden();
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
