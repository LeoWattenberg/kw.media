import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createAup3Fixture } from '../aup3-fixture.js';

// Committed fixtures live in tests/fixtures/. The heavy media fixtures are still
// local-only under the gitignored reference/, so tests that need them skip in CI
// rather than failing the whole suite.
const findFixture = (name) => [
	fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)),
	fileURLToPath(new URL(`../../reference/${name}`, import.meta.url)),
].find((candidate) => existsSync(candidate));

const referenceFile = (name) => {
	const found = findFixture(name);
	test.skip(!found, `missing fixture ${name} (expected in tests/fixtures/ or reference/)`);
	return found;
};

// Uploaded under its original spaced name so the generated download keeps it.
const odtUpload = () => ({
	name: 'legal document.odt',
	mimeType: 'application/vnd.oasis.opendocument.text',
	buffer: readFileSync(referenceFile('legal-document.odt')),
});

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

const createWavFixture = ({ duration = 1, sampleRate = 8000, frequency = 440 } = {}) => {
	const sampleCount = Math.round(duration * sampleRate);
	const buffer = Buffer.alloc(44 + sampleCount * 2);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + sampleCount * 2, 4);
	buffer.write('WAVEfmt ', 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * 2, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(sampleCount * 2, 40);
	for (let index = 0; index < sampleCount; index += 1) {
		buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * 16000), 44 + index * 2);
	}
	return { name: 'analyzer-tone.wav', mimeType: 'audio/wav', buffer };
};

const toolPages = [
	['/en/tools/', 'Creator Tools', '.tool-folder-grid'],
	['/en/tools/abx-tester/', 'ABX Audio Tester', '[data-abx-tester]'],
	['/en/tools/audio-analyzer/', 'Audio Analyzer', '[data-audio-analyzer]'],
	['/en/tools/audio/', 'Audio Tools', '.tool-category-grid'],
	['/en/tools/background-remover/', 'Background Remover', '[data-background-remover]'],
	['/en/tools/background-remover-checkerboard/', 'Checkerboard Background Remover', '[data-background-remover]'],
	['/en/tools/image-object-extractor/', 'Image Object Extractor', '[data-object-extractor]'],
	['/en/tools/converter/', 'Converter Tools', '.tool-category-grid'],
	['/en/tools/converter/aup3-to-wav/', 'AUP3 to WAV', '[data-aup3-wav-converter]'],
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
	['/en/tools/soundscaper-commit-graph/', 'Soundscaper Commit Graph', '[data-commit-graph]'],
	['/en/tools/analyzers/', 'Analyzers', '.tool-category-grid'],
];

const stubGitHubCommits = async (page, commits) => {
	const body = JSON.stringify(commits.map(({ date, merge = false }, index) => ({
		sha: `${index}`.padStart(40, 'a'),
		commit: { author: { date } },
		parents: merge ? [{ sha: 'first' }, { sha: 'second' }] : [{ sha: 'first' }],
	})));

	await page.route('https://api.github.com/**', (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		headers: { 'access-control-allow-origin': '*', 'x-ratelimit-remaining': '59', 'x-ratelimit-limit': '60' },
		body,
	}));
};

const stubCommitSnapshot = async (page, commits, generatedAt) => {
	const merges = commits.flatMap(({ merge = false }, index) => merge ? [index] : []);
	const body = JSON.stringify({
		repo: 'LeoWattenberg/Soundscaper',
		windowDays: 30,
		truncated: false,
		generatedAt,
		timestamps: commits.map(({ date }) => date),
		merges,
	});

	await page.route('**/data/soundscaper-commits.json', (route) => route.fulfill({
		status: 200,
		contentType: 'application/json',
		body,
	}));
};

test.describe('tool pages browser smoke', () => {
	test.beforeEach(async ({ page }) => {
		const recent = [{ date: new Date(Date.now() - 3_600_000).toISOString() }];
		await stubCommitSnapshot(page, recent, new Date(Date.now() - 60_000).toISOString());
		await stubGitHubCommits(page, recent);
	});

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
	test('AUP3 to WAV creates a local 16-bit dry mix', async ({ page }) => {
		const errors = collectClientErrors(page);
		const fixture = await createAup3Fixture();
		await page.goto('/en/tools/converter/aup3-to-wav/');
		const converter = page.locator('[data-aup3-wav-converter]');
		await expect(converter.locator('[data-large-mode]')).toHaveCount(0);

		await converter.locator('[data-file-input]').setInputFiles({
			name: 'Browser project.aup3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(fixture),
		});
		await expect(converter.locator('[data-convert]')).toBeEnabled();
		await converter.locator('[data-convert]').click();

		await expect(converter.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		await expect(converter.locator('[data-status]')).toHaveText('The dry WAV mix is ready.');
		await expect(converter.locator('[data-output]')).toBeVisible();
		await expect(converter.locator('[data-result-title]')).toHaveText('Browser project');
		await expect(converter.locator('[data-result-meta]')).toContainText('48,000 Hz');
		await expect(converter.locator('[data-result-meta]')).toContainText('1 channel');
		await expect(converter.locator('[data-result-meta]')).toContainText('1 track');
		await expect(converter.locator('[data-result-meta]')).toContainText('16-bit PCM');
		await expect(converter.locator('[data-output-audio]')).toBeVisible();

		const download = converter.locator('[data-download]');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'Browser project.wav');
		const wav = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			return {
				riff: new TextDecoder().decode(bytes.subarray(0, 4)),
				wave: new TextDecoder().decode(bytes.subarray(8, 12)),
				format: view.getUint16(20, true),
				channels: view.getUint16(22, true),
				sampleRate: view.getUint32(24, true),
				bitDepth: view.getUint16(34, true),
				byteLength: bytes.byteLength,
			};
		});
		expect(wav).toEqual({
			riff: 'RIFF',
			wave: 'WAVE',
			format: 1,
			channels: 1,
			sampleRate: 48_000,
			bitDepth: 16,
			byteLength: 52,
		});
		expect(errors).toEqual([]);
	});

	test('asks before converting an AUP3 file larger than 256 MB', async ({ page }) => {
		await page.goto('/en/tools/converter/aup3-to-wav/');
		const converter = page.locator('[data-aup3-wav-converter]');
		await converter.locator('[data-file-input]').evaluate((input) => {
			const file = new File([''], 'large-project.aup3', { type: 'application/octet-stream' });
			Object.defineProperty(file, 'size', { value: 257 * 1024 * 1024 });
			const transfer = new DataTransfer();
			transfer.items.add(file);
			input.files = transfer.files;
			input.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await expect(converter.locator('[data-convert]')).toBeEnabled();

		const dialogPromise = page.waitForEvent('dialog').then(async (dialog) => {
			expect(dialog.type()).toBe('confirm');
			expect(dialog.message()).toContain('exceeds 256 MB');
			await dialog.dismiss();
		});
		await Promise.all([dialogPromise, converter.locator('[data-convert]').click()]);
		await expect(converter.locator('[data-status]')).toHaveText('Conversion cancelled.');
	});

	test('Audio Analyzer renders local audio and updates a time-frequency selection', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/audio-analyzer/');
		await page.locator('[data-file-input]').setInputFiles(createWavFixture());
		await expect(page.locator('[data-workspace]')).toBeVisible();
		await expect(page.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await expect(page.locator('[data-metric="peak"]')).not.toHaveText('—');
		await expect(page.locator('[data-audio]')).toBeHidden();

		const waveform = page.locator('[data-waveform]');
		const canvas = page.locator('[data-spectrogram]');
		await waveform.scrollIntoViewIfNeeded();
		const waveformBox = await waveform.boundingBox();
		expect(waveformBox).not.toBeNull();
		await page.mouse.click(waveformBox.x + waveformBox.width * 0.35, waveformBox.y + waveformBox.height * 0.5);
		const playbackOrigin = await page.locator('[data-audio]').evaluate((audio) => audio.currentTime);

		await page.locator('[data-play-pause]').click();
		await expect(page.locator('[data-play-pause]')).toHaveAttribute('data-state', 'playing');
		await page.waitForFunction((origin) => document.querySelector('[data-audio]').currentTime > origin + 0.05, playbackOrigin);
		await page.locator('[data-play-pause]').click();
		await expect(page.locator('[data-play-pause]')).toHaveAttribute('data-state', 'paused');
		const pausedAt = await page.locator('[data-audio]').evaluate((audio) => audio.currentTime);
		await page.locator('[data-play-pause]').click();
		await page.waitForFunction((paused) => document.querySelector('[data-audio]').currentTime > paused + 0.03, pausedAt);
		await page.locator('[data-play-pause]').click();
		await page.locator('[data-stop]').click();
		await expect(page.locator('[data-play-pause]')).toHaveAttribute('data-state', 'stopped');
		const stoppedAt = await page.locator('[data-audio]').evaluate((audio) => audio.currentTime);
		expect(stoppedAt).toBeCloseTo(playbackOrigin, 1);

		await page.locator('[data-skip-start]').click();
		await expect.poll(() => page.locator('[data-audio]').evaluate((audio) => audio.currentTime)).toBeCloseTo(0, 2);
		const waveformPlayhead = Number(await waveform.getAttribute('data-playhead-time'));
		const spectrogramPlayhead = Number(await page.locator('[data-spectrogram]').getAttribute('data-playhead-time'));
		expect(waveformPlayhead).toBeCloseTo(spectrogramPlayhead, 5);

		await page.evaluate(() => document.activeElement?.blur());
		await page.keyboard.press('Space');
		await expect(page.locator('[data-play-pause]')).toHaveAttribute('data-state', 'playing');
		await page.keyboard.press('Space');
		await expect(page.locator('[data-play-pause]')).toHaveAttribute('data-state', 'paused');
		await page.keyboard.press('Control+Space');
		await expect(page.locator('[data-play-pause]')).toHaveAttribute('data-state', 'stopped');

		await waveform.scrollIntoViewIfNeeded();
		const zoomWaveformBox = await waveform.boundingBox();
		expect(zoomWaveformBox).not.toBeNull();
		await page.mouse.move(zoomWaveformBox.x + zoomWaveformBox.width * 0.5, zoomWaveformBox.y + zoomWaveformBox.height * 0.5);
		await page.mouse.wheel(0, -240);
		await expect.poll(async () => {
			const start = Number(await waveform.getAttribute('data-view-start'));
			const end = Number(await waveform.getAttribute('data-view-end'));
			return end - start;
		}).toBeLessThan(0.8);
		const zoomedStart = Number(await waveform.getAttribute('data-view-start'));
		await page.keyboard.down('Shift');
		await page.mouse.wheel(0, 120);
		await page.keyboard.up('Shift');
		await expect.poll(() => waveform.getAttribute('data-view-start').then(Number)).toBeGreaterThan(zoomedStart);
		expect(Number(await waveform.getAttribute('data-view-start'))).toBeCloseTo(Number(await canvas.getAttribute('data-view-start')), 5);
		expect(Number(await waveform.getAttribute('data-view-end'))).toBeCloseTo(Number(await canvas.getAttribute('data-view-end')), 5);

		await canvas.scrollIntoViewIfNeeded();
		const box = await canvas.boundingBox();
		expect(box).not.toBeNull();
		const fullFrequencyHigh = Number(await canvas.getAttribute('data-view-high-frequency'));

		const scaleX = box.x + box.width * 0.03;
		await page.mouse.move(scaleX, box.y + box.height * 0.68);
		await page.mouse.down();
		await page.mouse.move(scaleX, box.y + box.height * 0.34);
		await page.mouse.up();
		await expect.poll(async () => {
			const low = Number(await canvas.getAttribute('data-view-low-frequency'));
			const high = Number(await canvas.getAttribute('data-view-high-frequency'));
			return high - low;
		}).toBeLessThan(fullFrequencyHigh * 0.8);
		const frequencyLowBeforePan = Number(await canvas.getAttribute('data-view-low-frequency'));
		await page.keyboard.down('Control');
		await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
		await page.mouse.wheel(0, -100);
		await page.keyboard.up('Control');
		await expect.poll(() => canvas.getAttribute('data-view-low-frequency').then(Number)).not.toBe(frequencyLowBeforePan);

		await page.mouse.dblclick(scaleX, box.y + box.height * 0.5);
		await expect.poll(() => canvas.getAttribute('data-view-low-frequency').then(Number)).toBeCloseTo(0, 2);
		await expect.poll(() => canvas.getAttribute('data-view-high-frequency').then(Number)).toBeCloseTo(fullFrequencyHigh, 2);
		await page.mouse.move(scaleX, box.y + box.height * 0.68);
		await page.mouse.down();
		await page.mouse.move(scaleX, box.y + box.height * 0.48);
		await page.mouse.up();
		await page.keyboard.down('Control');
		await page.mouse.click(scaleX, box.y + box.height * 0.5);
		await page.keyboard.up('Control');
		await expect.poll(() => canvas.getAttribute('data-view-high-frequency').then(Number)).toBeCloseTo(fullFrequencyHigh, 2);

		await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.75);
		await page.mouse.up();
		await expect(page.locator('[data-clear-selection]')).toBeEnabled();
		await expect(page.locator('[data-selection-summary]')).toContainText('Hz');
		expect(errors).toEqual([]);
	});

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
		await page.locator('[data-file-input]').setInputFiles(odtUpload());
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

	test('Soundscaper commit graph charts the CI snapshot and reloads live data on demand', async ({ page }) => {
		const errors = collectClientErrors(page);
		const peak = new Date(Date.now() - 3 * 60 * 60 * 1000);
		peak.setUTCMinutes(0, 0, 0);
		const peakIso = peak.toISOString();
		const earlierIso = new Date(peak.getTime() - 25 * 60 * 60 * 1000).toISOString();
		const hourLabel = (date) => `${String(date.getUTCHours()).padStart(2, '0')}:00`;
		const nextHour = new Date(peak.getTime() + 60 * 60 * 1000);

		await stubCommitSnapshot(page, [
			{ date: peakIso },
			{ date: peakIso },
			{ date: peakIso, merge: true },
			{ date: earlierIso },
		], new Date(Date.now() - 90 * 60 * 1000).toISOString());
		await stubGitHubCommits(page, [
			{ date: peakIso },
			{ date: peakIso },
			{ date: peakIso, merge: true },
			{ date: earlierIso },
			{ date: earlierIso },
		]);
		await page.goto('/en/tools/soundscaper-commit-graph/');
		const tool = page.locator('[data-commit-graph]');

		await expect(tool.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await expect(tool.locator('[data-status]')).toHaveText('4 commits from the site snapshot (1 hour old). Reload for live data.');
		await expect(tool.locator('[data-stat-total]')).toHaveText('4');
		await expect(tool.locator('[data-stat-hour]')).toHaveText(`${hourLabel(peak)}–${hourLabel(nextHour)}`);
		await expect(tool.locator('[data-stat-hour-note]')).toHaveText('3 commits');
		await expect(tool.locator('.chart-bar')).toHaveCount(24);
		await expect(tool.locator('.heat-cell')).toHaveCount(30 * 24);

		const filledCells = tool.locator('.heat-cell:not([data-level="0"])');
		await expect(filledCells).toHaveCount(2);
		const levels = await filledCells.evaluateAll((cells) => cells.map((cell) => Number(cell.dataset.level)));
		expect(Math.max(...levels)).toBeGreaterThan(Math.min(...levels));

		await tool.locator('[data-reload]').click();
		await expect(tool.locator('[data-status]')).toHaveText('5 commits loaded live from GitHub across 1 request.');
		await expect(tool.locator('[data-stat-total]')).toHaveText('5');

		await tool.locator('[data-merges]').uncheck();
		await expect(tool.locator('[data-stat-total]')).toHaveText('4');
		await expect(tool.locator('[data-stat-hour-note]')).toHaveText('2 commits');
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
