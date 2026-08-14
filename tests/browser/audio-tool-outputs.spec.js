import { expect, test } from '@playwright/test';
import { cacheCdnAssets } from './cdn-cache.mjs';

/*
 * The audio tools all hand the user a file or a score. These tests drive the real
 * controls and then read the bytes behind the download link, so "the tool worked"
 * means the artifact parses, not that a status line changed.
 *
 * Only uncaught page exceptions are collected: the ffmpeg.wasm worker is noisy on
 * the console, and a failed handler always surfaces here anyway.
 */
const collectPageErrors = (page) => {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
};

/*
 * A real, decodable RIFF/WAVE file, built the way tools-smoke.spec.js builds its
 * analyzer tone. 44.1 kHz because libmp3lame rejects the tools' bitrates at 8 kHz.
 * `title` adds a LIST/INFO chunk, which is how a source file carries tags that
 * muxing is supposed to preserve.
 */
const createWavFixture = ({ name = 'tone.wav', seconds = 1, sampleRate = 44_100, frequency = 440, title = '' } = {}) => {
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

	const chunks = [Buffer.from('WAVE', 'latin1'), fmt];
	if (title) {
		const value = Buffer.from(`${title}\0`, 'latin1');
		const padded = value.length % 2 ? Buffer.concat([value, Buffer.alloc(1)]) : value;
		const list = Buffer.alloc(20 + padded.length);
		list.write('LIST', 0);
		list.writeUInt32LE(12 + padded.length, 4);
		list.write('INFO', 8);
		list.write('INAM', 12);
		list.writeUInt32LE(value.length, 16);
		padded.copy(list, 20);
		chunks.push(list);
	}
	chunks.push(data);

	const body = Buffer.concat(chunks);
	const header = Buffer.alloc(8);
	header.write('RIFF', 0);
	header.writeUInt32LE(body.length, 4);
	return { name, mimeType: 'audio/wav', buffer: Buffer.concat([header, body]) };
};

/* Fetches the blob a download link points at and reports what the bytes really are. */
const inspectDownload = (link) => link.evaluate(async (node) => {
	const blob = await (await fetch(node.href)).blob();
	const bytes = new Uint8Array(await blob.arrayBuffer());
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = (offset) => new TextDecoder('latin1').decode(bytes.subarray(offset, offset + 4));
	const result = {
		type: blob.type,
		byteLength: bytes.byteLength,
		magic: [...bytes.subarray(0, 4)].map((byte) => byte.toString(16).padStart(2, '0')).join(''),
		head: tag(0),
		wav: null,
	};

	if (tag(0) === 'RIFF' && tag(8) === 'WAVE') {
		for (let offset = 12; offset + 8 <= bytes.byteLength;) {
			const size = view.getUint32(offset + 4, true);
			if (tag(offset) === 'fmt ') {
				result.wav = {
					format: view.getUint16(offset + 8, true),
					channels: view.getUint16(offset + 10, true),
					sampleRate: view.getUint32(offset + 12, true),
					bitDepth: view.getUint16(offset + 22, true),
				};
				break;
			}
			offset += 8 + size + (size % 2);
		}
	}

	return result;
});

/* Latin-1 keeps every byte addressable, so binary containers can be searched for their embedded strings. */
const downloadText = (link) => link.evaluate(async (node) => new TextDecoder('latin1')
	.decode(new Uint8Array(await (await fetch(node.href)).arrayBuffer())));

test.describe('audio tool outputs', () => {
	test('Podcast Chapter Editor writes exact YouTube and FFmetadata chapter text', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/podcast-chapter-editor/');
		const tool = page.locator('[data-chapterizer]');
		const youtube = tool.locator('[data-youtube]');
		const meta = tool.locator('[data-meta]');

		await expect(tool.locator('[data-status]')).toHaveText('4 chapters detected.');
		await expect(tool.locator('[data-preview] li')).toHaveCount(4);
		await expect(tool.locator('[data-preview] li').first()).toHaveText('0:00 Intro');
		await expect(tool.locator('[data-preview] li').last()).toHaveText('18:45 Outro');
		await expect(youtube).toBeHidden();
		await expect(meta).toBeHidden();

		/* Embedding without a media file must say so instead of starting FFmpeg. */
		await tool.locator('[data-mux]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Choose a media file first.');
		await expect(tool.locator('[data-status]')).toHaveAttribute('data-state', 'error');

		/* Unparsable lines are dropped and the rest is sorted by start time. */
		await tool.locator('[data-chapters]').fill('this is not a chapter\n1:05:00 Deep dive\n00:00 Intro\n02:30 Main topic');
		await expect(tool.locator('[data-status]')).toHaveText('3 chapters detected.');
		await expect(tool.locator('[data-preview] li')).toHaveText(['0:00 Intro', '2:30 Main topic', '1:05:00 Deep dive']);

		await tool.locator('[data-make]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Chapter files created.');
		await expect(youtube).toBeVisible();
		await expect(youtube).toHaveAttribute('download', 'youtube-chapters.txt');
		await expect(meta).toHaveAttribute('download', 'chapters.ffmetadata');

		expect(await downloadText(youtube)).toBe('0:00 Intro\n2:30 Main topic\n1:05:00 Deep dive\n');
		expect(await downloadText(meta)).toBe([
			';FFMETADATA1',
			'[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'END=149999', 'title=Intro',
			'[CHAPTER]', 'TIMEBASE=1/1000', 'START=150000', 'END=3899999', 'title=Main topic',
			'[CHAPTER]', 'TIMEBASE=1/1000', 'START=3900000', 'END=3959999', 'title=Deep dive',
			'',
		].join('\n'));

		/* Editing the chapters invalidates files that were built from the old text. */
		await tool.locator('[data-chapters]').fill('00:00 Cold open\n00:45 Interview');
		await expect(tool.locator('[data-status]')).toHaveText('2 chapters detected.');
		await expect(youtube).toBeHidden();
		await expect(meta).toBeHidden();
		await expect(youtube).not.toHaveAttribute('download');
		await expect(meta).not.toHaveAttribute('download');

		/* FFmetadata reserves = ; # and \, so the title has to reach the file escaped. */
		await tool.locator('[data-chapters]').fill(`00:00 ${String.raw`AC\DC live; take #2 = final`}`);
		await tool.locator('[data-make]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Chapter files created.');
		expect(await downloadText(meta)).toContain(String.raw`title=AC\\DC live\; take \#2 \= final`);
		expect(await downloadText(youtube)).toBe(`0:00 ${String.raw`AC\DC live; take #2 = final`}\n`);

		/* Nothing parseable left: the generator reports it and produces no files. */
		await tool.locator('[data-chapters]').fill('nothing usable here');
		await expect(tool.locator('[data-status]')).toHaveText('Paste chapters. Format: 00:00 Title');
		await tool.locator('[data-make]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Chapter processing failed: No valid chapters found.');
		await expect(youtube).toBeHidden();
		await expect(meta).toBeHidden();

		await tool.locator('[data-chapters]').fill('00:00 Intro');
		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-chapters]')).toHaveValue('');
		await expect(tool.locator('[data-preview] li')).toHaveCount(0);
		await expect(tool.locator('[data-file-name]')).toHaveText('Choose audio or video');
		await expect(tool.locator('[data-status]')).toHaveText('Paste chapters. Format: 00:00 Title');
		expect(errors).toEqual([]);
	});

	test('Podcast Chapter Editor embeds chapters without dropping the source tags', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/podcast-chapter-editor/');
		const tool = page.locator('[data-chapterizer]');
		const media = tool.locator('[data-media]');

		await tool.locator('[data-file]').setInputFiles(createWavFixture({
			name: 'chapter-source.wav',
			seconds: 1,
			title: 'Episode 12',
		}));
		await expect(tool.locator('[data-file-name]')).toHaveText('chapter-source.wav');
		await expect(tool.locator('[data-audio]')).toHaveAttribute('src', /^blob:/);

		await tool.locator('[data-chapters]').fill('00:00 Intro\n00:00.600 Chorus');
		await expect(tool.locator('[data-status]')).toHaveText('2 chapters detected.');
		await tool.locator('[data-output]').selectOption('mkv');
		await tool.locator('[data-mux]').click();

		await expect(tool.locator('[data-status]')).toHaveText('Media file with chapters created.', { timeout: 150_000 });
		await expect(media).toBeVisible();
		await expect(media).toHaveAttribute('download', 'chapter-source-chapters.mkv');

		const muxed = await inspectDownload(media);
		expect(muxed.magic).toBe('1a45dfa3');
		expect(muxed.type).toBe('video/x-matroska');
		expect(muxed.byteLength).toBeGreaterThan(44_100);

		const contents = await downloadText(media);
		expect(contents).toContain('Intro');
		expect(contents).toContain('Chorus');
		/* -map_metadata has to point at the media, not at the chapter file. */
		expect(contents).toContain('Episode 12');

		/* The muxed file carries the old chapters, so editing them retires it too. */
		await tool.locator('[data-chapters]').fill('00:00 Different intro');
		await expect(media).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('Podcast Cleaner encodes the format that was selected when the run started', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/podcast-cleaner/');
		const tool = page.locator('[data-podcast-cleaner]');
		const download = tool.locator('[data-download]');

		await expect(tool.locator('[data-process]')).toBeDisabled();
		await expect(tool.locator('[data-status]')).toHaveText('Choose a file.');
		await tool.locator('[data-file]').setInputFiles(createWavFixture({ name: 'episode-a.wav', seconds: 4 }));
		await expect(tool.locator('[data-status]')).toHaveText('episode-a.wav is ready.');
		await expect(tool.locator('[data-original-wrap]')).toBeVisible();
		await expect(tool.locator('[data-cleaned-wrap]')).toBeHidden();
		await expect(tool.locator('[data-process]')).toBeEnabled();

		/* Both sliders label themselves from their own value. */
		await tool.locator('[data-highpass-freq]').fill('120');
		await expect(tool.locator('[data-highpass-label]')).toHaveText('120 Hz');
		await tool.locator('[data-silence-threshold]').fill('-50');
		await expect(tool.locator('[data-silence-label]')).toHaveText('-50 dB');

		await expect(tool.locator('[data-format]')).toHaveValue('mp3');
		await tool.locator('[data-process]').click();
		/* Switching the format mid-run must not rename or relabel the bytes being encoded. */
		await tool.locator('[data-format]').selectOption('wav');
		await expect(tool.locator('[data-status]')).toHaveText('Podcast Cleaner is done.', { timeout: 150_000 });

		await expect(tool.locator('[data-cleaned-wrap]')).toBeVisible();
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'episode-a-cleaned.mp3');
		const cleanedMp3 = await inspectDownload(download);
		expect(cleanedMp3.type).toBe('audio/mpeg');
		/* "ID3" plus the tag version byte: the MP3 muxer always writes an ID3v2 header. */
		expect(cleanedMp3.magic).toMatch(/^494433/);
		expect(cleanedMp3.byteLength).toBeGreaterThan(10_000);
		expect(await tool.locator('[data-cleaned]').getAttribute('src')).toBe(await download.getAttribute('href'));

		/* A new source retires the previous result instead of leaving it downloadable. */
		await tool.locator('[data-file]').setInputFiles(createWavFixture({ name: 'episode-b.wav', seconds: 4, frequency: 660 }));
		await expect(tool.locator('[data-status]')).toHaveText('episode-b.wav is ready.');
		await expect(tool.locator('[data-cleaned-wrap]')).toBeHidden();
		await expect(download).toBeHidden();
		await expect(download).not.toHaveAttribute('download');

		/* WAV output with normalization off keeps the source sample rate. */
		await tool.locator('[data-loudness]').uncheck();
		await tool.locator('[data-declick]').check();
		await tool.locator('[data-denoise]').check();
		await expect(tool.locator('[data-format]')).toHaveValue('wav');
		await tool.locator('[data-process]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Podcast Cleaner is done.', { timeout: 150_000 });

		await expect(download).toHaveAttribute('download', 'episode-b-cleaned.wav');
		const cleanedWav = await inspectDownload(download);
		expect(cleanedWav.type).toBe('audio/wav');
		expect(cleanedWav.head).toBe('RIFF');
		expect(cleanedWav.wav).toEqual({ format: 1, channels: 1, sampleRate: 44_100, bitDepth: 16 });
		expect(cleanedWav.byteLength).toBeGreaterThan(44_100 * 2);

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Choose a file.');
		await expect(tool.locator('[data-process]')).toBeDisabled();
		await expect(tool.locator('[data-original-wrap]')).toBeHidden();
		await expect(tool.locator('[data-cleaned-wrap]')).toBeHidden();
		await expect(download).toBeHidden();
		await expect(tool.locator('[data-file-name]')).toHaveText('Choose audio or video');
		expect(errors).toEqual([]);
	});

	test('Loudness Mastering writes a 48 kHz WAV and retires it when the source changes', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/loudness-mastering/');
		const tool = page.locator('[data-loudness-mastering]');
		const download = tool.locator('[data-download]');

		await expect(tool.locator('[data-process]')).toBeDisabled();
		await expect(tool.locator('[data-status]')).toHaveText('Choose an audio file to start mastering.');
		await tool.locator('[data-file-input]').setInputFiles(createWavFixture({ name: 'episode-a.wav', seconds: 4 }));
		await expect(tool.locator('[data-status]')).toHaveText('Preparing file...');
		await expect(tool.locator('[data-file-name]')).toHaveText('episode-a.wav');
		await expect(tool.locator('[data-result-title]')).toHaveText('Selected file: episode-a.wav');
		await expect(download).toBeHidden();

		await tool.locator('[data-process]').click();
		await expect(tool.locator('[data-status]')).toHaveText('The file was mastered successfully.', { timeout: 150_000 });
		await expect(download).toBeVisible();
		await expect(download).toHaveAttribute('download', 'episode-a-mastered.wav');
		await expect(tool.locator('[data-result-meta]')).toContainText('WAV');

		const mastered = await inspectDownload(download);
		expect(mastered.type).toBe('audio/wav');
		expect(mastered.head).toBe('RIFF');
		/* The WAV profile pairs pcm_s16le with -ar 48000. */
		expect(mastered.wav).toEqual({ format: 1, channels: 1, sampleRate: 48_000, bitDepth: 16 });
		expect(mastered.byteLength).toBeGreaterThan(48_000 * 2);

		/* The mastered blob belongs to episode-a; picking another file must retire it. */
		await tool.locator('[data-file-input]').setInputFiles(createWavFixture({ name: 'episode-b.wav', seconds: 1, frequency: 660 }));
		await expect(tool.locator('[data-result-title]')).toHaveText('Selected file: episode-b.wav');
		await expect(download).toBeHidden();
		await expect(download).not.toHaveAttribute('download');
		await expect(download).not.toHaveAttribute('href');

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Choose an audio file to start mastering.');
		await expect(tool.locator('[data-process]')).toBeDisabled();
		await expect(tool.locator('[data-file-name]')).toHaveText('Select audio file');
		await expect(tool.locator('[data-result-title]')).toHaveText('Selected file: Select audio file');
		expect(errors).toEqual([]);
	});

	test('ABX tester scores a blind run and starts a new one from the results', async ({ page }) => {
		test.setTimeout(90_000);
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/abx-tester/');
		const tool = page.locator('[data-abx-tester]');
		const playToggle = tool.locator('[data-play-toggle]');
		const seek = tool.locator('[data-seek]');

		await expect(tool.locator('[data-start]')).toBeDisabled();
		await tool.locator('[data-file-a]').setInputFiles(createWavFixture({ name: 'lossless.wav', seconds: 1.2 }));
		await tool.locator('[data-file-b]').setInputFiles(createWavFixture({ name: 'lossy.wav', seconds: 1.2, frequency: 445 }));

		/* Both files decode natively, so FFmpeg never has to load. */
		await expect(tool.locator('[data-status]')).toHaveText('Both files are ready. Common test duration: 0:01.', { timeout: 20_000 });
		await expect(tool.locator('[data-file-a-name]')).toHaveText('lossless.wav');
		await expect(tool.locator('[data-file-a-meta]')).toContainText('browser decoder');
		await expect(tool.locator('[data-file-b-meta]')).toContainText('browser decoder');
		await expect(tool.locator('[data-start]')).toBeEnabled();

		await tool.locator('[data-trial-count]').fill('4');
		await expect(tool.locator('[data-trial-count-label]')).toHaveText('4');
		await tool.locator('[data-start]').click();

		await expect(tool.locator('[data-stage]')).toBeVisible();
		await expect(tool.locator('[data-results]')).toBeHidden();
		await expect(tool.locator('[data-round-label]')).toHaveText('Trial 1 of 4');
		await expect(tool.locator('[data-duration]')).toHaveText('0:01');

		/* Seeking moves the shared transport, and Stop returns it to the start. */
		await seek.fill('1000');
		await expect(tool.locator('[data-current-time]')).toHaveText('0:01');
		await tool.locator('[data-stop]').click();
		await expect(tool.locator('[data-current-time]')).toHaveText('0:00');

		/* Each slot button takes over playback and marks itself as the active one. */
		await tool.locator('[data-play-slot="X"]').click();
		await expect(playToggle).toHaveText('Pause');
		await expect(tool.locator('[data-play-slot="X"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(tool.locator('[data-play-slot="A"]')).toHaveAttribute('aria-pressed', 'false');
		await playToggle.click();
		await expect(playToggle).toHaveText('Play');
		await tool.locator('[data-play-slot="A"]').click();
		await expect(tool.locator('[data-play-slot="A"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(playToggle).toHaveText('Pause');
		await tool.locator('[data-stop]').click();
		await expect(playToggle).toHaveText('Play');

		/* Loop off: playback ends with the selection instead of restarting. */
		await tool.locator('[data-loop]').uncheck();
		await tool.locator('[data-play-slot="A"]').click();
		await expect(playToggle).toHaveText('Pause');
		await expect(playToggle).toHaveText('Play', { timeout: 15_000 });

		/* Loop on: the position wraps back to the start and playback keeps running. */
		await tool.locator('[data-loop]').check();
		await tool.locator('[data-stop]').click();
		await tool.locator('[data-play-slot="A"]').click();
		await expect.poll(() => seek.inputValue().then(Number), { timeout: 15_000 }).toBeGreaterThan(900);
		await expect.poll(() => seek.inputValue().then(Number), { timeout: 15_000 }).toBeLessThan(600);
		await expect(playToggle).toHaveText('Pause');
		await tool.locator('[data-stop]').click();

		for (let trial = 1; trial <= 4; trial += 1) {
			await expect(tool.locator('[data-round-label]')).toHaveText(`Trial ${trial} of 4`);
			await tool.locator('[data-answer="A"]').click();
		}

		await expect(tool.locator('[data-results]')).toBeVisible();
		await expect(tool.locator('[data-stage]')).toBeHidden();
		await expect(tool.locator('[data-score]')).toHaveText(/^[0-4]\/4 correct \(\d+%\)$/);
		await expect(tool.locator('[data-result-note]')).toContainText('Chance probability for this score or better:');
		await expect(tool.locator('[data-result-list] li')).toHaveCount(4);
		await expect(tool.locator('[data-result-list] li').first()).toContainText('Trial 1: you chose A; X was');

		/* "Run again" has to run the test again, not drop back to the setup panel. */
		await tool.locator('[data-new-run]').click();
		await expect(tool.locator('[data-stage]')).toBeVisible();
		await expect(tool.locator('[data-results]')).toBeHidden();
		await expect(tool.locator('[data-round-label]')).toHaveText('Trial 1 of 4');
		await expect(tool.locator('[data-status]')).toHaveText('Both files are ready. Common test duration: 0:01.');
		await tool.locator('[data-answer="B"]').click();
		await expect(tool.locator('[data-round-label]')).toHaveText('Trial 2 of 4');

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-status]')).toHaveText('The test has been reset.');
		await expect(tool.locator('[data-stage]')).toBeHidden();
		await expect(tool.locator('[data-results]')).toBeHidden();
		await expect(tool.locator('[data-start]')).toBeDisabled();
		await expect(tool.locator('[data-file-a-name]')).toHaveText('Choose audio file');
		expect(errors).toEqual([]);
	});

	test('MP3 Quality Tester keeps the trial count in step with presets and repeats', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/mp3-quality-tester/');
		const tool = page.locator('[data-mp3-quality-tester]');

		await expect(tool.locator('[data-total-trials-label]')).toHaveText('8');
		await expect(tool.locator('[data-start]')).toBeDisabled();
		await expect(tool.locator('[data-clear]')).toBeDisabled();

		await tool.locator('[data-file]').setInputFiles(createWavFixture({ name: 'master.wav' }));
		await expect(tool.locator('[data-status]')).toContainText('master.wav is selected');
		await expect(tool.locator('[data-file-name]')).toHaveText('master.wav');
		await expect(tool.locator('[data-start]')).toBeEnabled();

		await tool.locator('[data-preset][value="mp3-v3"]').uncheck();
		await tool.locator('[data-preset][value="mp3-v6"]').uncheck();
		await expect(tool.locator('[data-total-trials-label]')).toHaveText('4');
		await tool.locator('[data-repeat-count]').fill('5');
		await expect(tool.locator('[data-repeat-count-label]')).toHaveText('5');
		await expect(tool.locator('[data-total-trials-label]')).toHaveText('10');

		/* Without a single MP3 version there is nothing to compare against. */
		await tool.locator('[data-preset][value="mp3-320"]').uncheck();
		await tool.locator('[data-preset][value="mp3-v0"]').uncheck();
		await expect(tool.locator('[data-total-trials-label]')).toHaveText('0');
		await expect(tool.locator('[data-start]')).toBeDisabled();
		await tool.locator('[data-preset][value="mp3-320"]').check();
		await expect(tool.locator('[data-start]')).toBeEnabled();

		await tool.locator('[data-clear]').click();
		await expect(tool.locator('[data-status]')).toHaveText('The test has been reset.');
		await expect(tool.locator('[data-file-name]')).toHaveText('Choose audio file');
		await expect(tool.locator('[data-start]')).toBeDisabled();
		expect(errors).toEqual([]);
	});

	test('MP3 Quality Tester encodes a real MP3 and scores a blind trial', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/mp3-quality-tester/');
		const tool = page.locator('[data-mp3-quality-tester]');

		await tool.locator('[data-file]').setInputFiles(createWavFixture({ name: 'master.wav', seconds: 1 }));
		for (const value of ['mp3-v0', 'mp3-v3', 'mp3-v6']) {
			await tool.locator(`[data-preset][value="${value}"]`).uncheck();
		}
		await tool.locator('[data-repeat-count]').fill('1');
		await expect(tool.locator('[data-total-trials-label]')).toHaveText('1');

		await tool.locator('[data-start]').click();
		await expect(tool.locator('[data-stage]')).toBeVisible({ timeout: 150_000 });
		await expect(tool.locator('[data-round-label]')).toHaveText('Trial 1 of 1 · 320 kbps CBR');
		await expect(tool.locator('[data-duration]')).toHaveText(/^0:0[01]$/);

		/* Stop, rather than the toggle, is the safe way back: this run does not loop. */
		await tool.locator('[data-play-slot="B"]').click();
		await expect(tool.locator('[data-play-toggle]')).toHaveText('Pause');
		await tool.locator('[data-stop]').click();
		await expect(tool.locator('[data-play-toggle]')).toHaveText('Play');
		await tool.locator('[data-play-toggle]').click();
		await expect(tool.locator('[data-play-toggle]')).toHaveText('Pause');
		await tool.locator('[data-stop]').click();
		await expect(tool.locator('[data-play-toggle]')).toHaveText('Play');

		await tool.locator('[data-answer="A"]').click();
		await expect(tool.locator('[data-status]')).toHaveText(/^(Correct! The original was [AB]\.|Nope\. The original was [AB]\.)$/);
		await expect(tool.locator('[data-results]')).toBeVisible({ timeout: 10_000 });
		await expect(tool.locator('[data-score]')).toHaveText(/^[01]\/1 correct \((0|100)%\)$/);
		await expect(tool.locator('[data-result-list] li')).toHaveCount(1);
		await expect(tool.locator('[data-result-list] li')).toContainText('320 kbps CBR: you chose A; original was');

		await tool.locator('[data-new-run]').click();
		await expect(tool.locator('[data-stage]')).toBeVisible();
		await expect(tool.locator('[data-results]')).toBeHidden();
		await expect(tool.locator('[data-round-label]')).toHaveText('Trial 1 of 1 · 320 kbps CBR');
		expect(errors).toEqual([]);
	});

	test('Audio Analyzer drops the previous file when a decode fails', async ({ page }) => {
		const errors = collectPageErrors(page);
		/* Every AudioContext the tool opens is tracked so the failed load cannot leak one. */
		await page.addInitScript(() => {
			const created = [];
			const Original = window.AudioContext;
			window.AudioContext = class extends Original {
				constructor(...args) {
					super(...args);
					created.push(this);
				}
			};
			window.audioContextStates = () => created.map((context) => context.state);
		});
		await page.goto('/en/tools/audio-analyzer/');
		const tool = page.locator('[data-audio-analyzer]');
		const audio = tool.locator('[data-audio]');

		await tool.locator('[data-file-input]').setInputFiles(createWavFixture({ name: 'good-tone.wav', seconds: 2 }));
		await expect(tool.locator('[data-workspace]')).toBeVisible();
		await expect(tool.locator('[data-status]')).toHaveText('Analysis ready. Drag in either view to select a region.');
		await expect(tool.locator('[data-loaded-name]')).toHaveText('good-tone.wav');
		await expect(tool.locator('[data-loaded-meta]')).toContainText('0:02.000');
		await expect(tool.locator('[data-loaded-meta]')).toContainText('1 channels');

		/* A -6 dBFS sine reads back as its own peak and RMS, not as a placeholder. */
		const level = async (metric) => Number((await tool.locator(`[data-metric="${metric}"]`).textContent()).replace('−', '-'));
		expect(await level('peak')).toBeGreaterThan(-8);
		expect(await level('peak')).toBeLessThan(-5);
		expect(await level('rms')).toBeGreaterThan(-11);
		expect(await level('rms')).toBeLessThan(-8);
		expect(await level('integrated')).toBeLessThan(0);
		await expect(audio).toHaveAttribute('src', /^blob:/);

		await tool.locator('[data-file-input]').setInputFiles({
			name: 'not-really-audio.wav',
			mimeType: 'audio/wav',
			buffer: Buffer.from('This file is text pretending to be a wav.'),
		});
		await expect(tool.locator('[data-status]')).toHaveAttribute('data-state', 'error');
		await expect(tool.locator('[data-status]')).toContainText('The audio file could not be analyzed:');
		await expect(tool.locator('[data-workspace]')).toBeHidden();
		await expect(tool.locator('[data-file-name]')).toHaveText('not-really-audio.wav');

		/* The failed pick leaves nothing loaded, so the keyboard transport cannot play the file before it. */
		await expect(audio).not.toHaveAttribute('src');
		await page.evaluate(() => document.activeElement?.blur());
		await page.keyboard.press('Space');
		await expect.poll(() => audio.evaluate((node) => node.paused)).toBe(true);
		expect(await audio.evaluate((node) => node.currentTime)).toBe(0);
		await expect(tool.locator('[data-play-pause]')).not.toHaveAttribute('data-state', 'playing');

		/* Both contexts are closed: the decode failure must not leak the one it opened. */
		await expect.poll(() => page.evaluate(() => window.audioContextStates())).toEqual(['closed', 'closed']);
		expect(errors).toEqual([]);
	});
});
