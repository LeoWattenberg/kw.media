import { expect, test } from '@playwright/test';

const imageFixture = {
	name: 'fixture.png',
	mimeType: 'image/png',
	buffer: Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
		'base64',
	),
};

const svgSource = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="#2f80ed"/><circle cx="6" cy="4" r="3" fill="#ffffff"/></svg>';
const documentFixture = {
	name: 'conversion-test.md',
	mimeType: 'text/markdown',
	buffer: Buffer.from('# Conversion test\n\nA paragraph with **bold text** and math $x^2 + y^2$.\n'),
};

const toolPages = [
	['/en/tools/', 'Creator Tools', '.tool-folder-grid'],
	['/en/tools/abx-tester/', 'ABX Audio Tester', '[data-abx-tester]'],
	['/en/tools/audio/', 'Audio Tools', '.tool-category-grid'],
	['/en/tools/background-remover/', 'Background Remover', '[data-background-remover]'],
	['/en/tools/background-remover-checkerboard/', 'Checkerboard Background Remover', '[data-background-remover]'],
	['/en/tools/click-to-cut-object-extractor/', 'Click-to-Cut Object Extractor', '[data-object-extractor]'],
	['/en/tools/converter/', 'Converter Tools', '.tool-category-grid'],
	['/en/tools/converter/document-converter/', 'Document Converter', '[data-document-converter]'],
	['/en/tools/converter/image-format-converter/', 'Image Format Converter', '[data-image-converter]'],
	['/en/tools/converter/video-audio-converter/', 'Audio and Video Converter', '[data-video-audio-converter]'],
	['/en/tools/converter/video-to-gif/', 'Video to GIF', '[data-video-gif]'],
	['/en/tools/short-form-safe-zone-previewer/', 'Shorts, TikTok & Reels Safe Zones', '[data-safe-zone-tool]'],
	['/en/tools/subtitle-studio/', 'Subtitle Studio', '[data-combined-subtitle-studio]'],
	['/en/tools/subtitle-burner/', 'Subtitle Burner', '[data-subtitle-burner]'],
	['/en/tools/whisper-subtitle-generator/', 'Whisper Subtitle Generator', '[data-whisper-subtitle-generator]'],
	['/en/tools/crop-doctor/', 'Crop Doctor', '[data-crop-doctor]'],
	['/en/tools/delivery-doctor/', 'Delivery Doctor', '[data-delivery-doctor]'],
	['/en/tools/face-object-redactor/', 'Face/Object Redactor', '[data-redactor]'],
	['/en/tools/image/', 'Image Tools', '.tool-category-grid'],
	['/en/tools/lossless-media-surgeon/', 'Lossless Media Surgeon', '[data-media-surgeon]'],
	['/en/tools/loudness-mastering/', 'Loudness Mastering', '[data-loudness-mastering]'],
	['/en/tools/media-info/', 'MediaInfo', '[data-mediainfo-tool]'],
	['/en/tools/metadata-privacy-scrubber/', 'Metadata Privacy Scrubber', '[data-metadata-scrubber]'],
	['/en/tools/mp3-quality-tester/', 'MP3 Quality Tester', '[data-mp3-quality-tester]'],
	['/en/tools/offline-subtitle-studio/', 'Offline Subtitle Studio', '[data-subtitle-studio]'],
	['/en/tools/podcast-chapterizer/', 'Podcast Chapterizer', '[data-chapterizer]'],
	['/en/tools/podcast-cleaner/', 'Podcast Cleaner', '[data-podcast-cleaner]'],
	['/en/tools/raster-svg-workbench/', 'Raster/SVG Workbench', '[data-raster-svg]'],
	['/en/tools/smart-vertical-reframer/', 'Smart Vertical Reframer', '[data-smart-reframer]'],
	['/en/tools/text/', 'Text Tools', '.tool-category-grid'],
	['/en/tools/vtuber-preview/', 'VTuber Preview', '[data-vtuber-preview]'],
	['/en/tools/video/', 'Video Tools', '.tool-category-grid'],
	['/en/tools/watermarker/', 'Watermarker', '[data-watermarker]'],
	['/en/tools/youtube-thumbnail-preview/', 'YouTube Thumbnail Preview', '[data-thumbnail-preview]'],
	['/en/tools/analyzers/', 'Analyzers', '.tool-category-grid'],
];

test.describe('tool pages browser smoke', () => {
	for (const [path, title, selector] of toolPages) {
		test(`${title} boots without client errors`, async ({ page }) => {
			const errors = collectClientErrors(page);

			await page.goto(path);
			await expect(page.locator(selector)).toBeVisible();
			await expect(page.getByText(title, { exact: false }).first()).toBeVisible();

			expect(errors).toEqual([]);
		});
	}

	test('tools overview behaves as a folder hub and searches child tools', async ({ page }) => {
		const errors = collectClientErrors(page);

		await page.goto('/en/tools/');
		await expect(page.locator('[data-tool-folder-card]')).toHaveCount(6);
		await expect(page.getByRole('link', { name: /Audio Tools/ })).toBeVisible();

		await page.locator('[data-tool-search-input]').fill('documnt');

		await expect(page.locator('[data-folder-grid]')).toBeHidden();
		await expect(page.getByRole('link', { name: /Document Converter/ })).toHaveCount(1);
		await expect(page.getByRole('link', { name: /MediaInfo/ })).toHaveCount(0);
		await expect(page.locator('[data-tool-empty]')).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('category overviews filter their own tool cards', async ({ page }) => {
		const errors = collectClientErrors(page);

		await page.goto('/en/tools/audio/');
		await page.locator('[data-tool-category-search-input]').fill('abx');

		await expect(page.getByRole('link', { name: /ABX Audio Tester/ })).toHaveCount(1);
		await expect(page.getByRole('link', { name: /Podcast Cleaner/ })).toHaveCount(0);
		await expect(page.locator('[data-tool-category-empty]')).toBeHidden();

		await page.goto('/en/tools/converter/');
		await page.locator('[data-tool-category-search-input]').fill('svg');

		await expect(page.getByRole('link', { name: /Raster\/SVG Workbench/ })).toHaveCount(1);
		await expect(page.getByRole('link', { name: /Document Converter/ })).toHaveCount(0);
		await expect(page.locator('[data-tool-category-empty]')).toBeHidden();
		expect(errors).toEqual([]);
	});
});

test.describe('visual tool interactions', () => {
	test('Document converter produces and previews every displayed output format', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.route('https://cdn.jsdelivr.net/npm/pandoc-wasm@1.1.0/+esm', async (route) => {
			await route.fulfill({
				contentType: 'application/javascript',
				body: `export async function convert(options, stdin = '', files = {}) {
					const source = stdin || '# Converted document';
					const to = options.to;
					if (options['output-file']) return { stdout: '', files: { ...files, [options['output-file']]: new Blob(['binary-' + to]) } };
					if (to === 'html') return { stdout: '<!doctype html><html><body><h1>Conversion test</h1><p>Preview output</p></body></html>', files };
					if (to === 'latex') return { stdout: '\\\\section{Conversion test}\\nPreview output', files };
					if (to === 'rtf') return { stdout: '{\\\\rtf1 Conversion test}', files };
					if (to === 'plain') return { stdout: 'Conversion test\\nPreview output', files };
					return { stdout: source, files };
				}`,
			});
		});
		await page.goto('/en/tools/converter/document-converter/');
		await page.locator('[data-file-input]').setInputFiles(documentFixture);

		const profiles = [
			['html', '.html', '[data-html-preview]'],
			['markdown', '.md', '[data-text-preview]'],
			['plain', '.txt', '[data-text-preview]'],
			['pdf', '.pdf', '[data-html-preview]'],
			['docx', '.docx', '[data-html-preview]'],
			['odt', '.odt', '[data-html-preview]'],
			['epub', '.epub', '[data-html-preview]'],
			['latex', '.tex', '[data-html-preview]'],
			['rtf', '.rtf', '[data-text-preview]'],
		];

		for (const [value, extension, preview] of profiles) {
			await page.locator('[data-profile-select]').selectOption(value);
			await page.locator('[data-process]').click();
			await expect(page.locator('[data-status]')).toContainText('successfully', { timeout: 30000 });
			await expect(page.locator('[data-download]')).toBeVisible();
			await expect(page.locator('[data-download]')).toHaveAttribute('download', new RegExp(`\\${extension}$`));
			await expect(page.locator(preview)).toBeVisible();
		}

		expect(errors).toEqual([]);
	});

	test('Whisper subtitle generator prepares its isolated WebAssembly workspace', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/whisper-subtitle-generator/');
		await page.waitForEvent('framenavigated');
		await page.waitForLoadState('load');

		expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
		await expect(page.locator('[data-whisper-subtitle-generator]')).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('Subtitle Studio edits and exports subtitles while switching application modes', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/subtitle-studio/');
		if (!await page.evaluate(() => globalThis.crossOriginIsolated)) {
			await page.waitForEvent('framenavigated');
			await page.waitForLoadState('load');
		}
		expect(errors).toEqual([]);
		await expect(page.locator('[data-combined-subtitle-studio]')).toHaveAttribute('data-bound', 'true');

		await page.locator('[data-text]').fill('1\n00:00:01,000 --> 00:00:03,000\nHello from Subtitle Studio');
		await expect(page.locator('[data-status]')).toContainText('1 subtitle cue');
		await expect(page.locator('[data-download-subtitles]')).toBeVisible();
		await expect(page.locator('[data-download-subtitles]')).toHaveAttribute('download', 'subtitles.srt');

		await page.locator('[data-output-format]').selectOption('vtt');
		await expect(page.locator('[data-download-subtitles]')).toHaveAttribute('download', 'subtitles.vtt');
		await page.locator('[data-apply-mode]').selectOption('hard');
		await expect(page.locator('[data-hard-settings]')).toBeVisible();
		await expect(page.locator('[data-soft-settings]')).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('YouTube thumbnail preview updates image and title previews', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/youtube-thumbnail-preview/');

		await page.locator('[data-thumbnail-file]').setInputFiles(imageFixture);
		await page.locator('[data-title-input]').fill('A deliberately testable thumbnail title');

		await expect(page.locator('[data-preview-image]').first()).toBeVisible();
		await expect(page.locator('[data-thumbnail-placeholder]').first()).toBeHidden();
		await expect(page.locator('[data-title-preview]').first()).toContainText('A deliberately testable thumbnail title');
		await expect(page.locator('[data-file-name]')).toContainText('fixture.png');
		expect(errors).toEqual([]);
	});

	test('Watermarker processes an image watermark in canvas mode', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/watermarker/');

		await page.locator('[data-source-file]').setInputFiles(imageFixture);
		await expect(page.locator('[data-process]')).toBeEnabled();
		await page.locator('[data-process]').click();

		await expect(page.locator('[data-output-preview]')).toBeVisible();
		await expect(page.locator('[data-output-image]')).toBeVisible();
		await expect(page.locator('[data-download]')).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('Object extractor accepts an image and arms the canvas workflow', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/click-to-cut-object-extractor/');

		await page.locator('[data-file]').setInputFiles(imageFixture);

		await expect(page.locator('[data-canvas-wrap]')).toBeVisible();
		await expect(page.locator('[data-canvas]')).toBeVisible();
		await expect(page.locator('[data-cut]')).toBeDisabled();
		await expect(page.locator('[data-file-name]')).toContainText('fixture.png');
		expect(errors).toEqual([]);
	});

	test('Face/Object Redactor loads an image onto its canvas without detection', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/face-object-redactor/');

		await page.locator('[data-file]').setInputFiles(imageFixture);

		await expect(page.locator('[data-canvas]')).toBeVisible();
		await expect(page.locator('[data-detect]')).toBeEnabled();
		await expect(page.locator('[data-apply]')).toBeDisabled();
		expect(errors).toEqual([]);
	});

	test('Raster/SVG Workbench rasterizes inline SVG without remote libraries', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/raster-svg-workbench/');

		await page.locator('[data-mode]').selectOption('png');
		await page.locator('[data-svg-text]').fill(svgSource);
		await page.locator('[data-run]').click();

		await expect(page.locator('[data-preview]')).toBeVisible();
		await expect(page.locator('[data-download-png]')).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('Background remover previews an uploaded image before CDN-backed removal', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/background-remover/');

		await page.locator('[data-file]').setInputFiles(imageFixture);

		await expect(page.locator('[data-source-preview]')).toBeVisible();
		await expect(page.locator('[data-source-image]')).toBeVisible();
		await expect(page.locator('[data-file-name]')).toContainText('fixture.png');
		expect(errors).toEqual([]);
	});

	test('VTuber preview initializes the 3D avatar scene on load', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/vtuber-preview/');

		const canvas = page.locator('[data-avatar-canvas]');
		await expect(canvas).toBeVisible();
		await expect(page.locator('[data-scene-label]')).toContainText('3D scene ready.');
		await expect(page.locator('[data-render-badge]')).toBeHidden();
		await expect.poll(() => canvas.evaluate((node) => {
			const rect = node.getBoundingClientRect();
			return node.width > 0 && node.height > 0 && rect.width > 0 && rect.height > 0;
		})).toBe(true);
		expect(errors).toEqual([]);
	});
});

function collectClientErrors(page) {
	const errors = [];

	page.on('pageerror', (error) => {
		errors.push(error.message);
	});

	page.on('console', (message) => {
		if (message.type() === 'error') {
			const source = message.location().url;
			errors.push(source ? `${message.text()} (${source})` : message.text());
		}
	});

	return errors;
}
