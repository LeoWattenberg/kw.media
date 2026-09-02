// SVG Morph, checked against the videos it hands back: flubber interpolates two SVGs, the
// canvas frames go through the real ffmpeg.wasm build (only the CDN transport is replayed
// from .cache/), and every container is parsed for its codec tag and its alpha markers.
import { expect, test } from '@playwright/test';
import { cacheCdnAssets } from './cdn-cache.mjs';

const squareSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="0" y="0" width="100" height="100" fill="#ff0000"/></svg>';
/* One even-odd path: the hole has to survive as a hole and not turn into a second blue disc. */
const ringSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill-rule="evenodd" fill="#0000ff" d="M100 50A50 50 0 1 1 0 50A50 50 0 1 1 100 50ZM75 50A25 25 0 1 0 25 50A25 25 0 1 0 75 50Z"/></svg>';
const textSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="50">Hi</text></svg>';

const dropSvg = (locator, name, markup) => locator.evaluate((input, options) => {
	const transfer = new DataTransfer();
	transfer.items.add(new File([options.markup], options.name, { type: 'image/svg+xml' }));
	input.files = transfer.files;
	input.dispatchEvent(new Event('change', { bubbles: true }));
}, { name, markup });

const setValue = (locator, value, event) => locator.evaluate((input, options) => {
	input.value = String(options.value);
	input.dispatchEvent(new Event(options.event, { bubbles: true }));
}, { value, event });

/* Samples the preview canvas at fractions of its size so the assertion does not depend on layout width. */
const pixelAt = (canvas, fx, fy) => canvas.evaluate((element, point) => {
	const data = element.getContext('2d').getImageData(Math.round(point.fx * element.width), Math.round(point.fy * element.height), 1, 1).data;
	return [...data];
}, { fx, fy });

const readContainer = (link) => link.evaluate(async (anchor) => {
	const bytes = new Uint8Array(await (await fetch(anchor.href)).arrayBuffer());
	return {
		magic: [...bytes.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		text: new TextDecoder('latin1').decode(bytes),
		byteLength: bytes.byteLength,
	};
});

const collectPageErrors = (page) => {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
};

const movExpectation = (tag) => ({ name: 'square-to-ring.mov', magic: '00000014', tags: ['ftypqt  ', tag, 'moov'] });

test.describe('svg morph outputs', () => {
	test('SVG Morph previews the interpolation and renders a transparent video in every format', async ({ page }) => {
		test.setTimeout(300_000);
		const errors = collectPageErrors(page);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/svg-morph/');

		const tool = page.locator('[data-svg-morph]');
		const status = tool.locator('[data-status]');
		const render = tool.locator('[data-render]');
		const canvas = tool.locator('[data-preview-canvas]');
		const download = tool.locator('[data-download]');

		await expect(status).toHaveText('Choose a start and an end SVG.');
		await expect(render).toBeDisabled();
		await expect(tool.locator('[data-swap]')).toBeDisabled();
		await expect(tool.locator('[data-preview-card]')).toBeHidden();

		await dropSvg(tool.locator('[data-from-file]'), 'square.svg', squareSvg);
		await expect(tool.locator('[data-from-name]')).toHaveText('square.svg');
		await expect(status).toHaveText('square.svg is loaded: 1 shapes.');
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(tool.locator('[data-from-thumb]')).toBeVisible();
		await expect(render).toBeDisabled();
		await expect(tool.locator('[data-swap]')).toBeEnabled();

		await dropSvg(tool.locator('[data-to-file]'), 'ring.svg', ringSvg);
		await expect(status).toHaveText('ring.svg is loaded: 1 shapes. Both shapes are loaded. The preview is playing and the video can be rendered.');
		await expect(tool.locator('[data-preview-card]')).toBeVisible();
		await expect(render).toBeEnabled();

		/* A square frame keeps the sampled points simple: the ring spans 80 % of the frame, its hole 40 %. */
		await setValue(tool.locator('[data-width]'), 64, 'change');
		await setValue(tool.locator('[data-height]'), 64, 'change');
		await tool.locator('[data-play]').setChecked(false);
		await setValue(tool.locator('[data-scrub]'), 0, 'input');
		await expect(tool.locator('[data-scrub-label]')).toHaveText('0%');
		expect(await pixelAt(canvas, 0.5, 0.5)).toEqual([255, 0, 0, 255]);
		expect(await pixelAt(canvas, 0.5, 0.2)).toEqual([255, 0, 0, 255]);
		expect((await pixelAt(canvas, 0.02, 0.02))[3]).toBe(0);

		await setValue(tool.locator('[data-scrub]'), 1000, 'input');
		await expect(tool.locator('[data-scrub-label]')).toHaveText('100%');
		expect((await pixelAt(canvas, 0.5, 0.5))[3]).toBe(0);
		expect(await pixelAt(canvas, 0.5, 0.2)).toEqual([0, 0, 255, 255]);

		/* Halfway the fill is a blend and the hole is still open. */
		await setValue(tool.locator('[data-scrub]'), 500, 'input');
		const blended = await pixelAt(canvas, 0.5, 0.2);
		expect(blended[0]).toBeGreaterThan(60);
		expect(blended[2]).toBeGreaterThan(60);
		expect(blended[3]).toBe(255);

		await setValue(tool.locator('[data-hold-start]'), 0.1, 'change');
		await setValue(tool.locator('[data-duration]'), 0.2, 'change');
		await setValue(tool.locator('[data-hold-end]'), 0.1, 'change');
		await tool.locator('[data-fps]').selectOption('24');

		const expectations = {
			'prores-4444': movExpectation('ap4h'),
			'qt-animation': movExpectation('rle '),
			'png-mov': movExpectation('png '),
			/* 0x53C0 is Matroska's AlphaMode element; ffmpeg writes it as 53 c0 81 01 for streams with alpha. */
			'webm-vp8': { name: 'square-to-ring.webm', magic: '1a45dfa3', tags: ['webm', 'V_VP8', 'S\u00c0\u0081\u0001'], playable: true },
		};

		for (const [format, expected] of Object.entries(expectations)) {
			await tool.locator('[data-format]').selectOption(format);
			await render.click();
			await expect(status).toHaveText('The video is ready: 9 frames, 0.38 s.', { timeout: 150_000 });
			await expect(status).toHaveAttribute('data-state', 'success');
			await expect(download).toBeVisible();
			await expect(download).toHaveAttribute('download', expected.name);
			await expect(tool.locator('[data-output-meta]')).toContainText('64 x 64px | 24 FPS | 9 frames | 0.38 s');

			const container = await readContainer(download);
			expect(container.magic).toBe(expected.magic);
			for (const tag of expected.tags) {
				expect(container.text).toContain(tag);
			}
			expect(container.byteLength).toBeGreaterThan(200);

			if (expected.playable) {
				await expect(tool.locator('[data-output-video]')).toBeVisible();
				await expect(tool.locator('[data-output-note]')).toBeHidden();
			} else {
				await expect(tool.locator('[data-output-video]')).toBeHidden();
				await expect(tool.locator('[data-output-note]')).toHaveText('Browsers do not play MOV files with an alpha channel. Import the download straight into your editor.');
			}
		}

		/* Swapping reverses the morph: the preview now starts on the ring. */
		await tool.locator('[data-swap]').click();
		await expect(tool.locator('[data-from-name]')).toHaveText('ring.svg');
		await expect(tool.locator('[data-to-name]')).toHaveText('square.svg');
		await expect(download).toBeHidden();
		await setValue(tool.locator('[data-scrub]'), 0, 'input');
		expect((await pixelAt(canvas, 0.5, 0.5))[3]).toBe(0);
		expect(await pixelAt(canvas, 0.5, 0.2)).toEqual([0, 0, 255, 255]);

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('The tool has been reset.');
		await expect(tool.locator('[data-preview-card]')).toBeHidden();
		await expect(render).toBeDisabled();
		expect(errors).toEqual([]);
	});

	test('SVG Morph refuses an SVG without morphable geometry and says what it ignored', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/svg-morph/');
		const tool = page.locator('[data-svg-morph]');
		const status = tool.locator('[data-status]');

		await dropSvg(tool.locator('[data-from-file]'), 'text.svg', textSvg);
		await expect(status).toHaveText('text.svg contains no filled or stroked shapes.');
		await expect(status).toHaveAttribute('data-state', 'error');
		await expect(tool.locator('[data-render]')).toBeDisabled();

		await dropSvg(tool.locator('[data-from-file]'), 'broken.svg', '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"></svg>');
		await expect(status).toContainText('broken.svg could not be read as SVG');
		await expect(status).toHaveAttribute('data-state', 'error');

		/* Mixed content keeps the shapes and reports the text it dropped. */
		await dropSvg(tool.locator('[data-from-file]'), 'mixed.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="10" y="50">Hi</text><circle cx="50" cy="50" r="20" fill="#00ff00"/></svg>');
		await expect(status).toHaveText('mixed.svg is loaded: 1 shapes. 1 text, use, or image elements were ignored; convert text to outlines first.');
		await expect(status).toHaveAttribute('data-state', 'info');
		expect(errors).toEqual([]);
	});
});
