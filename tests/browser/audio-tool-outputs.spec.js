import { expect, test } from '@playwright/test';
import { cacheCdnAssets } from './cdn-cache.mjs';
import { fixtureUpload } from './media-fixtures.mjs';

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
// `noise: true` writes deterministic broadband material instead of a tone. A sine is
// periodic, so shifting it by whole periods is indistinguishable and no encoder delay can
// be measured from it; noise has a single unmistakable correlation peak.
const createWavFixture = ({ name = 'tone.wav', seconds = 1, sampleRate = 44_100, frequency = 440, title = '', noise = false } = {}) => {
	const sampleCount = Math.round(seconds * sampleRate);
	const data = Buffer.alloc(8 + sampleCount * 2);
	data.write('data', 0);
	data.writeUInt32LE(sampleCount * 2, 4);
	let seed = 1;
	for (let index = 0; index < sampleCount; index += 1) {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		const sample = noise
			? (seed / 2 ** 32) * 2 - 1
			: Math.sin(2 * Math.PI * frequency * index / sampleRate);
		data.writeInt16LE(Math.round(sample * 16_000), 8 + index * 2);
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

/* A last chapter has no successor to end at, so without a media duration the tool has to own up to guessing. */
const assumedEndStatus = 'Chapter files created. Without a known media duration the last chapter is assumed to be 60 seconds long.';

/* Latin-1 keeps every byte addressable, so binary containers can be searched for their embedded strings. */
const downloadText = (link) => link.evaluate(async (node) => new TextDecoder('latin1')
	.decode(new Uint8Array(await (await fetch(node.href)).arrayBuffer())));

/*
 * The sample entry in an MP4's first track names the codec that really ended up in the
 * file, next to the frame size for a picture track or the sample rate for a sound one.
 * That is the difference between "the container is right" and "the streams are right".
 */
const mp4SampleEntry = (link) => link.evaluate(async (node) => {
	const bytes = new Uint8Array(await (await fetch(node.href)).arrayBuffer());
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const boxes = new TextDecoder('latin1').decode(bytes);
	const stsd = boxes.indexOf('stsd');
	if (stsd < 0) return { codec: 'no stsd box in the produced MP4' };
	/* stsd: type, version+flags, entry count, then the sample entry's size and type. */
	const entry = stsd + 16;
	return {
		codec: boxes.slice(entry, entry + 4),
		width: view.getUint16(entry + 28),
		height: view.getUint16(entry + 30),
		/* A sound entry spends the same two bytes on the whole half of its 16.16 sample rate. */
		sampleRate: view.getUint16(entry + 28),
	};
});

test.describe('audio tool outputs', () => {
	test('Podcast Chapter Editor writes exact YouTube and FFmetadata chapter text', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/podcast-chapter-editor/');
		const tool = page.locator('[data-chapterizer]');
		const youtube = tool.locator('[data-youtube]');
		const meta = tool.locator('[data-meta]');

		/* Every container the tool can write is on the menu, and none of them ever leaves it. */
		await expect(tool.locator('[data-output] option')).toHaveText(['M4A', 'MP3', 'MP4', 'MKV']);
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
		/* No media file, so the last chapter's end is a guess and has to be named as one. */
		await expect(tool.locator('[data-status]')).toHaveText(assumedEndStatus);
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
		await expect(tool.locator('[data-status]')).toHaveText(assumedEndStatus);
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

	test('Podcast Chapter Editor keeps every container on offer and takes the last chapter end from the media file', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/podcast-chapter-editor/');
		const tool = page.locator('[data-chapterizer]');
		const output = tool.locator('[data-output]');
		const meta = tool.locator('[data-meta]');

		await expect(output.locator('option')).toHaveText(['M4A', 'MP3', 'MP4', 'MKV']);
		await expect(output).toHaveValue('m4a');

		/* An MP3 starts at the container it can be copied into; the rest stay one click away. */
		await tool.locator('[data-file]').setInputFiles({
			name: 'episode.mp3',
			mimeType: 'audio/mpeg',
			buffer: Buffer.from('not a decodable mp3'),
		});
		await expect(output.locator('option')).toHaveText(['M4A', 'MP3', 'MP4', 'MKV']);
		await expect(output).toHaveValue('mp3');

		/* The browser cannot read a duration out of that file, so the guess still applies. */
		await tool.locator('[data-chapters]').fill('00:00 Intro\n05:00 Outro');
		await expect(tool.locator('[data-status]')).toHaveText('2 chapters detected.');
		await tool.locator('[data-make]').click();
		await expect(tool.locator('[data-status]')).toHaveText(assumedEndStatus);
		expect(await downloadText(meta)).toContain('START=300000\nEND=359999\n');

		/* PCM cannot be stream-copied into MP3, M4A or MP4, and all three are offered anyway. */
		await tool.locator('[data-file]').setInputFiles(createWavFixture({ name: 'episode.wav', seconds: 1 }));
		await expect(output.locator('option')).toHaveText(['M4A', 'MP3', 'MP4', 'MKV']);
		await expect(output).toHaveValue('mkv');

		/* The player is the thing that knows the episode length, so wait for it to report one. */
		await expect
			.poll(() => tool.locator('[data-audio]').evaluate((node) => node.duration), { timeout: 15_000 })
			.toBeGreaterThan(0.9);

		await tool.locator('[data-chapters]').fill('00:00 Intro\n00:00.400 Chorus');
		await expect(tool.locator('[data-status]')).toHaveText('2 chapters detected.');
		await tool.locator('[data-make]').click();
		await expect(tool.locator('[data-status]')).toHaveText('Chapter files created.');

		const withMedia = await downloadText(meta);
		expect(withMedia).toContain('START=0\nEND=399\n');
		/* The last chapter ends with the one-second file, not 60 seconds after it started. */
		const lastEnd = Number(withMedia.match(/START=400\nEND=(\d+)\n/)[1]);
		expect(lastEnd).toBeGreaterThan(900);
		expect(lastEnd).toBeLessThan(1100);

		/* A container the visitor picked is theirs: the next file follows it instead of overruling it. */
		await output.selectOption('m4a');
		await tool.locator('[data-file]').setInputFiles(createWavFixture({ name: 'second-episode.wav', seconds: 1 }));
		await expect(tool.locator('[data-file-name]')).toHaveText('second-episode.wav');
		await expect(output).toHaveValue('m4a');

		await output.selectOption('mkv');
		await tool.locator('[data-clear]').click();
		await expect(output.locator('option')).toHaveText(['M4A', 'MP3', 'MP4', 'MKV']);
		await expect(output).toHaveValue('m4a');
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

		/* Matroska takes PCM as it stands, so the run is a remux and the status has to say so. */
		await expect(tool.locator('[data-status]')).toHaveText('Media file with chapters created. The streams were copied into MKV losslessly.', { timeout: 150_000 });
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

	test('Podcast Chapter Editor re-encodes a PCM source into the audio container it was asked for', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/podcast-chapter-editor/');
		const tool = page.locator('[data-chapterizer]');
		const status = tool.locator('[data-status]');
		const media = tool.locator('[data-media]');

		/* PCM is exactly what a stream copy cannot pour into an MP4-family container. */
		await tool.locator('[data-file]').setInputFiles(createWavFixture({
			name: 'episode.wav',
			seconds: 1,
			title: 'Episode 12',
		}));
		await expect(tool.locator('[data-output]')).toHaveValue('mkv');
		await tool.locator('[data-output]').selectOption('m4a');
		await tool.locator('[data-chapters]').fill('00:00 Intro\n00:00.600 Chorus');
		await expect(status).toHaveText('2 chapters detected.');

		/* With the duration known the last chapter ends with the file, so no guess is announced. */
		await expect
			.poll(() => tool.locator('[data-audio]').evaluate((node) => node.duration), { timeout: 15_000 })
			.toBeGreaterThan(0.9);

		await tool.locator('[data-mux]').click();
		await expect(status).toHaveText('Media file with chapters created. M4A cannot carry the source streams, so they were re-encoded to AAC.', { timeout: 150_000 });
		await expect(status).toHaveAttribute('data-state', 'success');
		await expect(media).toBeVisible();
		await expect(media).toHaveAttribute('download', 'episode-chapters.m4a');

		const m4a = await inspectDownload(media);
		expect(m4a.type).toBe('audio/mp4');
		expect(m4a.byteLength).toBeGreaterThan(2000);
		const m4aBytes = await downloadText(media);
		/* An ISO base media file, and the sample entry says AAC rather than the PCM that went in. */
		expect(m4aBytes.slice(4, 8)).toBe('ftyp');
		const entry = await mp4SampleEntry(media);
		expect(entry.codec).toBe('mp4a');
		expect(entry.sampleRate).toBe(44_100);
		expect(m4aBytes).toContain('Intro');
		expect(m4aBytes).toContain('Chorus');
		/* -map_metadata has to point at the media, not at the chapter file, on the re-encoding route too. */
		expect(m4aBytes).toContain('Episode 12');

		/* Same source, different container: MP3 has to arrive as an MP3, chapters and all. */
		await tool.locator('[data-output]').selectOption('mp3');
		await tool.locator('[data-mux]').click();
		await expect(status).toHaveText('Media file with chapters created. MP3 cannot carry the source streams, so they were re-encoded to MP3.', { timeout: 150_000 });
		await expect(media).toHaveAttribute('download', 'episode-chapters.mp3');

		const mp3 = await inspectDownload(media);
		expect(mp3.type).toBe('audio/mpeg');
		/* "ID3" plus the tag version byte: the MP3 muxer always writes an ID3v2 header. */
		expect(mp3.magic).toMatch(/^494433/);
		expect(mp3.byteLength).toBeGreaterThan(10_000);
		const mp3Bytes = await downloadText(media);
		/* Chapters survive as ID3v2 CHAP frames, which is where an MP3 keeps them. */
		expect(mp3Bytes).toContain('CHAP');
		expect(mp3Bytes).toContain('Intro');
		expect(mp3Bytes).toContain('Chorus');
		expect(errors).toEqual([]);
	});

	test('Podcast Chapter Editor re-encodes a WebM source into the MP4 it was asked for', async ({ page }) => {
		test.setTimeout(180_000);
		await cacheCdnAssets(page);
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/podcast-chapter-editor/');
		const tool = page.locator('[data-chapterizer]');
		const media = tool.locator('[data-media]');

		/* VP8 has no home in an MP4, so the picture has to be re-encoded rather than the container swapped. */
		await tool.locator('[data-file]').setInputFiles(fixtureUpload('tiny-clip.webm', 'video/webm'));
		await expect(tool.locator('[data-file-name]')).toHaveText('tiny-clip.webm');
		await expect(tool.locator('[data-output]')).toHaveValue('mkv');
		await tool.locator('[data-output]').selectOption('mp4');
		await tool.locator('[data-chapters]').fill('00:00 Intro\n00:00.400 Chorus');
		await expect(tool.locator('[data-status]')).toHaveText('2 chapters detected.');

		await tool.locator('[data-mux]').click();
		/* The clip's duration may never reach the player, so only the route is asserted here. */
		await expect(tool.locator('[data-status]'))
			.toContainText('MP4 cannot carry the source streams, so they were re-encoded to H.264 + AAC.', { timeout: 150_000 });
		await expect(tool.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await expect(media).toHaveAttribute('download', 'tiny-clip-chapters.mp4');

		const mp4 = await inspectDownload(media);
		expect(mp4.type).toBe('video/mp4');
		expect(mp4.byteLength).toBeGreaterThan(1000);
		const bytes = await downloadText(media);
		expect(bytes.slice(4, 8)).toBe('ftyp');

		/* The picture is really H.264 now, and it is still the fixture's 160x120 frame. */
		const entry = await mp4SampleEntry(media);
		expect(entry.codec).toBe('avc1');
		expect(entry.width).toBe(160);
		expect(entry.height).toBe(120);
		expect(bytes).toContain('Intro');
		expect(bytes).toContain('Chorus');
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

		await tool.locator('[data-file]').setInputFiles(createWavFixture({ name: 'master.wav', seconds: 1, noise: true }));
		for (const value of ['mp3-v0', 'mp3-v3', 'mp3-v6']) {
			await tool.locator(`[data-preset][value="${value}"]`).uncheck();
		}
		await tool.locator('[data-repeat-count]').fill('1');
		await expect(tool.locator('[data-total-trials-label]')).toHaveText('1');

		await tool.locator('[data-start]').click();
		await expect(tool.locator('[data-stage]')).toBeVisible({ timeout: 150_000 });
		/*
		 * An MP3 starts behind its source by the encoder's delay, and a blind test that does
		 * not correct for that measures timing rather than quality. Chromium turns out to
		 * strip it already: decodeAudioData honours libmp3lame's gapless header, and a
		 * measured 320 kbps encode of this fixture comes back with exactly as many samples as
		 * the source and a correlation peak at offset 0. So the honest report here is that
		 * nothing needed moving — and the tool has to say that rather than claim a
		 * compensation it never applied. estimateAlignmentOffset and shiftSamples are proven
		 * on known offsets in tests/audio-tool-helpers.test.js.
		 */
		await expect(tool.locator('[data-status]')).toContainText('No measurable encoder delay was found, so the samples play unchanged.');
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
