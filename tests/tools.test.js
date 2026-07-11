import test from 'node:test';
import assert from 'node:assert/strict';

import {
	chanceProbability,
	combination,
	createTrials,
	fileExtension,
	formatProbability,
	formatTime,
} from '../src/lib/tools/abx-tester.js';
import {
	DOCUMENT_OUTPUT_PROFILES,
	buildOutputName as buildDocumentOutputName,
	buildPandocOptions,
	detectInputFormat,
	isBinaryInput,
} from '../src/lib/tools/document-converter.js';
import { formatBytes, formatTemplate } from '../src/lib/tools/format.js';
import {
	buildConversionArgs,
	buildOutputName as buildMediaOutputName,
	detectMediaKind,
	filterProfilesForMediaKind,
	getFileExtension,
	inputExtension,
} from '../src/lib/tools/video-audio-converter.js';
import { buildPodcastCleanerArgs, outputFormat } from '../src/lib/tools/podcast-cleaner.js';
import { buildLosslessArgs, containerMime } from '../src/lib/tools/lossless-media-surgeon.js';
import {
	buildMasteringArgs,
	buildOutputInfo,
	selectAudioArgs,
	selectAudioCodec,
	selectOutputProfile,
} from '../src/lib/tools/loudness-mastering.js';
import {
	formatTime as formatSubtitleTime,
	offsetCues,
	parseCues,
	parseTime,
	toSrt,
	toVtt,
} from '../src/lib/tools/offline-subtitle-studio.js';
import {
	assTimestamp,
	buildSubtitleAss,
	subtitleBurnerArgs,
	subtitleOutputName,
} from '../src/lib/tools/subtitle-burner.js';
import {
	mixAndResampleAudio,
	parseWhisperLog,
	renderWhisperSubtitles,
	whisperSubtitleOutputName,
} from '../src/lib/tools/whisper-subtitle-generator.js';
import {
	buildGifArgs,
	buildGifFilter,
	normalizeGifSettings,
} from '../src/lib/tools/video-to-gif-converter.js';
import {
	createOutputName as createImageOutputName,
	fileExtension as imageFileExtension,
	formatFrames,
} from '../src/lib/tools/image-format-converter.js';
import {
	buildScrubMediaArgs,
	imageExtension,
	mediaContainerMime,
} from '../src/lib/tools/metadata-privacy-scrubber.js';
import {
	formatBitRate,
	formatBytes as formatMediaInfoBytes,
	formatDuration as formatMediaInfoDuration,
	formatFrameRate,
	formatNumericBytes,
	formatResolution,
	formatSamplingRate,
	normalizeResult,
	trimNumber,
} from '../src/lib/tools/media-info.js';

const profiles = [
	{ value: 'wav', label: 'WAV', extension: '.wav', mimeType: 'audio/wav', kind: 'audio', codec: 'pcm_s16le', args: ['-ar', '48000'] },
	{ value: 'mp4', label: 'MP4', extension: '.mp4', mimeType: 'video/mp4', kind: 'video', codec: 'copy', audioCodec: 'aac', audioArgs: ['-b:a', '192k'] },
	{ value: 'webm', label: 'WebM', extension: '.webm', mimeType: 'video/webm', kind: 'video', codec: 'copy', audioCodec: 'libopus', audioArgs: ['-b:a', '192k', '-ar', '48000'] },
];

test('shared formatting helpers keep compact UI-friendly labels', () => {
	assert.equal(formatTemplate('Selected {name}: {size}', { name: 'clip.wav', size: '1 MB' }), 'Selected clip.wav: 1 MB');
	assert.equal(formatTemplate('Missing {value}', {}), 'Missing ');
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(999), '999 B');
	assert.equal(formatBytes(1024), '1.0 KB');
	assert.equal(formatBytes(12 * 1024), '12 KB');
	assert.equal(formatBytes(3 * 1024 ** 2), '3.0 MB');
});

test('video/audio converter detects media type from mime type and extension', () => {
	assert.equal(detectMediaKind({ name: 'mix.WAV', type: '' }), 'audio');
	assert.equal(detectMediaKind({ name: 'camera.mov', type: '' }), 'video');
	assert.equal(detectMediaKind({ name: 'upload.bin', type: 'audio/mpeg' }), 'audio');
	assert.equal(detectMediaKind({ name: 'upload.bin', type: 'video/mp4' }), 'video');
	assert.equal(detectMediaKind({ name: 'notes.txt', type: '' }), 'unknown');
	assert.equal(getFileExtension('archive.TAR.GZ'), 'gz');
});

test('video/audio converter filters profiles based on source media type', () => {
	assert.deepEqual(filterProfilesForMediaKind(profiles, 'audio').map((profile) => profile.value), ['wav']);
	assert.deepEqual(filterProfilesForMediaKind(profiles, 'video').map((profile) => profile.value), ['wav', 'mp4', 'webm']);
	assert.deepEqual(filterProfilesForMediaKind(profiles, 'unknown').map((profile) => profile.value), ['wav', 'mp4', 'webm']);
});

test('video/audio converter builds ffmpeg args for audio extraction and remuxing', () => {
	assert.deepEqual(
		buildConversionArgs('input.bin', 'output.wav', { name: 'source.mp3', type: 'audio/mpeg' }, profiles[0]),
		['-i', 'input.bin', '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', '-y', 'output.wav'],
	);
	assert.deepEqual(
		buildConversionArgs('input.bin', 'output.wav', { name: 'source.mp4', type: 'video/mp4' }, profiles[0]),
		['-i', 'input.bin', '-vn', '-map', '0:a:0?', '-c:a', 'pcm_s16le', '-ar', '48000', '-y', 'output.wav'],
	);
	assert.deepEqual(
		buildConversionArgs('input.bin', 'output.mp4', { name: 'source.mov', type: 'video/quicktime' }, profiles[1]),
		['-i', 'input.bin', '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-y', 'output.mp4'],
	);
	assert.equal(buildMediaOutputName('cut.final.mp4', '.wav'), 'cut.final.wav');
	assert.equal(buildMediaOutputName('', '.mp3'), 'converted-media.mp3');
	assert.equal(inputExtension({ name: 'clip.mp4' }), '.bin');
});

test('document converter maps source files to pandoc input formats', () => {
	assert.equal(detectInputFormat('README.md'), 'markdown');
	assert.equal(detectInputFormat('page.HTML'), 'html');
	assert.equal(detectInputFormat('notes.txt'), 'markdown');
	assert.equal(detectInputFormat('paper.tex'), 'latex');
	assert.equal(detectInputFormat('guide.adoc'), 'asciidoc');
	assert.equal(detectInputFormat('book.epub'), 'epub');
	assert.equal(detectInputFormat('unknown'), 'markdown');
});

test('document converter detects binary pandoc inputs and output names', () => {
	assert.equal(isBinaryInput({ type: '' }, 'docx'), true);
	assert.equal(isBinaryInput({ type: 'application/epub+zip' }, 'markdown'), true);
	assert.equal(isBinaryInput({ type: 'text/markdown' }, 'markdown'), false);
	assert.equal(buildDocumentOutputName('draft.v2.md', '.html'), 'draft.v2.html');
	assert.equal(buildDocumentOutputName('', '.txt'), 'converted-document.txt');
	assert.deepEqual(DOCUMENT_OUTPUT_PROFILES.map((profile) => profile.value), [
		'html', 'markdown', 'plain', 'pdf', 'docx', 'odt', 'epub', 'latex', 'rtf',
	]);
	assert.deepEqual(buildPandocOptions(DOCUMENT_OUTPUT_PROFILES.find((profile) => profile.value === 'docx'), 'output.docx'), {
		to: 'docx',
		'output-file': 'output.docx',
	});
	assert.deepEqual(buildPandocOptions(DOCUMENT_OUTPUT_PROFILES.find((profile) => profile.value === 'latex'), 'output.tex'), { to: 'latex' });
});

test('subtitle burner creates ASS styles and FFmpeg burn-in arguments', () => {
	const ass = buildSubtitleAss([{ start: 1, end: 3, text: 'Hello world' }], { mode: 'karaoke', fontSize: 64, alignment: 8, marginV: 120 });
	assert.match(ass, /Style: Default,Arial,64/);
	assert.match(ass, /,8,70,70,120,1/);
	assert.match(ass, /Dialogue: 0,0:00:01.00,0:00:03.00/);
	assert.match(ass, /\{\\k100\}Hello \{\\k100\}world/);
	assert.equal(assTimestamp(3661.25), '1:01:01.25');
	assert.equal(subtitleOutputName('clip.final.mov'), 'clip.final-subtitled.mp4');
	assert.deepEqual(subtitleBurnerArgs('input.mov', 'captions.ass', 'output.mp4'), [
		'-i', 'input.mov', '-vf', 'subtitles=captions.ass', '-map', '0:v:0?', '-map', '0:a:0?',
		'-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', 'output.mp4',
	]);
});

test('whisper subtitle generator parses logs and renders downloadable subtitle formats', () => {
	const logs = [
		'system_info: n_threads = 8',
		'[00:00:01.250 --> 00:00:03.500]   Hello world',
		'[00:00:03.500 --> 00:00:05.000]   Second line',
	];
	assert.deepEqual(parseWhisperLog(logs), [
		{ start: 1.25, end: 3.5, text: 'Hello world' },
		{ start: 3.5, end: 5, text: 'Second line' },
	]);
	assert.match(renderWhisperSubtitles(logs, 'srt'), /00:00:01,250 --> 00:00:03,500/);
	assert.match(renderWhisperSubtitles(logs, 'vtt'), /^WEBVTT/);
	assert.equal(whisperSubtitleOutputName('interview.final.mp4', 'vtt'), 'interview.final.vtt');
});

test('whisper subtitle generator mixes channels and resamples to 16 kHz', () => {
	const result = mixAndResampleAudio([
		Float32Array.from([0, 1, 0, -1]),
		Float32Array.from([0, 0, 0, 0]),
	], 4, 2);
	assert.deepEqual(Array.from(result), [0, 0]);
});

test('abx helpers produce deterministic trials and statistics', () => {
	const randomValues = [0.1, 0.7, 0.49, 0.5];
	const trials = createTrials(4, () => randomValues.shift());
	assert.deepEqual(trials, [{ xIs: 'A' }, { xIs: 'B' }, { xIs: 'A' }, { xIs: 'B' }]);
	assert.equal(combination(8, 2), 28);
	assert.equal(chanceProbability(8, 8), 1 / 256);
	assert.equal(chanceProbability(0, 8), 1);
	assert.equal(formatProbability(0.05), '<0.1');
	assert.equal(formatProbability(12.345), '12.3');
	assert.equal(formatProbability(2.345), '2.35');
	assert.equal(formatTime(65.9), '1:05');
	assert.equal(fileExtension('SONG.FLAC'), '.flac');
	assert.equal(fileExtension('no-extension'), '.audio');
});

test('podcast cleaner builds selected ffmpeg filter chains and output formats', () => {
	const info = outputFormat('m4a');
	assert.deepEqual(info, { extension: 'm4a', mime: 'audio/mp4', args: ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] });
	assert.deepEqual(
		buildPodcastCleanerArgs('in.wav', 'out.mp3', outputFormat('mp3'), {
			highpass: true,
			highpassFreq: 90,
			lowpass: true,
			denoise: true,
			silence: true,
			silenceThreshold: -42,
			compress: true,
			loudness: true,
		}),
		[
			'-i', 'in.wav', '-map', '0:a:0', '-vn',
			'-af', 'highpass=f=90,lowpass=f=14500,afftdn=nf=-25,silenceremove=start_periods=1:start_duration=0.25:start_threshold=-42dB:stop_periods=-1:stop_duration=0.7:stop_threshold=-42dB,acompressor=threshold=-18dB:ratio=3:attack=12:release=180:makeup=2,loudnorm=I=-16:TP=-1.5:LRA=11',
			'-c:a', 'libmp3lame', '-b:a', '160k', '-y', 'out.mp3',
		],
	);
});

test('lossless media surgeon builds remux, trim, extract, mute, and replace args', () => {
	assert.deepEqual(buildLosslessArgs('in.mkv', null, 'out.mp4', { operation: 'remux', container: 'mp4' }), ['-i', 'in.mkv', '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', 'out.mp4']);
	assert.deepEqual(buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'trim', container: 'mkv', start: '1.5', end: '5' }), ['-ss', '1.5', '-i', 'in.mkv', '-t', '3.5', '-map', '0', '-c', 'copy', '-y', 'out.mkv']);
	assert.throws(() => buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'trim', start: '5', end: '2' }), /End time/);
	assert.deepEqual(buildLosslessArgs('in.mkv', null, 'out.mka', { operation: 'extract', container: 'mka' }), ['-i', 'in.mkv', '-map', '0:a:0', '-vn', '-c:a', 'copy', '-y', 'out.mka']);
	assert.deepEqual(buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'mute' }), ['-i', 'in.mkv', '-map', '0:v?', '-map', '0:s?', '-c', 'copy', '-y', 'out.mkv']);
	assert.deepEqual(buildLosslessArgs('in.mkv', 'audio.wav', 'out.mkv', { operation: 'replace' }), ['-i', 'in.mkv', '-i', 'audio.wav', '-map', '0:v?', '-map', '1:a:0', '-map', '0:s?', '-c', 'copy', '-shortest', '-y', 'out.mkv']);
	assert.equal(containerMime('webm'), 'video/webm');
});

test('loudness mastering keeps compatible output profiles and audio codecs', () => {
	assert.deepEqual(selectOutputProfile({ type: 'audio/flac' }), { extension: '.flac', displayName: 'FLAC', mimeType: 'audio/flac' });
	assert.deepEqual(selectOutputProfile({ type: '' }, 'video'), { extension: '.mp4', displayName: 'MP4', mimeType: 'video/mp4' });
	assert.equal(selectAudioCodec({ type: 'audio/wav' }), 'pcm_s16le');
	assert.equal(selectAudioCodec({ type: 'video/webm' }, true), 'libopus');
	assert.deepEqual(selectAudioArgs('libopus'), ['-b:a', '192k', '-ar', '48000']);
	assert.deepEqual(buildOutputInfo({ name: 'mix.final.wav', type: 'audio/wav' }), {
		fileName: 'mix.final-mastered.wav',
		extension: '.wav',
		displayName: 'WAV',
		mimeType: 'audio/wav',
	});
	assert.deepEqual(
		buildMasteringArgs('input.bin', 'output.mp4', { type: 'video/mp4' }),
		['-i', 'input.bin', '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-y', 'output.mp4'],
	);
});

test('subtitle studio parses, offsets, and renders srt and vtt cues', () => {
	const source = `1
00:00:01,000 --> 00:00:02,250
Hello

2
00:00:03,000 --> 00:00:04,000
World`;
	const cues = parseCues(source, 'srt');
	assert.deepEqual(cues, [
		{ start: 1, end: 2.25, text: 'Hello' },
		{ start: 3, end: 4, text: 'World' },
	]);
	assert.equal(parseTime('01:02:03.400'), 3723.4);
	assert.equal(formatSubtitleTime(2.345, ','), '00:00:02,345');
	assert.deepEqual(offsetCues(cues, -1), [
		{ start: 0, end: 1.25, text: 'Hello' },
		{ start: 2, end: 3, text: 'World' },
	]);
	assert.equal(toSrt([{ start: 0, end: 1.25, text: 'Hello' }]), '1\n00:00:00,000 --> 00:00:01,250\nHello\n');
	assert.equal(toVtt([{ start: 0, end: 1.25, text: 'Hello' }]), 'WEBVTT\n\n00:00:00.000 --> 00:00:01.250\nHello\n');
});

test('video-to-gif converter clamps settings and builds palette ffmpeg args', () => {
	const settings = normalizeGifSettings({ start: 99, duration: 99, fps: 60, width: 1200, colors: 999, loop: true }, 10);
	assert.deepEqual(settings, { start: 9.5, duration: 0.5, fps: 24, width: 960, colors: 256, loop: true });
	assert.equal(buildGifFilter({ fps: 12, width: 480, colors: 64 }), 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64:reserve_transparent=0[p];[s1][p]paletteuse=dither=sierra2_4a');
	assert.deepEqual(buildGifArgs('in.mp4', 'out.gif', { start: 1, duration: 2, fps: 12, width: 480, colors: 64, loop: false }), [
		'-ss', '1', '-t', '2', '-i', 'in.mp4',
		'-filter_complex', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=64:reserve_transparent=0[p];[s1][p]paletteuse=dither=sierra2_4a',
		'-loop', '-1', '-gifflags', '+transdiff', '-y', 'out.gif',
	]);
});

test('image converter and metadata scrubber helpers preserve output naming and stripping args', () => {
	assert.equal(createImageOutputName('poster.final.png', 'webp'), 'poster.final.webp');
	assert.equal(createImageOutputName('', 'png'), 'converted-image.png');
	assert.equal(imageFileExtension('PHOTO.JPEG'), '.jpeg');
	assert.equal(formatFrames(1, { singleFrame: 'single', multipleFrames: '{count} frames' }), 'single');
	assert.equal(formatFrames(7, { singleFrame: 'single', multipleFrames: '{count} frames' }), '7 frames');
	assert.equal(imageExtension('image/jpeg'), 'jpg');
	assert.equal(mediaContainerMime('mov'), 'video/quicktime');
	assert.deepEqual(buildScrubMediaArgs('in.mov', 'out.mp4', 'mp4'), ['-i', 'in.mov', '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', '-y', 'out.mp4']);
});

test('media info formatting helpers normalize analysis output for display', () => {
	assert.deepEqual(normalizeResult('{"media":{"track":[]}}'), { media: { track: [] } });
	assert.deepEqual(normalizeResult(null), { media: { track: [] } });
	assert.equal(formatResolution({ Width: 1920, Height: 1080 }), '1920 x 1080');
	assert.equal(formatMediaInfoDuration(65.25), '1:05.250');
	assert.equal(formatMediaInfoDuration(3661), '1:01:01');
	assert.equal(formatBitRate(2500000), '2.5 Mb/s');
	assert.equal(formatBitRate(192000), '192 kb/s');
	assert.equal(formatFrameRate(29.97003), '30 fps');
	assert.equal(formatSamplingRate(48000), '48 kHz');
	assert.equal(formatNumericBytes(1536), '1.5 KB');
	assert.equal(formatMediaInfoBytes(5 * 1024 ** 4), '5 TB');
	assert.equal(trimNumber(12.345), '12.3');
});
