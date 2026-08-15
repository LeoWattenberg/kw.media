// The three ffmpeg.wasm converters, checked against the files they hand back:
// every conversion here runs the real WebAssembly build (only the CDN transport is
// replayed from .cache/) and every result is parsed as the container it claims to be.
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { cacheCdnAssets } from './cdn-cache.mjs';
import { createAviUpload, fixturePath, fixtureUpload } from './media-fixtures.mjs';

// A one-second 8 kHz mono tone. Every audio profile resamples to 48 kHz, so the
// rate in the produced header is proof that ffmpeg really re-encoded the file.
const createToneUpload = ({ duration = 1, sampleRate = 8000, frequency = 440 } = {}) => {
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
	return { name: 'tone.wav', mimeType: 'audio/wav', buffer };
};

/* Walks the RIFF chunk list rather than trusting fixed offsets: ffmpeg writes a LIST tag before the samples. */
const readWav = async (link) => {
	const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const text = (start, length) => new TextDecoder().decode(bytes.subarray(start, start + length));
	const chunks = {};
	let offset = 12;
	while (offset + 8 <= bytes.byteLength) {
		const size = view.getUint32(offset + 4, true);
		chunks[text(offset, 4)] = { offset: offset + 8, size };
		offset += 8 + size + (size % 2);
	}

	const fmt = chunks['fmt '].offset;
	return {
		riff: text(0, 4),
		wave: text(8, 4),
		format: view.getUint16(fmt, true),
		channels: view.getUint16(fmt + 2, true),
		sampleRate: view.getUint32(fmt + 4, true),
		bitDepth: view.getUint16(fmt + 14, true),
		samples: chunks.data.size / 2,
	};
};

/* FLAC STREAMINFO: 20 bits sample rate, 3 bits channel count, 5 bits bit depth, from byte 18. */
const readFlac = async (link) => {
	const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
	const packed = (bytes[18] << 24) | (bytes[19] << 16) | (bytes[20] << 8) | bytes[21];
	return {
		magic: new TextDecoder().decode(bytes.subarray(0, 4)),
		blockType: bytes[4] & 0x7f,
		sampleRate: (packed >>> 12) & 0xfffff,
		channels: ((packed >>> 9) & 0x07) + 1,
		bitDepth: ((packed >>> 4) & 0x1f) + 1,
	};
};

/* GIF header: signature, then the logical screen width and height as little-endian shorts. */
const readGif = async (link) => {
	const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
	const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
	// Every animation frame is introduced by a graphic control extension, 0x21 0xF9 0x04.
	let frames = 0;
	for (let index = 0; index + 2 < bytes.byteLength; index += 1) {
		if (bytes[index] === 0x21 && bytes[index + 1] === 0xf9 && bytes[index + 2] === 0x04) frames += 1;
	}

	return {
		signature: head.slice(0, 6),
		width: bytes[6] | (bytes[7] << 8),
		height: bytes[8] | (bytes[9] << 8),
		// ffmpeg only writes the Netscape looping block when a loop count was asked for.
		loops: head.includes('NETSCAPE2.0'),
		frames,
		byteLength: bytes.byteLength,
	};
};

const readContainer = async (link) => {
	const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
	return {
		magic: [...bytes.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		text: new TextDecoder('latin1').decode(bytes),
		byteLength: bytes.byteLength,
	};
};

test.describe('media converter outputs', () => {
	test('Audio and Video Converter writes a real WAV and a real FLAC for the chosen target', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/video-audio-converter/');

		const tool = page.locator('[data-video-audio-converter]');
		const status = tool.locator('[data-status]');
		const profileSelect = tool.locator('[data-profile-select]');
		const convert = tool.locator('[data-process]');
		const download = tool.locator('[data-download]');
		const previewToggle = tool.locator('[data-preview-toggle]');

		await expect(status).toHaveText('Choose an audio file or video to start.');
		await expect(profileSelect).toBeDisabled();
		await expect(convert).toBeDisabled();
		await expect(download).toBeHidden();
		await expect(previewToggle).toBeHidden();
		await expect(tool.locator('[data-converter-output]')).toBeHidden();
		await expect(tool.locator('[data-media-preview]')).toBeHidden();

		/* A video source offers the video targets too and previews the moving picture. */
		await tool.locator('[data-file-input]').setInputFiles(fixtureUpload('tiny-clip.mp4', 'video/mp4'));
		await expect(profileSelect).toBeEnabled();
		await expect(profileSelect.locator('option')).toHaveCount(9);
		await expect(tool.locator('[data-source-video]')).toBeVisible();
		await expect(tool.locator('[data-file-name]')).toHaveText('tiny-clip.mp4');
		/* Choosing a file prepares nothing: the tool is waiting for a target format and says so. */
		await expect(status).toHaveText('tiny-clip.mp4 is ready. Choose a target format.');
		await expect(status).toHaveAttribute('data-state', 'success');

		/* An audio source narrows the list to the five audio targets. */
		await tool.locator('[data-file-input]').setInputFiles(createToneUpload());
		expect(await profileSelect.locator('option').evaluateAll((options) => options.map((option) => option.value)))
			.toEqual(['', 'wav', 'mp3', 'ogg', 'm4a', 'flac']);
		await expect(tool.locator('[data-source-audio]')).toBeVisible();
		await expect(tool.locator('[data-source-video]')).toBeHidden();
		await expect(tool.locator('[data-file-name]')).toHaveText('tone.wav');
		await expect(tool.locator('[data-file-meta]')).toContainText('16 KB');
		await expect(tool.locator('[data-file-meta]')).toContainText('audio/wav');
		await expect(tool.locator('[data-converter-output]')).toBeVisible();
		await expect(convert).toBeEnabled();
		await expect(status).toHaveText('tone.wav is ready. Choose a target format.');

		await profileSelect.selectOption('wav');
		await convert.click();
		await expect(status).toHaveText('The file was converted successfully.', { timeout: 150_000 });
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(tool.locator('[data-result-title]')).toHaveText('Selected file: tone.wav');
		await expect(tool.locator('[data-result-meta]')).toContainText('WAV');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'tone.wav');

		const wav = await download.evaluate(readWav);
		expect(wav.riff).toBe('RIFF');
		expect(wav.wave).toBe('WAVE');
		expect(wav.format).toBe(1);
		expect(wav.channels).toBe(1);
		/* The source tone is 8 kHz: the profile's -ar 48000 is what makes this 48 kHz. */
		expect(wav.sampleRate).toBe(48_000);
		expect(wav.bitDepth).toBe(16);
		expect(wav.samples).toBeGreaterThan(47_000);
		expect(wav.samples).toBeLessThan(49_000);

		/* The preview swaps to the converted file and back without losing the download. */
		await expect(tool.locator('[data-output-audio]')).toBeVisible();
		await expect(tool.locator('[data-source-audio]')).toBeHidden();
		await expect(previewToggle).toBeVisible();
		await expect(previewToggle).toHaveText('Show original');
		await previewToggle.click();
		await expect(tool.locator('[data-source-audio]')).toBeVisible();
		await expect(tool.locator('[data-output-audio]')).toBeHidden();
		await expect(previewToggle).toHaveText('Show converted file');
		await expect(download).toBeVisible();
		await previewToggle.click();
		await expect(tool.locator('[data-output-audio]')).toBeVisible();

		/* Switching the target format retires the finished WAV instead of leaving it on offer next to a FLAC label. */
		await profileSelect.selectOption('flac');
		await expect(download).toBeHidden();
		await expect(previewToggle).toBeHidden();
		/* Back to a selected file with nothing converted, which is what the status has to say. */
		await expect(status).toHaveText('tone.wav is ready. Choose a target format.');
		await expect(tool.locator('[data-source-audio]')).toBeVisible();
		await expect(tool.locator('[data-output-audio]')).toBeHidden();
		await expect(tool.locator('[data-result-meta]')).toHaveText('The output is generated in a matching container and downloaded right away.');

		await convert.click();
		await expect(status).toHaveText('The file was converted successfully.', { timeout: 150_000 });
		await expect(download).toHaveAttribute('download', 'tone.flac');
		await expect(tool.locator('[data-result-meta]')).toContainText('FLAC');

		const flac = await download.evaluate(readFlac);
		expect(flac).toEqual({ magic: 'fLaC', blockType: 0, sampleRate: 48_000, channels: 1, bitDepth: 16 });

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('Choose an audio file or video to start.');
		await expect(profileSelect).toBeDisabled();
		await expect(profileSelect.locator('option')).toHaveCount(1);
		await expect(convert).toBeDisabled();
		await expect(download).toBeHidden();
		await expect(previewToggle).toBeHidden();
		await expect(tool.locator('[data-converter-output]')).toBeHidden();
		await expect(tool.locator('[data-media-preview]')).toBeHidden();
		await expect(tool.locator('[data-file-name]')).toHaveText('Select a file');
	});

	test('Video to GIF renders GIFs at the width, palette and loop the controls report', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/video-to-gif/');

		const tool = page.locator('[data-video-gif]');
		const status = tool.locator('[data-status]');
		const convert = tool.locator('[data-convert]');
		const clear = tool.locator('[data-clear]');
		const download = tool.locator('[data-download]');
		const result = tool.locator('[data-result]');
		const sourcePreview = tool.locator('[data-source-preview]');
		const previewToggle = tool.locator('[data-preview-toggle]');
		const startInput = tool.locator('[data-start]');
		const durationInput = tool.locator('[data-duration]');
		const widthInput = tool.locator('[data-width]');
		const fpsInput = tool.locator('[data-fps]');
		const colorsInput = tool.locator('[data-colors]');
		const loopInput = tool.locator('[data-loop]');

		await expect(status).toHaveText('Choose a video to start.');
		await expect(convert).toBeDisabled();
		await expect(clear).toBeDisabled();
		await expect(startInput).toBeDisabled();
		await expect(durationInput).toBeDisabled();
		await expect(sourcePreview).toBeHidden();
		await expect(result).toBeHidden();
		await expect(download).toBeHidden();
		await expect(previewToggle).toBeHidden();

		await tool.locator('[data-file]').setInputFiles(fixtureUpload('tiny-clip.webm', 'video/webm'));
		await expect(status).toHaveText('tiny-clip.webm is selected (3.2 KB).', { timeout: 15_000 });
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(tool.locator('[data-file-name]')).toHaveText('tiny-clip.webm');
		await expect(tool.locator('[data-file-meta]')).toContainText('video/webm');
		await expect(tool.locator('[data-video-meta]')).toHaveText('160 x 120px | 0:01');
		await expect(sourcePreview).toBeVisible();
		await expect(convert).toBeEnabled();
		await expect(clear).toBeEnabled();
		/* The clip is about a second long, so the trim window follows it instead of the 3 s default. */
		await expect(startInput).toBeEnabled();
		await expect(durationInput).toBeEnabled();
		await expect(durationInput).toHaveValue('1');

		await widthInput.fill('240');
		await expect(tool.locator('[data-width-label]')).toHaveText('240px');
		await fpsInput.fill('6');
		await expect(tool.locator('[data-fps-label]')).toHaveText('6');
		await colorsInput.fill('32');
		await expect(tool.locator('[data-colors-label]')).toHaveText('32');
		await expect(loopInput).toBeChecked();

		await convert.click();
		await expect(status).toHaveText('The GIF is ready.', { timeout: 150_000 });
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(result).toBeVisible();
		await expect(tool.locator('[data-output-image]')).toBeVisible();
		await expect(tool.locator('[data-output-meta]')).toContainText('240px wide | 6 FPS | 32 colors');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'tiny-clip.gif');

		const gif = await download.evaluate(readGif);
		expect(gif.signature).toBe('GIF89a');
		expect(gif.width).toBe(240);
		expect(gif.height).toBe(180);
		expect(gif.loops).toBe(true);
		expect(gif.byteLength).toBeGreaterThan(1000);

		/* Showing the original swaps the preview only: the finished GIF stays downloadable. */
		await expect(previewToggle).toBeVisible();
		await expect(previewToggle).toHaveText('Show original');
		await previewToggle.click();
		await expect(sourcePreview).toBeVisible();
		await expect(result).toBeHidden();
		await expect(previewToggle).toHaveText('Show GIF');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'tiny-clip.gif');
		await previewToggle.click();
		await expect(result).toBeVisible();
		await expect(sourcePreview).toBeHidden();
		await expect(previewToggle).toHaveText('Show original');

		await loopInput.uncheck();
		await widthInput.fill('960');
		await expect(tool.locator('[data-width-label]')).toHaveText('960px');
		await fpsInput.fill('24');
		await colorsInput.fill('256');
		await convert.click();
		/* A second run puts the source back on screen instead of blanking the panel while it works. */
		await expect(convert).toBeDisabled();
		await expect(sourcePreview).toBeVisible();
		await expect(result).toBeHidden();

		await expect(status).toHaveText('The GIF is ready.', { timeout: 150_000 });
		await expect(tool.locator('[data-output-meta]')).toContainText('960px wide | 24 FPS | 256 colors');
		const wideGif = await download.evaluate(readGif);
		expect(wideGif.signature).toBe('GIF89a');
		expect(wideGif.width).toBe(960);
		expect(wideGif.height).toBe(720);
		expect(wideGif.loops).toBe(false);

		await clear.click();
		await expect(status).toHaveText('The tool has been reset.');
		await expect(status).toHaveAttribute('data-state', 'info');
		await expect(tool.locator('[data-file-name]')).toHaveText('Choose video');
		await expect(tool.locator('[data-video-meta]')).toBeEmpty();
		await expect(sourcePreview).toBeHidden();
		await expect(result).toBeHidden();
		await expect(download).toBeHidden();
		await expect(previewToggle).toBeHidden();
		await expect(convert).toBeDisabled();
		await expect(clear).toBeDisabled();
		await expect(startInput).toHaveValue('0');
		await expect(durationInput).toHaveValue('3');
	});

	test('Video to GIF hands ffmpeg the containers the browser cannot read', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/converter/video-to-gif/');

		const noPreview = 'This container cannot be previewed in the browser. The trim controls stay off and the whole clip is converted.';
		const tool = page.locator('[data-video-gif]');
		const status = tool.locator('[data-status]');
		const convert = tool.locator('[data-convert]');
		const download = tool.locator('[data-download]');
		const result = tool.locator('[data-result]');
		const sourcePreview = tool.locator('[data-source-preview]');
		const previewToggle = tool.locator('[data-preview-toggle]');
		const startInput = tool.locator('[data-start]');
		const durationInput = tool.locator('[data-duration]');
		const widthInput = tool.locator('[data-width]');

		/* A readable clip first, so switching to an unreadable one has real state to clear. */
		await tool.locator('[data-file]').setInputFiles(fixtureUpload('tiny-clip.webm', 'video/webm'));
		await expect(status).toHaveText('tiny-clip.webm is selected (3.2 KB).', { timeout: 15_000 });
		await expect(tool.locator('[data-video-meta]')).toHaveText('160 x 120px | 0:01');
		await expect(sourcePreview).toBeVisible();
		await expect(startInput).toBeEnabled();
		await expect(durationInput).toBeEnabled();

		/* The picker advertises AVI, and Chromium cannot demux one, so the metadata read fails. */
		await tool.locator('[data-file]').setInputFiles(createAviUpload());
		await expect(status).toHaveText(noPreview, { timeout: 15_000 });
		await expect(status).toHaveAttribute('data-state', 'info');
		/* The file stays selected and convertible: only the browser gave up, not ffmpeg. */
		await expect(tool.locator('[data-file-name]')).toHaveText('mjpeg-clip.avi');
		await expect(tool.locator('[data-file-meta]')).toContainText('video/x-msvideo');
		await expect(convert).toBeEnabled();
		await expect(tool.locator('[data-clear]')).toBeEnabled();
		/* No duration means no trim range, but every setting that never needed one keeps working. */
		await expect(startInput).toBeDisabled();
		await expect(durationInput).toBeDisabled();
		await expect(widthInput).toBeEnabled();
		await expect(tool.locator('[data-fps]')).toBeEnabled();
		await expect(tool.locator('[data-colors]')).toBeEnabled();
		await expect(tool.locator('[data-loop]')).toBeEnabled();
		/* Nothing to show in a video element that could not read the file. */
		await expect(sourcePreview).toBeHidden();
		await expect(previewToggle).toBeHidden();
		await expect(tool.locator('[data-video-meta]')).toBeEmpty();

		await widthInput.fill('240');
		await tool.locator('[data-fps]').fill('6');
		await tool.locator('[data-colors]').fill('32');

		await convert.click();
		await expect(status).toHaveText('The GIF is ready.', { timeout: 150_000 });
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(result).toBeVisible();
		await expect(tool.locator('[data-output-meta]')).toContainText('240px wide | 6 FPS | 32 colors');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'mjpeg-clip.gif');
		/* The output is the only preview there is, so the tool offers no switch back to the source. */
		await expect(previewToggle).toBeHidden();
		await expect(sourcePreview).toBeHidden();

		const gif = await download.evaluate(readGif);
		expect(gif.signature).toBe('GIF89a');
		/* 96x64 MJPEG frames scaled to the 240px the width slider reports. */
		expect(gif.width).toBe(240);
		expect(gif.height).toBe(160);
		expect(gif.loops).toBe(true);
		/* Five seconds at six frames a second. A run that had kept the three-second default
		   window would have written 18 frames, so this is what "the whole clip" means. */
		expect(gif.frames).toBeGreaterThan(24);

		/* When ffmpeg cannot read the file either, its own failure is what the tool reports. */
		await tool.locator('[data-file]').setInputFiles(fixtureUpload('legal-document.odt', 'application/vnd.oasis.opendocument.text'));
		await expect(status).toHaveText(noPreview, { timeout: 15_000 });
		await expect(download).toBeHidden();
		await expect(result).toBeHidden();
		await expect(convert).toBeEnabled();

		await convert.click();
		await expect(status).toHaveText('FFmpeg exited with code 1', { timeout: 150_000 });
		await expect(status).toHaveAttribute('data-state', 'error');
		await expect(download).toBeHidden();
		await expect(convert).toBeEnabled();
	});

	test('Lossless Media Studio remuxes, reports a failed run, and muxes in a replacement track', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		await page.goto('/en/tools/lossless-media-studio/');

		const tool = page.locator('[data-media-surgeon]');
		const status = tool.locator('[data-status]');
		const runButton = tool.locator('[data-process]');
		const download = tool.locator('[data-download]');
		const resultMeta = tool.locator('[data-result-meta]');
		const operation = tool.locator('[data-operation]');
		const container = tool.locator('[data-container]');
		const replacementWrap = tool.locator('[data-replacement-wrap]');
		const times = tool.locator('[data-times]');

		await expect(status).toHaveText('Choose a source file.');
		await expect(runButton).toBeDisabled();
		await expect(download).toBeHidden();
		await expect(resultMeta).toHaveText('No output yet.');
		await expect(replacementWrap).toBeHidden();
		await expect(times).toBeHidden();
		await expect(tool.locator('[data-trim-note]')).toBeHidden();

		/* The operation select drives the extra panels and the container it can write into. */
		await operation.selectOption('trim');
		await expect(times).toBeVisible();
		await expect(tool.locator('[data-trim-note]')).toBeVisible();
		await operation.selectOption('extract');
		await expect(times).toBeHidden();
		await expect(container).toHaveValue('mka');
		await operation.selectOption('replace');
		await expect(replacementWrap).toBeVisible();
		await expect(container).toHaveValue('mkv');
		await operation.selectOption('remux');
		await expect(replacementWrap).toBeHidden();

		await tool.locator('[data-source]').setInputFiles(fixtureUpload('tiny-clip.mp4', 'video/mp4'));
		await expect(status).toHaveText('Ready: tiny-clip.mp4');
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(tool.locator('[data-source-name]')).toHaveText('tiny-clip.mp4');
		await expect(tool.locator('[data-source-meta]')).toHaveText('2.8 KB');
		await expect(runButton).toBeEnabled();

		await runButton.click();
		await expect(status).toHaveText('Lossless processing complete.', { timeout: 150_000 });
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'tiny-clip-remux.mkv');
		await expect(resultMeta).toContainText('tiny-clip-remux.mkv');
		await expect(runButton).toBeEnabled();

		/* The source is an ISO container; the result has to be Matroska, at a comparable size. */
		const source = readFileSync(fixturePath('tiny-clip.mp4'));
		expect(source.subarray(4, 8).toString('latin1')).toBe('ftyp');
		const remuxed = await download.evaluate(readContainer);
		expect(remuxed.magic).toBe('1a45dfa3');
		expect(remuxed.byteLength).toBeGreaterThan(1500);
		expect(remuxed.byteLength).toBeLessThan(12_000);

		/* An impossible trim has to say so: the finally clause used to overwrite the error with "Ready". */
		await operation.selectOption('trim');
		await tool.locator('[data-start]').fill('5');
		await tool.locator('[data-end]').fill('2');
		await runButton.click();
		await expect(status).toHaveText('Processing failed: End time must be after start time', { timeout: 60_000 });
		await expect(status).toHaveAttribute('data-state', 'error');
		await expect(runButton).toBeEnabled();
		/* The remux that finished before this run must not stay downloadable beside the error. */
		await expect(download).toBeHidden();
		await expect(resultMeta).toHaveText('No output yet.');
		expect(await download.getAttribute('href')).toBeNull();
		expect(await download.getAttribute('download')).toBeNull();

		/* Replacing the audio needs a second file, and the picker has to admit which one it got. */
		await operation.selectOption('replace');
		await expect(replacementWrap).toBeVisible();
		await expect(runButton).toBeDisabled();
		await expect(tool.locator('[data-audio-name]')).toHaveText('Select new audio track');
		await tool.locator('[data-audio]').setInputFiles(createToneUpload());
		await expect(tool.locator('[data-audio-name]')).toHaveText('tone.wav');
		await expect(tool.locator('[data-audio-meta]')).toHaveText('16 KB');
		await expect(runButton).toBeEnabled();

		await runButton.click();
		await expect(status).toHaveText('Lossless processing complete.', { timeout: 150_000 });
		await expect(download).toHaveAttribute('download', 'tiny-clip-replace.mkv');
		const replaced = await download.evaluate(readContainer);
		expect(replaced.magic).toBe('1a45dfa3');
		/* The replacement track went in untouched: still linear PCM, still about 16 KB of samples. */
		expect(replaced.text).toContain('A_PCM');
		expect(replaced.byteLength).toBeGreaterThan(12_000);

		await tool.locator('[data-clear]').click();
		await expect(status).toHaveText('Choose a source file.');
		await expect(status).toHaveAttribute('data-state', 'info');
		await expect(download).toBeHidden();
		await expect(resultMeta).toHaveText('No output yet.');
		await expect(operation).toHaveValue('remux');
		await expect(container).toHaveValue('mkv');
		await expect(replacementWrap).toBeHidden();
		await expect(times).toBeHidden();
		await expect(runButton).toBeDisabled();
		await expect(tool.locator('[data-source-name]')).toHaveText('Select audio or video');
		await expect(tool.locator('[data-source-meta]')).toHaveText('MP4, MOV, MKV, WebM, TS, and other FFmpeg formats');
		await expect(tool.locator('[data-audio-name]')).toHaveText('Select new audio track');
		await expect(tool.locator('[data-start]')).toHaveValue('');
		await expect(tool.locator('[data-end]')).toHaveValue('');
	});
});
