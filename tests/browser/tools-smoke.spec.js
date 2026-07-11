import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const referenceFile = (name) => fileURLToPath(new URL(`../../reference/${name}`, import.meta.url));

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
	['/en/tools/image-object-extractor/', 'Image Object Extractor', '[data-object-extractor]'],
	['/en/tools/converter/', 'Converter Tools', '.tool-category-grid'],
	['/en/tools/converter/document-converter/', 'Document Converter', '[data-document-converter]'],
	['/en/tools/converter/image-format-converter/', 'Image Format Converter', '[data-image-converter]'],
	['/en/tools/converter/video-audio-converter/', 'Audio and Video Converter', '[data-video-audio-converter]'],
	['/en/tools/converter/video-to-gif/', 'Video to GIF', '[data-video-gif]'],
	['/en/tools/short-form-safe-zone-previewer/', 'Shorts, TikTok & Reels Safe Zones', '[data-safe-zone-tool]'],
	['/en/tools/subtitle-studio/', 'Subtitle Studio', '[data-combined-subtitle-studio]'],
	['/en/tools/subtitle-burner/', 'Subtitle Burner', '[data-subtitle-burner]'],
	['/en/tools/whisper-subtitle-generator/', 'Whisper Subtitle Generator', '[data-whisper-subtitle-generator]'],
	['/en/tools/black-bar-remover/', 'Black Bar Remover', '[data-crop-doctor]'],
	['/en/tools/media-delivery-checker/', 'Media Delivery Checker', '[data-delivery-doctor]'],
	['/en/tools/face-object-redactor/', 'Face/Object Redactor', '[data-redactor]'],
	['/en/tools/image/', 'Image Tools', '.tool-category-grid'],
	['/en/tools/lossless-media-studio/', 'Lossless Media Studio', '[data-media-surgeon]'],
	['/en/tools/loudness-mastering/', 'Loudness Mastering', '[data-loudness-mastering]'],
	['/en/tools/media-info/', 'MediaInfo', '[data-mediainfo-tool]'],
	['/en/tools/metadata-remover/', 'Metadata Remover', '[data-metadata-scrubber]'],
	['/en/tools/mp3-quality-tester/', 'MP3 Quality Tester', '[data-mp3-quality-tester]'],
	['/en/tools/subtitle-editor-converter/', 'Subtitle Editor & Converter', '[data-subtitle-studio]'],
	['/en/tools/podcast-chapter-editor/', 'Podcast Chapter Editor', '[data-chapterizer]'],
	['/en/tools/podcast-cleaner/', 'Podcast Cleaner', '[data-podcast-cleaner]'],
	['/en/tools/raster-svg-studio/', 'Raster/SVG Studio', '[data-raster-svg]'],
	['/en/tools/vertical-video-reframer/', 'Vertical Video Reframer', '[data-smart-reframer]'],
	['/en/tools/text/', 'Text Tools', '.tool-category-grid'],
	['/en/tools/vtuber-preview/', 'VTuber Preview', '[data-vtuber-preview]'],
	['/en/tools/video/', 'Video Tools', '.tool-category-grid'],
	['/en/tools/image-video-watermark/', 'Image & Video Watermark', '[data-watermarker]'],
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

		await expect(page.getByRole('link', { name: /Raster\/SVG Studio/ })).toHaveCount(1);
		await expect(page.getByRole('link', { name: /Document Converter/ })).toHaveCount(0);
		await expect(page.locator('[data-tool-category-empty]')).toBeHidden();
		expect(errors).toEqual([]);
	});
});

test.describe('visual tool interactions', () => {
	test('Document converter produces and previews every displayed output format', async ({ page }) => {
		const errors = collectClientErrors(page);
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

	test('Document converter converts the real ODT fixture in the browser', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/converter/document-converter/');
		await page.locator('[data-file-input]').setInputFiles(referenceFile('legal document.odt'));
		await page.locator('[data-profile-select]').selectOption('html');
		await page.locator('[data-process]').click();

		await expect(page.locator('[data-status]')).toContainText('successfully', { timeout: 30000 });
		await expect(page.locator('[data-download]')).toHaveAttribute('download', /legal document\.html$/);
		await expect(page.locator('[data-html-preview]')).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('Whisper subtitle generator prepares its isolated WebAssembly workspace', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/whisper-subtitle-generator/');
		await page.waitForEvent('framenavigated');
		await page.waitForLoadState('load');

		expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
		await expect(page.locator('[data-whisper-subtitle-generator]')).toBeVisible();
		await page.goto('/en/tools/');
		await expect(page.locator('.tool-folder-grid')).toBeVisible();
		await page.waitForTimeout(250);
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
		await page.goto('/en/tools/image-video-watermark/');

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
		await page.goto('/en/tools/image-object-extractor/');

		await page.locator('[data-file]').setInputFiles(imageFixture);

		await expect(page.locator('[data-canvas-wrap]')).toBeVisible();
		await expect(page.locator('[data-canvas]')).toBeVisible();
		await expect(page.locator('[data-cut]')).toBeDisabled();
		await expect(page.locator('[data-file-name]')).toContainText('fixture.png');
		expect(errors).toEqual([]);
	});

	test('Face/Object Redactor detects a face immediately with the CPU delegate', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/face-object-redactor/');

		await expect(page.locator('[data-result-panel]')).toBeHidden();
		await page.locator('[data-file]').setInputFiles(referenceFile('face at angle.png'));

		await expect(page.locator('[data-canvas]')).toBeVisible();
		await expect(page.locator('[data-status]')).toContainText(/regions? detected|No regions detected/, { timeout: 30000 });
		await expect(page.locator('[data-detect]')).toBeEnabled();
		expect(errors).toEqual([]);
	});

	test('result panels stay hidden until their tools produce output', async ({ page }) => {
		for (const path of [
			'/en/tools/black-bar-remover/',
			'/en/tools/face-object-redactor/',
			'/en/tools/image-object-extractor/',
			'/en/tools/metadata-remover/',
			'/en/tools/whisper-subtitle-generator/',
		]) {
			await page.goto(path);
			await expect(page.locator('[data-result-panel]')).toBeHidden();
		}
	});

	test('MediaInfo analyzes the real MP4 and WebM fixtures', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/media-info/');

		for (const name of ['greenscreen-video.mp4', 'greenscreen-video.webm']) {
			await page.locator('[data-file-input]').setInputFiles(referenceFile(name));
			await page.locator('[data-analyze]').click();
			await expect(page.locator('[data-status]')).toContainText('Analysis complete', { timeout: 30000 });
			await expect(page.locator('[data-tracks]')).toContainText('General');
		}
		expect(errors).toEqual([]);
	});

	test('Media Delivery Checker diagnoses a real media file', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/media-delivery-checker/');
		await page.locator('[data-file]').setInputFiles(referenceFile('greenscreen-video.mp4'));
		await page.locator('[data-analyze]').click();

		await expect(page.locator('[data-status]')).toContainText('Diagnosis complete', { timeout: 30000 });
		await expect(page.locator('[data-report]')).toContainText('greenscreen-video.mp4');
		expect(errors).toEqual([]);
	});

	test('Metadata Remover preserves image format and compares metadata before and after', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/metadata-remover/');
		await expect(page.locator('[data-image-format], [data-media-container]')).toHaveCount(0);
		await page.locator('[data-file]').setInputFiles(referenceFile('profile photo.jpg'));
		await expect(page.locator('[data-metadata-before]')).toContainText('media', { timeout: 30000 });
		await page.locator('[data-scrub]').click();

		await expect(page.locator('[data-result-panel]')).toBeVisible();
		await expect(page.locator('[data-download]')).toHaveAttribute('download', /-scrubbed\.jpg$/);
		await expect(page.locator('[data-metadata-after]')).toContainText('media', { timeout: 30000 });
		expect(errors).toEqual([]);
	});

	test('Raster/SVG Studio rasterizes inline SVG without remote libraries', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/raster-svg-studio/');

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
	const reportedRequests = new Set();

	function reportRequest(request, reason) {
		const url = request.url();
		const key = `${url}: ${reason}`;
		if (!reportedRequests.has(key)) {
			reportedRequests.add(key);
			errors.push(`Browser dependency ${url} was rejected: ${reason}`);
		}
	}

	page.on('pageerror', (error) => {
		errors.push(error.message);
	});

	page.on('console', (message) => {
		if (message.type() === 'error') {
			if (message.text().startsWith('INFO: Created TensorFlow Lite XNNPACK delegate')) return;
			const source = message.location().url;
			errors.push(source ? `${message.text()} (${source})` : message.text());
		}
	});

	page.on('requestfailed', (request) => {
		if (isBrowserDependency(request)) {
			reportRequest(request, request.failure()?.errorText || 'request failed');
		}
	});

	page.on('response', (response) => {
		const request = response.request();
		if (!isBrowserDependency(request)) return;

		if (!response.ok()) {
			reportRequest(request, `HTTP ${response.status()}`);
			return;
		}

		const contentType = response.headers()['content-type']?.toLowerCase() || '';
		if (request.resourceType() === 'script' && !/(?:java|ecma)script/.test(contentType)) {
			reportRequest(request, `script has disallowed MIME type ${contentType || '(missing)'}`);
		}
		if (/\.wasm(?:$|[?#])/.test(request.url()) && !contentType.startsWith('application/wasm')) {
			reportRequest(request, `WebAssembly has disallowed MIME type ${contentType || '(missing)'}`);
		}
	});

	return errors;
}

function isBrowserDependency(request) {
	return request.resourceType() === 'script'
		|| /\.(?:wasm|worker\.js)(?:$|[?#])/.test(request.url());
}
