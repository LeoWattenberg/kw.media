// Subtitle and video tools: the assertions here are about the artifacts the tools
// hand back — the cue text inside a downloaded SRT/WebVTT, the container magic of a
// muxed file, the frame size stored in a rendered MP4, the parsed MediaInfo report —
// rather than about a status line changing colour.
import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { cacheCdnAssets } from './cdn-cache.mjs';

const fixture = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

/* Two cues that stay distinguishable after an offset: the first one is the one a
   negative offset squeezes out of the timeline. */
const SRT_SOURCE = '1\n00:00:00,000 --> 00:00:01,000\nFirst cue\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond cue';

const vttUpload = {
	name: 'captions.vtt',
	mimeType: 'text/vtt',
	buffer: Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nFrom a file\n'),
};

/* Accepted by every picker in this group, decodable by nothing. */
const undecodableUpload = {
	name: 'broken-source.mkv',
	mimeType: 'video/x-matroska',
	buffer: Buffer.from('this is not a matroska file'),
};

/* A real RIFF/WAVE file, built the way the other specs build their tones. Loaded
   into a <video> it decodes fine and reports no picture, which is the audio-only
   source the reframer must refuse instead of cropping 0x0. */
const createWavUpload = ({ name = 'voice-over.wav', seconds = 1, sampleRate = 44_100, frequency = 440 } = {}) => {
	const sampleCount = Math.round(seconds * sampleRate);
	const data = Buffer.alloc(8 + sampleCount * 2);
	data.write('data', 0);
	data.writeUInt32LE(sampleCount * 2, 4);
	for (let index = 0; index < sampleCount; index += 1) {
		data.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * 16_000), 8 + index * 2);
	}

	const fmt = Buffer.alloc(24);
	fmt.write('fmt ', 0);
	fmt.writeUInt32LE(16, 4);
	fmt.writeUInt16LE(1, 8);
	fmt.writeUInt16LE(1, 10);
	fmt.writeUInt32LE(sampleRate, 12);
	fmt.writeUInt32LE(sampleRate * 2, 16);
	fmt.writeUInt16LE(2, 20);
	fmt.writeUInt16LE(16, 22);

	const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), fmt, data]);
	const header = Buffer.alloc(8);
	header.write('RIFF', 0);
	header.writeUInt32LE(body.length, 4);
	return { name, mimeType: 'audio/wav', buffer: Buffer.concat([header, body]) };
};

/* A clip whose every frame is black. No committed fixture is dark enough to leave
   the crop scans with nothing to stop at, so this records one in the page exactly
   the way scripts/generate-test-fixtures.mjs mints the committed media. */
const recordBlackClip = async (page) => {
	const clip = await page.evaluate(async () => {
		const mimeType = ['video/mp4', 'video/webm;codecs=vp8', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type));
		if (!mimeType) throw new Error('This browser cannot record a black test clip.');
		const canvas = document.createElement('canvas');
		canvas.width = 160;
		canvas.height = 120;
		const context = canvas.getContext('2d');
		/* Chromium only pushes a frame into the stream when the canvas changes. */
		const paint = () => { context.fillStyle = '#000000'; context.fillRect(0, 0, 160, 120); };
		paint();
		const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType, videoBitsPerSecond: 120_000 });
		const chunks = [];
		recorder.ondataavailable = (event) => chunks.push(event.data);
		recorder.start();
		const timer = setInterval(paint, 66);
		await new Promise((resolve) => setTimeout(resolve, 1000));
		clearInterval(timer);
		await new Promise((resolve) => { recorder.onstop = resolve; recorder.stop(); });
		const blob = new Blob(chunks, { type: mimeType });
		return { mimeType: mimeType.split(';')[0], bytes: [...new Uint8Array(await blob.arrayBuffer())] };
	});

	/* A still black frame compresses to almost nothing, so this only proves a real
	   container came back rather than an empty blob. */
	expect(clip.bytes.length).toBeGreaterThan(100);
	return {
		name: clip.mimeType === 'video/mp4' ? 'all-black.mp4' : 'all-black.webm',
		mimeType: clip.mimeType,
		buffer: Buffer.from(clip.bytes),
	};
};

const downloadText = (link) => link.evaluate(async (node) => {
	const response = await fetch(node.href);
	return { type: response.headers.get('content-type'), text: await response.text() };
});

const downloadBinary = (link) => link.evaluate(async (node) => {
	const response = await fetch(node.href);
	const bytes = new Uint8Array(await response.arrayBuffer());
	return {
		type: response.headers.get('content-type'),
		byteLength: bytes.byteLength,
		magic: [...bytes.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		boxType: new TextDecoder().decode(bytes.subarray(4, 8)),
	};
});

/* The Whisper tools register a COI service worker and reload themselves once. */
const waitForIsolation = async (page) => {
	await expect
		.poll(() => page.evaluate(() => globalThis.crossOriginIsolated).catch(() => false), { timeout: 30_000 })
		.toBe(true);
};

test.describe('subtitle editor and converter', () => {
	test('cue count follows the timing offset that will actually be exported', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/subtitle-editor-converter/');
		const tool = page.locator('[data-subtitle-studio]');
		const status = tool.locator('[data-status]');

		await tool.locator('[data-text]').fill(SRT_SOURCE);
		await expect(status).toHaveText('2 subtitle cues detected.');
		await expect(status).toHaveAttribute('data-state', 'success');

		/* -1 s clamps the first cue to zero length, so only one cue can still be written. */
		await tool.locator('[data-offset]').fill('-1');
		await expect(tool.locator('[data-offset-label]')).toHaveText('-1.0s');
		await expect(status).toHaveText('1 subtitle cues detected.');

		await tool.locator('[data-convert]').click();
		const download = tool.locator('[data-download-subtitles]');
		await expect(download).toBeVisible();
		const exported = await downloadText(download);
		expect(exported.text).toBe('1\n00:00:01,000 --> 00:00:03,000\nSecond cue\n');

		/* Nothing survives -30 s, and the tool has to say so before the export fails. */
		await tool.locator('[data-offset]').fill('-30');
		await expect(status).toHaveText('Load subtitles or paste text.');
		await expect(status).toHaveAttribute('data-state', 'info');
		await tool.locator('[data-convert]').click();
		await expect(status).toHaveText('Action failed: No valid subtitle cues found.');
		await expect(status).toHaveAttribute('data-state', 'error');
		expect(errors).toEqual([]);
	});

	test('exports SRT and WebVTT bodies with the chosen format, name, and MIME type', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/subtitle-editor-converter/');
		const tool = page.locator('[data-subtitle-studio]');
		const download = tool.locator('[data-download-subtitles]');

		await tool.locator('[data-text]').fill(SRT_SOURCE);
		await tool.locator('[data-offset]').fill('1.5');
		await tool.locator('[data-convert]').click();
		await expect(download).toHaveAttribute('download', 'subtitles.srt');
		const srt = await downloadText(download);
		expect(srt.type).toBe('text/plain');
		expect(srt.text).toBe([
			'1',
			'00:00:01,500 --> 00:00:02,500',
			'First cue',
			'',
			'2',
			'00:00:03,500 --> 00:00:05,500',
			'Second cue',
			'',
		].join('\n'));
		await expect(tool.locator('[data-result]')).toHaveText('subtitles.srt was created.');

		await tool.locator('[data-output-format]').selectOption('vtt');
		await tool.locator('[data-convert]').click();
		await expect(download).toHaveAttribute('download', 'subtitles.vtt');
		const vtt = await downloadText(download);
		expect(vtt.type).toBe('text/vtt');
		expect(vtt.text).toBe([
			'WEBVTT',
			'',
			'00:00:01.500 --> 00:00:02.500',
			'First cue',
			'',
			'00:00:03.500 --> 00:00:05.500',
			'Second cue',
			'',
		].join('\n'));
		expect(errors).toEqual([]);
	});

	test('loads a WebVTT file, converts it to SRT, and resets every control', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/subtitle-editor-converter/');
		const tool = page.locator('[data-subtitle-studio]');
		const status = tool.locator('[data-status]');
		const download = tool.locator('[data-download-subtitles]');

		await tool.locator('[data-subtitles]').setInputFiles(vttUpload);
		await expect(tool.locator('[data-subtitle-name]')).toHaveText('captions.vtt');
		await expect(tool.locator('[data-text]')).toHaveValue('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nFrom a file\n');
		await expect(status).toHaveText('1 subtitle cues detected.');

		/* Reading the source as WebVTT explicitly must produce the same cue as auto. */
		await tool.locator('[data-input-format]').selectOption('vtt');
		await tool.locator('[data-convert]').click();
		const exported = await downloadText(download);
		expect(exported.text).toBe('1\n00:00:01,000 --> 00:00:02,500\nFrom a file\n');

		await tool.locator('[data-media]').setInputFiles(fixture('tiny-clip.mp4'));
		await expect(tool.locator('[data-preview]')).toBeVisible();
		await expect(tool.locator('[data-media-name]')).toHaveText('tiny-clip.mp4');
		await expect(tool.locator('[data-media-meta]')).toContainText('2.8 KB');

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-text]')).toHaveValue('');
		await expect(tool.locator('[data-offset-label]')).toHaveText('0.0s');
		await expect(tool.locator('[data-offset]')).toHaveValue('0');
		await expect(download).toBeHidden();
		await expect(tool.locator('[data-preview]')).toBeHidden();
		await expect(tool.locator('[data-media-name]')).toHaveText('Choose audio or video');
		await expect(tool.locator('[data-subtitle-name]')).toHaveText('Choose SRT or VTT');
		await expect(tool.locator('[data-result]')).toHaveText('Load subtitles or paste text.');
		await expect(status).toHaveText('Load subtitles or paste text.');
		expect(errors).toEqual([]);
	});

	test('reports the missing media file instead of starting FFmpeg', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/subtitle-editor-converter/');
		const tool = page.locator('[data-subtitle-studio]');

		await tool.locator('[data-text]').fill(SRT_SOURCE);
		await tool.locator('[data-mux]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Choose a media file first.');
		await expect(tool.locator('[data-status]')).toHaveAttribute('data-state', 'error');
		await expect(tool.locator('[data-download-media]')).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('muxes into the container that was selected when the run started', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/subtitle-editor-converter/');
		const tool = page.locator('[data-subtitle-studio]');

		await tool.locator('[data-media]').setInputFiles(fixture('tiny-clip.mp4'));
		await tool.locator('[data-text]').fill(SRT_SOURCE);
		await tool.locator('[data-container]').selectOption('mkv');
		await tool.locator('[data-mux]').click();
		/* Switching the select mid-run must not rename or re-type the bytes FFmpeg is producing. */
		await tool.locator('[data-container]').selectOption('mp4');

		await expect(tool.locator('[data-status]')).toHaveText('tiny-clip-subtitled.mkv was muxed.', { timeout: 150_000 });
		await expect(tool.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		const download = tool.locator('[data-download-media]');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'tiny-clip-subtitled.mkv');

		const muxed = await downloadBinary(download);
		expect(muxed.magic).toBe('1a45dfa3');
		expect(muxed.type).toBe('video/x-matroska');
		expect(muxed.byteLength).toBeGreaterThan(1000);
		await expect(tool.locator('[data-result]')).toHaveText('tiny-clip-subtitled.mkv was muxed.');
	});
});

test.describe('subtitle studio', () => {
	test('stops announcing the workspace preparation once isolation is in place', async ({ page }) => {
		await page.goto('/en/tools/subtitle-studio/');
		await waitForIsolation(page);
		const tool = page.locator('[data-combined-subtitle-studio]');
		await expect(tool).toHaveAttribute('data-bound', 'true');
		const status = tool.locator('[data-status]');

		/* The status only carries a state once the isolation check has finished. */
		await expect(status).toHaveAttribute('data-state', 'info', { timeout: 30_000 });
		await expect(status).toHaveText('Choose media or load subtitles.');
	});

	test('edits cues, keeps the subtitle download in sync, and switches application modes', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/subtitle-studio/');
		await waitForIsolation(page);
		const tool = page.locator('[data-combined-subtitle-studio]');
		await expect(tool).toHaveAttribute('data-bound', 'true');
		const status = tool.locator('[data-status]');
		const download = tool.locator('[data-download-subtitles]');

		await tool.locator('[data-text]').fill(SRT_SOURCE);
		await expect(status).toHaveText('2 subtitle cues ready.');
		await expect(download).toHaveAttribute('download', 'subtitles.srt');
		expect((await downloadText(download)).text).toBe('1\n00:00:00,000 --> 00:00:01,000\nFirst cue\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond cue\n');

		/* The download is rebuilt on every edit, so the offset has to reach the file. */
		await tool.locator('[data-offset]').fill('2');
		await expect(tool.locator('[data-offset-label]')).toHaveText('2.0s');
		expect((await downloadText(download)).text).toBe('1\n00:00:02,000 --> 00:00:03,000\nFirst cue\n\n2\n00:00:04,000 --> 00:00:06,000\nSecond cue\n');

		await tool.locator('[data-output-format]').selectOption('vtt');
		await expect(download).toHaveAttribute('download', 'subtitles.vtt');
		const vtt = await downloadText(download);
		expect(vtt.type).toBe('text/vtt');
		expect(vtt.text).toBe('WEBVTT\n\n00:00:02.000 --> 00:00:03.000\nFirst cue\n\n00:00:04.000 --> 00:00:06.000\nSecond cue\n');

		/* An offset that empties the timeline must withdraw the download, not export nothing. */
		await tool.locator('[data-offset]').fill('-30');
		await expect(status).toHaveText('Choose media or load subtitles.');
		await expect(download).toBeHidden();
		await tool.locator('[data-offset]').fill('0');
		await expect(download).toBeVisible();

		await tool.locator('[data-apply-mode]').selectOption('hard');
		await expect(tool.locator('[data-hard-settings]')).toBeVisible();
		await expect(tool.locator('[data-soft-settings]')).toBeHidden();
		await tool.locator('[data-font-size]').fill('80');
		await expect(tool.locator('[data-font-size-label]')).toHaveText('80');
		await tool.locator('[data-margin]').fill('300');
		await expect(tool.locator('[data-margin-label]')).toHaveText('300px');
		await tool.locator('[data-display]').selectOption('karaoke');
		await tool.locator('[data-position]').selectOption('8');

		await tool.locator('[data-apply-mode]').selectOption('soft');
		await expect(tool.locator('[data-soft-settings]')).toBeVisible();
		await expect(tool.locator('[data-hard-settings]')).toBeHidden();
		await tool.locator('[data-container]').selectOption('mp4');

		/* Applying without media is refused before any WASM download starts. */
		await tool.locator('[data-apply]').click();
		await expect(status).toHaveText('Choose a media file first.');
		await expect(status).toHaveAttribute('data-state', 'error');
		await expect(tool.locator('[data-download-media]')).toBeHidden();

		await tool.locator('[data-reset]').click();
		await expect(tool.locator('[data-text]')).toHaveValue('');
		await expect(tool.locator('[data-offset-label]')).toHaveText('0.0s');
		await expect(tool.locator('[data-apply-mode]')).toHaveValue('soft');
		await expect(tool.locator('[data-soft-settings]')).toBeVisible();
		await expect(download).toBeHidden();
		await expect(tool.locator('[data-generate]')).toBeDisabled();
		await expect(status).toHaveText('Choose media or load subtitles.');
		expect(errors).toEqual([]);
	});

	test('keeps the unsupported-workspace error after a media file is chosen', async ({ page }) => {
		/* Whisper needs a cross-origin isolated context, which needs a service worker. */
		await page.addInitScript(() => { delete Navigator.prototype.serviceWorker; });
		await page.goto('/en/tools/subtitle-studio/');
		const tool = page.locator('[data-combined-subtitle-studio]');
		const status = tool.locator('[data-status]');

		await expect(status).toHaveText('This browser cannot prepare the isolated Whisper workspace.');
		await expect(status).toHaveAttribute('data-state', 'error');

		await tool.locator('[data-media]').setInputFiles(fixture('tiny-clip.mp4'));
		await expect(tool.locator('[data-media-name]')).toHaveText('tiny-clip.mp4');
		await expect(tool.locator('[data-generate]')).toBeDisabled();
		await expect(status).toHaveText('This browser cannot prepare the isolated Whisper workspace.');
		await expect(status).toHaveAttribute('data-state', 'error');
	});
});

test.describe('whisper subtitle generator', () => {
	test('keeps the unsupported-workspace error and resets its controls', async ({ page }) => {
		await page.addInitScript(() => { delete Navigator.prototype.serviceWorker; });
		await page.goto('/en/tools/whisper-subtitle-generator/');
		const tool = page.locator('[data-whisper-subtitle-generator]');
		const status = tool.locator('[data-status]');
		const unsupported = 'This browser cannot prepare the isolated WebAssembly workspace that whisper.cpp needs.';

		await expect(status).toHaveText(unsupported);
		await expect(status).toHaveAttribute('data-state', 'error');

		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.mp4'));
		await expect(tool.locator('[data-file-name]')).toHaveText('tiny-clip.mp4');
		await expect(tool.locator('[data-audio-preview]')).toBeVisible();
		await expect(tool.locator('[data-result-panel]')).toBeHidden();
		await expect(tool.locator('[data-generate]')).toBeDisabled();
		await expect(status).toHaveText(unsupported);

		await tool.locator('[data-language]').selectOption('de');
		await tool.locator('[data-task]').selectOption('translate');
		await expect(tool.locator('[data-language]')).toHaveValue('de');
		await expect(tool.locator('[data-task]')).toHaveValue('translate');

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-file-name]')).toHaveText('Choose a media file');
		await expect(tool.locator('[data-audio-preview]')).toBeHidden();
		await expect(tool.locator('[data-download-srt]')).toBeHidden();
		await expect(tool.locator('[data-download-vtt]')).toBeHidden();
		await expect(tool.locator('[data-generate]')).toBeDisabled();
		await expect(status).toHaveText('Choose an audio or video file.');
	});
});

test.describe('subtitle burner', () => {
	test('counts cues from both inputs, refuses incomplete runs, and resets', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/subtitle-burner/');
		const tool = page.locator('[data-subtitle-burner]');
		const status = tool.locator('[data-status]');

		await tool.locator('[data-burn]').click();
		await expect(status).toHaveText('Choose a video first.');
		await expect(status).toHaveAttribute('data-state', 'error');

		await tool.locator('[data-video]').setInputFiles(fixture('tiny-clip.mp4'));
		await expect(tool.locator('[data-preview]')).toBeVisible();
		await expect(tool.locator('[data-video-name]')).toHaveText('tiny-clip.mp4');
		await expect(status).toHaveText('Choose a video and add subtitles.');

		await tool.locator('[data-burn]').click();
		await expect(status).toHaveText('No valid subtitles found.');
		await expect(status).toHaveAttribute('data-state', 'error');

		await tool.locator('[data-text]').fill(SRT_SOURCE);
		await expect(status).toHaveText('2 subtitle cues ready.');
		await expect(status).toHaveAttribute('data-state', 'success');

		await tool.locator('[data-subtitles]').setInputFiles(vttUpload);
		await expect(tool.locator('[data-subtitle-name]')).toHaveText('captions.vtt');
		await expect(tool.locator('[data-text]')).toHaveValue('WEBVTT\n\n00:00:01.000 --> 00:00:02.500\nFrom a file\n');
		await expect(status).toHaveText('1 subtitle cues ready.');

		await tool.locator('[data-font-size]').fill('92');
		await expect(tool.locator('[data-font-size-label]')).toHaveText('92');
		await tool.locator('[data-margin]').fill('420');
		await expect(tool.locator('[data-margin-label]')).toHaveText('420px');
		await tool.locator('[data-mode]').selectOption('karaoke');
		await tool.locator('[data-position]').selectOption('5');
		await expect(tool.locator('[data-mode]')).toHaveValue('karaoke');
		await expect(tool.locator('[data-position]')).toHaveValue('5');

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-text]')).toHaveValue('');
		await expect(tool.locator('[data-preview]')).toBeHidden();
		await expect(tool.locator('[data-video-name]')).toHaveText('Choose video');
		await expect(tool.locator('[data-download]')).toBeHidden();
		await expect(tool.locator('[data-result]')).toHaveText('Choose a video and add subtitles.');
		await expect(status).toHaveText('Choose a video and add subtitles.');
		expect(errors).toEqual([]);
	});
});

test.describe('black bar remover', () => {
	test('measures a real frame and leaves the export disabled when there are no bars', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/black-bar-remover/');
		const tool = page.locator('[data-crop-doctor]');
		const status = tool.locator('[data-status]');

		await expect(tool.locator('[data-analyze]')).toBeDisabled();
		await expect(tool.locator('[data-crop]')).toBeDisabled();

		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.mp4'));
		await expect(status).toHaveText('tiny-clip.mp4 is ready.');
		await expect(tool.locator('[data-analyze]')).toBeEnabled();
		await tool.locator('[data-threshold]').fill('40');
		await expect(tool.locator('[data-threshold-label]')).toHaveText('40');
		await tool.locator('[data-output]').selectOption('webm');
		await expect(tool.locator('[data-output]')).toHaveValue('webm');

		await tool.locator('[data-analyze]').click();
		/* The fixture is a full-bleed colour field, so the detector must find no bars. */
		await expect(status).toHaveText('No obvious bars detected.', { timeout: 20_000 });
		await expect(status).toHaveAttribute('data-state', 'info');
		await expect(tool.locator('[data-crop]')).toBeDisabled();

		const preview = tool.locator('[data-preview]');
		await expect(preview).toBeVisible();
		/* The canvas holds the sampled frame at the video's own resolution. */
		expect(await preview.evaluate((canvas) => [canvas.width, canvas.height])).toEqual([160, 120]);
		await expect(tool.locator('[data-result-panel]')).toBeHidden();

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-analyze]')).toBeDisabled();
		await expect(tool.locator('[data-crop]')).toBeDisabled();
		await expect(preview).toBeHidden();
		await expect(tool.locator('[data-file-name]')).toHaveText('Choose video');
		await expect(status).toHaveText('Choose a video.');
		expect(errors).toEqual([]);
	});

	test('refuses to call an all-black frame a 2x2 crop', async ({ page }) => {
		test.setTimeout(60_000);
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/black-bar-remover/');
		const tool = page.locator('[data-crop-doctor]');
		const status = tool.locator('[data-status]');
		const clip = await recordBlackClip(page);

		await tool.locator('[data-file]').setInputFiles(clip);
		await expect(status).toHaveText(`${clip.name} is ready.`);
		/* The widest sensitivity, so the decoded black stays under the threshold by a margin. */
		await tool.locator('[data-threshold]').fill('60');
		await expect(tool.locator('[data-threshold-label]')).toHaveText('60');
		await tool.locator('[data-analyze]').click();

		/* Every row and column scan collapses onto the midpoint here, which used to be
		   reported as a successful 2x2 crop with the export enabled. */
		await expect(status).toHaveText('The frame sampled here is dark throughout, so no bars can be measured. This tool cannot read a video that opens on a fade from black.', { timeout: 20_000 });
		await expect(status).toHaveAttribute('data-state', 'info');
		await expect(tool.locator('[data-crop]')).toBeDisabled();
		await expect(tool.locator('[data-result-panel]')).toBeHidden();

		const preview = tool.locator('[data-preview]');
		await expect(preview).toBeVisible();
		/* The measured frame really was black, and no crop box was drawn over it. */
		const sampled = await preview.evaluate((canvas) => {
			const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
			let lit = 0;
			for (let index = 0; index < pixels.length; index += 4) {
				if (pixels[index] >= 60 || pixels[index + 1] >= 60 || pixels[index + 2] >= 60) lit += 1;
			}
			return { width: canvas.width, height: canvas.height, lit };
		});
		expect(sampled).toEqual({ width: 160, height: 120, lit: 0 });
		expect(errors).toEqual([]);
	});

	test('reports an undecodable file instead of analyzing forever', async ({ page }) => {
		await page.goto('/en/tools/black-bar-remover/');
		const tool = page.locator('[data-crop-doctor]');
		const status = tool.locator('[data-status]');

		await tool.locator('[data-file]').setInputFiles(undecodableUpload);
		await expect(tool.locator('[data-analyze]')).toBeEnabled();
		await tool.locator('[data-analyze]').click();

		await expect(status).toHaveAttribute('data-state', 'error', { timeout: 20_000 });
		await expect(status).toContainText('Crop failed:');
		await expect(tool.locator('[data-crop]')).toBeDisabled();
	});
});

test.describe('vertical video reframer', () => {
	test('reports an undecodable file from both actions instead of going silent', async ({ page }) => {
		const tool = page.locator('[data-smart-reframer]');
		const status = tool.locator('[data-status]');

		/* A fresh load per action, so each error status is the one that click produced. */
		for (const action of ['[data-render]', '[data-analyze]']) {
			await page.goto('/en/tools/vertical-video-reframer/');
			await tool.locator('[data-file]').setInputFiles(undecodableUpload);
			await expect(status).toHaveText('broken-source.mkv is ready.');
			await expect(status).toHaveAttribute('data-state', 'success');

			await tool.locator(action).click();
			await expect(status).toHaveAttribute('data-state', 'error', { timeout: 20_000 });
			await expect(status).toContainText('Reframe failed:');
			await expect(tool.locator('[data-download]')).toBeHidden();
		}
	});

	test('refuses a source with no picture in both languages instead of cropping 0x0', async ({ page }) => {
		const errors = collectClientErrors(page);
		const tool = page.locator('[data-smart-reframer]');
		const status = tool.locator('[data-status]');
		const refusals = [
			['/en/tools/vertical-video-reframer/', 'Reframe failed: This file has no video track to reframe.'],
			['/de/tools/vertikaler-video-reframer/', 'Reframe fehlgeschlagen: Diese Datei hat keine Videospur zum Reframen.'],
		];

		for (const [path, refusal] of refusals) {
			await page.goto(path);
			await tool.locator('[data-file]').setInputFiles(createWavUpload({ name: 'voice-over.wav' }));
			await expect(tool.locator('[data-render]')).toBeEnabled();
			await tool.locator('[data-render]').click();

			/* videoWidth stays 0 for an audio-only stream, and `crop=0:0:0:0` is not a filter
			   FFmpeg can run, so the refusal has to arrive before the engine is even loaded. */
			await expect(status).toHaveText(refusal, { timeout: 20_000 });
			await expect(status).toHaveAttribute('data-state', 'error');
			await expect(tool.locator('[data-download]')).toBeHidden();
		}
		expect(errors).toEqual([]);
	});

	test('draws the analyzed frame and decides on a crop center', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/vertical-video-reframer/');
		const tool = page.locator('[data-smart-reframer]');

		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.mp4'));
		await expect(tool.locator('[data-analyze]')).toBeEnabled();
		await tool.locator('[data-analyze]').click();

		/* Either outcome is a real decision; an unanswered click is not. */
		await expect(tool.locator('[data-status]')).toHaveText(/Face detected\. Crop center: \d+%\.|No face detected, using center crop\./, { timeout: 150_000 });
		const preview = tool.locator('[data-preview]');
		await expect(preview).toBeVisible();
		const frame = await preview.evaluate((canvas) => {
			const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
			let lit = 0;
			for (let index = 0; index < pixels.length; index += 4) {
				if (pixels[index] > 40 || pixels[index + 1] > 40 || pixels[index + 2] > 40) lit += 1;
			}
			return { width: canvas.width, height: canvas.height, lit };
		});
		expect(frame.width).toBe(160);
		expect(frame.height).toBe(120);
		/* A blank canvas would be entirely black; the fixture is a bright colour field. */
		expect(frame.lit).toBeGreaterThan(1000);
	});

	test('renders the aspect ratio picked in the preset select', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/vertical-video-reframer/');
		const tool = page.locator('[data-smart-reframer]');

		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.mp4'));
		await tool.locator('[data-preset]').selectOption('1:1');
		await tool.locator('[data-quality]').selectOption('32');
		await expect(tool.locator('[data-render]')).toBeEnabled();
		await tool.locator('[data-render]').click();

		await expect(tool.locator('[data-status]')).toHaveText('Vertical video created.', { timeout: 150_000 });
		const download = tool.locator('[data-download]');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'tiny-clip-vertical.mp4');
		await expect(tool.locator('[data-result-meta]')).toContainText('tiny-clip-vertical.mp4');

		const rendered = await downloadBinary(download);
		expect(rendered.boxType).toBe('ftyp');
		expect(rendered.type).toBe('video/mp4');

		/* The square preset has to reach the encoder: the sample entry inside the produced
		   MP4 carries the codec and the real frame size, so read them out of the bytes. */
		const sampleEntry = await download.evaluate(async (node) => {
			const bytes = new Uint8Array(await (await fetch(node.href)).arrayBuffer());
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			const boxes = new TextDecoder('latin1').decode(bytes);
			const stsd = boxes.indexOf('stsd');
			if (stsd < 0) return { codec: 'no stsd box in the rendered MP4' };
			/* stsd: type, version+flags, entry count, then the sample entry's size and type. */
			const entry = stsd + 16;
			return {
				codec: boxes.slice(entry, entry + 4),
				width: view.getUint16(entry + 28),
				height: view.getUint16(entry + 30),
			};
		});
		expect(sampleEntry).toEqual({ codec: 'avc1', width: 1080, height: 1080 });
	});
});

test.describe('media delivery checker', () => {
	test('diagnoses real containers and writes every note in the page language', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);

		await page.goto('/en/tools/media-delivery-checker/');
		const tool = page.locator('[data-delivery-doctor]');
		const status = tool.locator('[data-status]');
		const notes = tool.locator('[data-report] li');

		await expect(tool.locator('[data-analyze]')).toBeDisabled();
		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.webm'));
		await expect(tool.locator('[data-analyze]')).toBeEnabled();
		await expect(status).toHaveText('tiny-clip.webm');
		await tool.locator('[data-analyze]').click();

		await expect(status).toHaveText('Diagnosis complete.', { timeout: 120_000 });
		await expect(notes).toHaveCount(2);
		await expect(notes.first()).toHaveText('tiny-clip.webm: WebM · 3.2 KB');
		/* VP8 is outside the delivery allow-list, so the codec note has to appear. */
		await expect(notes.nth(1)).toHaveText('Video codec may need transcoding for web delivery: VP8.');

		/* The MP4 fixture carries VP9 with even dimensions and an isom brand: nothing to report. */
		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.mp4'));
		await tool.locator('[data-analyze]').click();
		await expect(status).toHaveText('Diagnosis complete.', { timeout: 60_000 });
		await expect(notes).toHaveCount(2);
		await expect(notes.first()).toContainText('tiny-clip.mp4');
		await expect(notes.last()).toHaveText('No obvious delivery issues found.');

		await page.goto('/de/tools/medien-abgabepruefung/');
		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.webm'));
		await tool.locator('[data-analyze]').click();
		await expect(status).toHaveText('Diagnose abgeschlossen.', { timeout: 120_000 });
		await expect(notes).toHaveCount(2);
		await expect(notes.nth(1)).toHaveText('Video-Codec muss für die Web-Auslieferung eventuell transkodiert werden: VP8.');
		await expect(tool.locator('[data-report]')).not.toContainText('Video codec may need transcoding');
	});

	test('names the container and mode it cannot combine instead of failing inside FFmpeg', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/media-delivery-checker/');
		const tool = page.locator('[data-delivery-doctor]');
		const status = tool.locator('[data-status]');
		const download = tool.locator('[data-download]');

		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.webm'));
		await tool.locator('[data-output]').selectOption('webm');
		await tool.locator('[data-mode]').selectOption('web');
		await expect(tool.locator('[data-repair]')).toBeEnabled();
		await tool.locator('[data-repair]').click();

		/* WebM holds VP8/VP9/AV1 with Vorbis or Opus; this mode writes H.264 and AAC. */
		await expect(status).toHaveText('Create web MP4 cannot be written into WebM. Choose MP4, MKV, or MOV, or pick another repair mode.');
		await expect(status).toHaveAttribute('data-state', 'error');
		await expect(download).toBeHidden();

		await tool.locator('[data-mode]').selectOption('audio');
		await tool.locator('[data-repair]').click();
		await expect(status).toHaveText('Convert audio to AAC cannot be written into WebM. Choose MP4, MKV, or MOV, or pick another repair mode.');
		await expect(status).toHaveAttribute('data-state', 'error');
		await expect(download).toBeHidden();

		await page.goto('/de/tools/medien-abgabepruefung/');
		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.webm'));
		await tool.locator('[data-output]').selectOption('webm');
		await tool.locator('[data-mode]').selectOption('web');
		await tool.locator('[data-repair]').click();
		await expect(status).toHaveText('Web-MP4 erstellen lässt sich nicht in WebM schreiben. Wähle MP4, MKV oder MOV oder einen anderen Reparaturmodus.');
		await expect(status).toHaveAttribute('data-state', 'error');
		await expect(download).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('repairs into the selected container', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/media-delivery-checker/');
		const tool = page.locator('[data-delivery-doctor]');

		await tool.locator('[data-file]').setInputFiles(fixture('tiny-clip.mp4'));
		await tool.locator('[data-output]').selectOption('mkv');
		await tool.locator('[data-mode]').selectOption('copy');
		await expect(tool.locator('[data-repair]')).toBeEnabled();
		await tool.locator('[data-repair]').click();

		await expect(tool.locator('[data-status]')).toHaveText('Repair complete.', { timeout: 150_000 });
		const download = tool.locator('[data-download]');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'tiny-clip-delivery.mkv');
		const repaired = await downloadBinary(download);
		expect(repaired.magic).toBe('1a45dfa3');
		expect(repaired.type).toBe('video/x-matroska');
		expect(repaired.byteLength).toBeGreaterThan(1000);
		await expect(tool.locator('[data-result-meta]')).toContainText('tiny-clip-delivery.mkv');

		await tool.locator('[data-clear]').click();
		await expect(download).toBeHidden();
		await expect(tool.locator('[data-analyze]')).toBeDisabled();
		await expect(tool.locator('[data-repair]')).toBeDisabled();
		await expect(tool.locator('[data-report] li')).toHaveText(['Choose a file for diagnosis.']);
		await expect(tool.locator('[data-status]')).toHaveText('Choose a file for diagnosis.');
	});
});

test.describe('media info', () => {
	test('analyzes the committed MP4 and downloads a JSON report of its tracks', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/media-info/');
		const tool = page.locator('[data-mediainfo-tool]');
		const status = tool.locator('[data-status]');
		const download = tool.locator('[data-download]');

		await expect(tool.locator('[data-analyze]')).toBeDisabled();
		await expect(download).toBeHidden();
		await tool.locator('[data-file-input]').setInputFiles(fixture('tiny-clip.mp4'));
		await expect(tool.locator('[data-analyze]')).toBeEnabled();
		await expect(status).toHaveText('File ready: tiny-clip.mp4');
		await expect(tool.locator('[data-summary]')).toContainText('2.8 KB');

		await tool.locator('[data-analyze]').click();
		await expect(status).toHaveText('Analysis complete.', { timeout: 120_000 });
		await expect(tool.locator('[data-tracks]')).toContainText('General');
		await expect(tool.locator('[data-tracks]')).toContainText('Video');
		await expect(tool.locator('[data-summary]')).toContainText('160 x 120');

		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'tiny-clip-mediainfo.json');
		const report = await download.evaluate(async (node) => {
			const response = await fetch(node.href);
			return { type: response.headers.get('content-type'), body: await response.text() };
		});
		expect(report.type).toBe('application/json');
		const parsed = JSON.parse(report.body);
		const tracks = parsed.media.track;
		const general = tracks.find((track) => track['@type'] === 'General');
		const video = tracks.find((track) => track['@type'] === 'Video');
		expect(general.Format).toBeTruthy();
		expect(Number(video.Width)).toBe(160);
		expect(Number(video.Height)).toBe(120);

		await tool.locator('[data-clear]').click();
		await expect(download).toBeHidden();
		await expect(tool.locator('[data-analyze]')).toBeDisabled();
		await expect(tool.locator('[data-file-name]')).toHaveText('Select media file');
		await expect(tool.locator('[data-tracks]')).toHaveText('Detected tracks will appear here after analysis.');
		await expect(status).toHaveText('Choose a media file to start the analysis.');
	});
});

test.describe('short-form safe zone previewer', () => {
	test('applies platform presets, custom zones, and both preview kinds', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.goto('/en/tools/short-form-safe-zone-previewer/');
		const tool = page.locator('[data-safe-zone-tool]');
		const preview = tool.locator('[data-preview]');
		const status = tool.locator('[data-status]');
		const zoneRatio = async () => {
			const [previewBox, topBox] = await Promise.all([
				preview.boundingBox(),
				tool.locator('.safe-zone-top').boundingBox(),
			]);
			return topBox.height / previewBox.height;
		};

		await tool.locator('[data-file-input]').setInputFiles(fixture('tiny-photo.png'));
		await expect(tool.locator('[data-image-preview]')).toBeVisible();
		await expect(tool.locator('[data-video-preview]')).toBeHidden();
		await expect(tool.locator('[data-placeholder]')).toBeHidden();
		await expect(status).toHaveText('tiny-photo.png is shown with safe zones.');
		expect(await zoneRatio()).toBeCloseTo(0.13, 2);

		await tool.locator('[data-preset]').selectOption('tiktok');
		await expect(tool.locator('[data-top-label]')).toHaveText('7%');
		await expect(tool.locator('[data-bottom-label]')).toHaveText('7%');
		await expect(tool.locator('[data-right-label]')).toHaveText('15%');
		expect(await zoneRatio()).toBeCloseTo(0.07, 2);

		/* Moving a slider by hand is what turns the preset into a custom layout. */
		await tool.locator('[data-top]').fill('24');
		await expect(tool.locator('[data-preset]')).toHaveValue('custom');
		await expect(tool.locator('[data-top-label]')).toHaveText('24%');
		expect(await zoneRatio()).toBeCloseTo(0.24, 2);

		await tool.locator('[data-file-input]').setInputFiles(fixture('tiny-clip.mp4'));
		await expect(tool.locator('[data-video-preview]')).toBeVisible();
		await expect(tool.locator('[data-image-preview]')).toBeHidden();
		await expect(status).toHaveText('tiny-clip.mp4 is shown with safe zones.');

		await tool.locator('[data-reset]').click();
		await expect(tool.locator('[data-preset]')).toHaveValue('shorts');
		await expect(tool.locator('[data-top-label]')).toHaveText('13%');
		await expect(tool.locator('[data-bottom-label]')).toHaveText('16%');
		await expect(tool.locator('[data-right-label]')).toHaveText('14%');
		await expect(tool.locator('[data-placeholder]')).toBeVisible();
		await expect(tool.locator('[data-video-preview]')).toBeHidden();
		await expect(tool.locator('[data-image-preview]')).toBeHidden();
		await expect(tool.locator('[data-file-name]')).toHaveText('Choose image or video');
		await expect(status).toHaveText('The preview was reset.');
		expect(await zoneRatio()).toBeCloseTo(0.13, 2);
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
