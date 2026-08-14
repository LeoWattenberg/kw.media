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
	buildPandocInputOptions,
	buildPandocOptions,
	createTextPdf,
	detectInputFormat,
	isBinaryInput,
} from '../src/lib/tools/document-converter.js';
import { formatBytes, formatTemplate } from '../src/lib/tools/format.js';
import {
	buildConversionArgs,
	buildConversionAttempts,
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
	detectMediaKind as detectMasteringMediaKind,
	getBaseName,
	inputExtension as masteringInputExtension,
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
	softSubtitleArgs,
	subtitleStudioMime,
	subtitleStudioOutputName,
} from '../src/lib/tools/subtitle-studio.js';
import {
	mixAndResampleAudio,
	parseWhisperLog,
	renderWhisperSubtitles,
	whisperSubtitleOutputName,
} from '../src/lib/tools/whisper-subtitle-generator.js';
import {
	buildGifArgs,
	buildGifFilter,
	clamp,
	formatTime as formatGifTime,
	normalizeGifSettings,
	roundToHalf,
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
	metadataOutputProfile,
} from '../src/lib/tools/metadata-privacy-scrubber.js';
import {
	formatBitRate,
	formatBytes as formatMediaInfoBytes,
	formatChannels,
	formatDuration as formatMediaInfoDuration,
	formatFrameRate,
	formatNumericBytes,
	formatResolution,
	formatSamplingRate,
	normalizeResult,
	trimNumber,
} from '../src/lib/tools/media-info.js';
import { getMediaInfoFactory } from '../src/lib/tools/media-info-browser.js';
import {
	buildCommitGrid,
	buildCommitSnapshot,
	buildHeatScale,
	clipScale,
	commitCell,
	commitStatsBySha,
	commitStatsUrl,
	commitsApiUrl,
	dayKey,
	dayKeysEndingAt,
	fetchCommitStats,
	fetchCommitWindow,
	filterCommits,
	formatAge,
	formatDayLabel,
	formatHourRange,
	formatLineCount,
	formatSignedLines,
	heatLevel,
	isWeekend,
	mergeCommitStats,
	normalizeCommitStats,
	normalizeCommits,
	parseCommitSnapshot,
	parseIsoParts,
	parseLastPage,
	roundUpToTick,
	snapshotIsEquivalent,
	summarizeGrid,
	windowStartIso,
} from '../src/lib/tools/commit-graph.js';
import {
	amplitudeToDbfs,
	analyzeLevels,
	averageSpectrum,
	createSpectrogram,
	downmixChannels,
	formatAnalyzerTime,
	meanSquare,
	normalizeSelection,
	peakAmplitude,
	roseusColor,
} from '../src/lib/tools/audio-analyzer.js';

const profiles = [
	{ value: 'wav', label: 'WAV', extension: '.wav', mimeType: 'audio/wav', kind: 'audio', codec: 'pcm_s16le', args: ['-ar', '48000'] },
	{ value: 'mp4', label: 'MP4', extension: '.mp4', mimeType: 'video/mp4', kind: 'video', codec: 'libx264', videoArgs: ['-crf', '23'], audioCodec: 'aac', audioArgs: ['-b:a', '192k'] },
	{ value: 'webm', label: 'WebM', extension: '.webm', mimeType: 'video/webm', kind: 'video', codec: 'libvpx', videoArgs: ['-deadline', 'realtime'], audioCodec: 'libopus', audioArgs: ['-b:a', '160k', '-ar', '48000'] },
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

test('audio analyzer calculates deterministic sample levels and selections', () => {
	const samples = Float32Array.from([0.5, -0.5, 0.25, -0.25]);
	assert.equal(peakAmplitude(samples), 0.5);
	assert.equal(meanSquare(samples), 0.15625);
	assert.equal(amplitudeToDbfs(0.5).toFixed(3), '-6.021');
	assert.equal(formatAnalyzerTime(65.4321), '1:05.432');
	assert.deepEqual(normalizeSelection({ startTime: 8, endTime: 2, lowFrequency: 9000, highFrequency: 1000 }, 6, 8000), {
		startTime: 2,
		endTime: 6,
		lowFrequency: 1000,
		highFrequency: 8000,
	});
	assert.deepEqual(Array.from(downmixChannels([Float32Array.from([1, -1]), Float32Array.from([-1, 1])])), [0, 0]);
});

test('audio analyzer creates Roseus spectrograms, spectra, and loudness values', () => {
	const sampleRate = 8192;
	const samples = Float32Array.from({ length: sampleRate }, (_, index) => 0.5 * Math.sin(2 * Math.PI * 1024 * index / sampleRate));
	const levels = analyzeLevels(samples, sampleRate);
	assert.ok(Math.abs(levels.peakDbfs + 6.0206) < 0.01);
	assert.ok(Math.abs(levels.rmsDbfs + 9.0309) < 0.01);
	assert.ok(Number.isFinite(levels.momentaryLufs));
	assert.ok(Number.isFinite(levels.shortTermLufs));
	assert.ok(Number.isFinite(levels.integratedLufs));

	const spectrogram = createSpectrogram(samples, sampleRate, { fftSize: 256, maxFrames: 12 });
	assert.equal(spectrogram.frames.length, 12);
	assert.equal(spectrogram.frames[0].length, 128);
	const spectrum = averageSpectrum(samples, sampleRate, { fftSize: 1024, maxFrames: 4, lowFrequency: 500, highFrequency: 1500 });
	const strongest = spectrum.reduce((best, point) => point.db > best.db ? point : best);
	assert.ok(Math.abs(strongest.frequency - 1024) <= 8);
	assert.deepEqual(roseusColor(0), [0, 0, 0]);
	assert.deepEqual(roseusColor(1), [255, 255, 255]);
});

test('video/audio converter detects media type from mime type and extension', () => {
	assert.equal(detectMediaKind({ name: 'mix.WAV', type: '' }), 'audio');
	assert.equal(detectMediaKind({ name: 'camera.mov', type: '' }), 'video');
	assert.equal(detectMediaKind({ name: 'upload.bin', type: 'audio/mpeg' }), 'audio');
	assert.equal(detectMediaKind({ name: 'upload.bin', type: 'video/mp4' }), 'video');
	assert.equal(detectMediaKind({ name: 'notes.txt', type: '' }), 'unknown');
	assert.equal(getFileExtension('archive.TAR.GZ'), 'gz');
	assert.equal(detectMediaKind(null), 'unknown');
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
		['-i', 'input.bin', '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', 'output.mp4'],
	);
	assert.deepEqual(
		buildConversionArgs('input.mp4', 'output.webm', { name: 'source.mp4', type: 'video/mp4' }, profiles[2]),
		['-i', 'input.mp4', '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus', '-b:a', '160k', '-ar', '48000', '-y', 'output.webm'],
	);
	assert.deepEqual(
		buildConversionAttempts('input.mp4', 'output.webm', { name: 'source.mp4', type: 'video/mp4' }, profiles[2]),
		[
			['-i', 'input.mp4', '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'libopus', '-b:a', '160k', '-ar', '48000', '-y', 'output.webm'],
			['-i', 'input.mp4', '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libvpx', '-deadline', 'realtime', '-c:a', 'libopus', '-b:a', '160k', '-ar', '48000', '-y', 'output.webm'],
		],
	);
	assert.equal(buildMediaOutputName('cut.final.mp4', '.wav'), 'cut.final.wav');
	assert.equal(buildMediaOutputName('', '.mp3'), 'converted-media.mp3');
	assert.equal(inputExtension({ name: 'clip.mp4' }), '.mp4');
	assert.equal(inputExtension({ name: 'clip' }), '.bin');
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
	assert.deepEqual(buildPandocInputOptions('odt', 'legal document.odt'), { 'input-files': ['legal document.odt'] });
	assert.deepEqual(buildPandocInputOptions('markdown', 'README.md'), {});
	assert.ok(createTextPdf(Array.from({ length: 200 }, (_, index) => `Line ${index}`).join('\n')).size > 1000);
});

test('subtitle burner creates ASS styles and FFmpeg burn-in arguments', () => {
	const ass = buildSubtitleAss([{ start: 1, end: 3, text: 'Hello world' }], { mode: 'karaoke', fontSize: 64, alignment: 8, marginV: 120 });
	assert.match(ass, /Style: Default,Arial,64/);
	assert.match(ass, /,8,70,70,120,1/);
	assert.match(ass, /Dialogue: 0,0:00:01.00,0:00:03.00/);
	assert.match(ass, /\{\\k100\}Hello \{\\k100\}world/);
	assert.match(buildSubtitleAss([{ start: 0, end: 2, text: 'One two' }], { mode: 'single' }), /Dialogue: 0,0:00:00\.00,0:00:01\.00.*One/);
	assert.match(buildSubtitleAss([{ start: 0, end: 1, text: 'A\\B\n\{C\}' }], { fontSize: 'bad', marginV: 'bad' }), /A\\\\B\\N\\\{C\\\}/);
	assert.doesNotMatch(buildSubtitleAss([{ start: 0, end: 1, text: '' }]), /Dialogue:/);
	assert.equal(assTimestamp(3661.25), '1:01:01.25');
	assert.equal(subtitleOutputName('clip.final.mov'), 'clip.final-subtitled.mp4');
	assert.deepEqual(subtitleBurnerArgs('input.mov', 'captions.ass', 'output.mp4'), [
		'-i', 'input.mov', '-vf', 'subtitles=captions.ass', '-map', '0:v:0?', '-map', '0:a:0?',
		'-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-y', 'output.mp4',
	]);
});

test('subtitle studio builds soft-subtitle outputs and names both application modes', () => {
	assert.deepEqual(softSubtitleArgs('input.mov', 'captions.srt', 'output.mp4', 'mp4'), [
		'-i', 'input.mov', '-i', 'captions.srt', '-map', '0', '-map', '1:0', '-c', 'copy',
		'-c:s', 'mov_text', '-movflags', '+faststart', '-metadata:s:s:0', 'language=und', '-y', 'output.mp4',
	]);
	assert.deepEqual(softSubtitleArgs('input.mov', 'captions.srt', 'output.mkv'), [
		'-i', 'input.mov', '-i', 'captions.srt', '-map', '0', '-map', '1:0', '-c', 'copy', '-c:s', 'srt', '-metadata:s:s:0', 'language=und', '-y', 'output.mkv',
	]);
	assert.equal(subtitleStudioOutputName('clip.final.mov', 'soft', 'mkv'), 'clip.final-soft-subtitles.mkv');
	assert.equal(subtitleStudioOutputName('clip.final.mov', 'hard'), 'clip.final-hard-subtitles.mp4');
	assert.equal(subtitleStudioMime('soft', 'mkv'), 'video/x-matroska');
	assert.equal(subtitleStudioMime('hard'), 'video/mp4');
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
	assert.deepEqual(Array.from(mixAndResampleAudio([], 48000)), []);
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
	assert.equal(combination(2, 3), 0);
	assert.equal(formatTime(Number.NaN), '0:00');
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
	assert.equal(masteringInputExtension(), '.bin');
	assert.equal(getBaseName('mix.final.wav'), 'mix.final');
	assert.equal(detectMasteringMediaKind({ type: 'video/mp4' }), 'video');
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
	assert.deepEqual(buildMasteringArgs('input.bin', 'output.mp3', { type: 'audio/mpeg' }), [
		'-i', 'input.bin', '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', 'output.mp3',
	]);
	assert.deepEqual(selectAudioArgs('unknown'), []);
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
	assert.equal(clamp(Number.NaN, 2, 4), 2);
	assert.equal(roundToHalf(2.3), 2.5);
	assert.equal(formatGifTime(65.4), '1:05');
});

test('image converter and metadata scrubber helpers preserve output naming and stripping args', () => {
	assert.equal(createImageOutputName('poster.final.png', 'webp'), 'poster.final.webp');
	assert.equal(createImageOutputName('', 'png'), 'converted-image.png');
	assert.equal(imageFileExtension('PHOTO.JPEG'), '.jpeg');
	assert.equal(formatFrames(1, { singleFrame: 'single', multipleFrames: '{count} frames' }), 'single');
	assert.equal(formatFrames(7, { singleFrame: 'single', multipleFrames: '{count} frames' }), '7 frames');
	assert.equal(imageExtension('image/jpeg'), 'jpg');
	assert.equal(mediaContainerMime('mov'), 'video/quicktime');
	assert.deepEqual(metadataOutputProfile({ name: 'clip.webm', type: 'video/webm' }), { isImage: false, extension: 'webm', mimeType: 'video/webm' });
	assert.deepEqual(metadataOutputProfile({ name: 'photo.jpeg', type: 'image/jpeg' }), { isImage: true, extension: 'jpg', mimeType: 'image/jpeg' });
	assert.deepEqual(metadataOutputProfile({ name: 'recording', type: 'audio/mpeg' }), { isImage: false, extension: 'mp3', mimeType: 'audio/mpeg' });
	assert.deepEqual(metadataOutputProfile({ name: 'unknown', type: '' }), { isImage: false, extension: 'bin', mimeType: 'application/octet-stream' });
	assert.deepEqual(buildScrubMediaArgs('in.mov', 'out.mp4', 'mp4'), ['-i', 'in.mov', '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', '-y', 'out.mp4']);
});

test('commit graph reads GitHub timestamps in commit and viewer time zones', () => {
	assert.deepEqual(parseIsoParts('2026-08-13T21:27:05Z'), { year: 2026, month: 8, day: 13, hour: 21, minute: 27, second: 5, offsetMinutes: 0 });
	assert.equal(parseIsoParts('2026-08-13T21:27:05+02:00').offsetMinutes, 120);
	assert.equal(parseIsoParts('2026-08-13T21:27:05-0530').offsetMinutes, -330);
	assert.equal(parseIsoParts('not a date'), null);
	assert.deepEqual(commitCell('2026-08-13T21:27:05+02:00'), { dayKey: '2026-08-13', hour: 21 });
	assert.equal(commitCell('nope', 'commit'), null);
	assert.equal(commitCell('nope', 'viewer'), null);

	const viewerReference = new Date('2026-08-13T21:27:05+02:00');
	assert.deepEqual(commitCell('2026-08-13T21:27:05+02:00', 'viewer'), {
		dayKey: dayKey(viewerReference.getFullYear(), viewerReference.getMonth() + 1, viewerReference.getDate()),
		hour: viewerReference.getHours(),
	});
});

test('commit graph normalizes API payloads and skips merge commits on request', () => {
	const payload = [
		{ sha: 'abcdef1234567', commit: { author: { date: '2026-08-13T10:00:00Z' } }, parents: [{}] },
		{ sha: 'fedcba7654321', commit: { committer: { date: '2026-08-13T11:00:00Z' } }, parents: [{}, {}] },
		{ sha: 'nodatehere000', commit: {}, parents: [] },
	];
	const commits = normalizeCommits(payload);

	assert.deepEqual(commits, [
		{ sha: 'abcdef1', iso: '2026-08-13T10:00:00Z', isMerge: false },
		{ sha: 'fedcba7', iso: '2026-08-13T11:00:00Z', isMerge: true },
	]);
	assert.deepEqual(normalizeCommits(null), []);
	assert.equal(filterCommits(commits, { includeMerges: false }).length, 1);
	assert.equal(filterCommits(commits).length, 2);
});

test('commit graph builds a day-by-hour grid limited to the tracked window', () => {
	const commits = [
		{ iso: '2026-08-13T10:15:00Z' },
		{ iso: '2026-08-13T10:45:00Z' },
		{ iso: '2026-08-13T23:00:00Z' },
		{ iso: '2026-08-12T10:05:00Z' },
		{ iso: '2026-08-01T10:05:00Z' },
		{ iso: 'broken' },
	];
	const grid = buildCommitGrid(commits, { days: 3, endDayKey: '2026-08-13' });

	assert.deepEqual(grid.days.map((day) => day.dayKey), ['2026-08-11', '2026-08-12', '2026-08-13']);
	assert.deepEqual(grid.days.map((day) => day.total), [0, 1, 3]);
	assert.equal(grid.days[2].hours[10], 2);
	assert.equal(grid.days[2].hours[23], 1);
	assert.equal(grid.hours[10], 3);
	assert.equal(grid.total, 4);
	assert.equal(grid.skipped, 2);
	assert.equal(grid.maxHour, 3);
	assert.equal(grid.maxCell, 2);
	assert.deepEqual(dayKeysEndingAt('2026-03-01', 3), ['2026-02-27', '2026-02-28', '2026-03-01']);
	assert.deepEqual(dayKeysEndingAt('nope', 3), []);

	assert.deepEqual(summarizeGrid(grid), {
		total: 4,
		activeDays: 2,
		trackedDays: 3,
		busiestHour: 10,
		busiestHourTotal: 3,
		busiestDayKey: '2026-08-13',
		busiestDayTotal: 3,
		dailyAverage: 4 / 3,
		added: 0,
		removed: 0,
		net: 0,
		statCommits: 0,
		statMissing: 4,
		dailyAddedAverage: 0,
		dailyRemovedAverage: 0,
		peakDayKey: '2026-08-13',
		peakHour: 10,
		peakTotal: 2,
		peakLinesDayKey: '',
		peakLinesHour: 0,
		peakLinesTotal: 0,
	});
});

test('commit graph buckets added and removed lines per hour and reports partial coverage', () => {
	const commits = [
		{ sha: 'aaa', iso: '2026-08-13T10:15:00Z', additions: 40, deletions: 5 },
		{ sha: 'bbb', iso: '2026-08-13T10:45:00Z', additions: 2, deletions: 60 },
		{ sha: 'ccc', iso: '2026-08-13T23:00:00Z', additions: 7, deletions: 1 },
		{ sha: 'ddd', iso: '2026-08-12T10:05:00Z' },
	];
	const grid = buildCommitGrid(commits, { days: 2, endDayKey: '2026-08-13' });
	const [older, newest] = grid.days;

	assert.equal(newest.additions[10], 42);
	assert.equal(newest.deletions[10], 65);
	assert.equal(newest.additions[23], 7);
	assert.equal(grid.added, 49);
	assert.equal(grid.removed, 66);
	assert.deepEqual(grid.lineScale, { ceiling: 65, max: 65, clipped: 0, cells: 4 });
	assert.equal(grid.statCommits, 3);
	assert.deepEqual([older.added, older.removed], [0, 0]);
	assert.deepEqual([newest.added, newest.removed], [49, 66]);

	const summary = summarizeGrid(grid);
	assert.equal(summary.added, 49);
	assert.equal(summary.removed, 66);
	assert.equal(summary.net, -17);
	assert.equal(summary.statCommits, 3);
	assert.equal(summary.statMissing, 1);
	assert.equal(summary.dailyAddedAverage, 24.5);
	assert.equal(summary.dailyRemovedAverage, 33);
	assert.deepEqual([summary.peakLinesDayKey, summary.peakLinesHour, summary.peakLinesTotal], ['2026-08-13', 10, 107]);
	assert.deepEqual([summary.peakDayKey, summary.peakHour, summary.peakTotal], ['2026-08-13', 10, 2]);
});

test('commit graph clips the line axis only when one hour dwarfs the rest', () => {
	const ordinary = Array.from({ length: 100 }, (_, index) => index + 1);
	assert.deepEqual(clipScale(ordinary), { ceiling: 100, max: 100, clipped: 0, cells: 100 });

	/* p95 of 1…100 is 96, and the 40,000 outlier is far past three times that, so the axis cuts. */
	const spiked = clipScale([...ordinary, 40_000]);
	assert.equal(spiked.ceiling, 100);
	assert.equal(spiked.max, 40_000);
	assert.equal(spiked.clipped, 1);

	assert.deepEqual(clipScale([]), { ceiling: 0, max: 0, clipped: 0, cells: 0 });
	assert.deepEqual(clipScale(null), { ceiling: 0, max: 0, clipped: 0, cells: 0 });
	assert.deepEqual(clipScale([0, 0]), { ceiling: 0, max: 0, clipped: 0, cells: 0 });
	assert.equal(clipScale([5, 5, 5, 900]).clipped, 1);

	assert.equal(roundUpToTick(5881), 6000);
	assert.equal(roundUpToTick(17150), 20000);
	assert.equal(roundUpToTick(45), 45);
	assert.equal(roundUpToTick(41), 45);
	assert.equal(roundUpToTick(0), 0);
	assert.equal(roundUpToTick(-3), 0);
});

test('commit graph reads line counts from single-commit payloads and grafts them on by sha', () => {
	assert.deepEqual(normalizeCommitStats({ stats: { additions: 12, deletions: 3 } }), { additions: 12, deletions: 3 });
	assert.deepEqual(normalizeCommitStats({ stats: { additions: -4, deletions: 2 } }), { additions: 0, deletions: 2 });
	assert.equal(normalizeCommitStats({ stats: { additions: 12 } }), null);
	assert.equal(normalizeCommitStats(null), null);

	const known = commitStatsBySha([
		{ sha: 'aaa', iso: '2026-08-13T10:00:00Z', additions: 12, deletions: 3 },
		{ sha: 'bbb', iso: '2026-08-13T11:00:00Z' },
	]);
	assert.deepEqual([...known.keys()], ['aaa']);

	const merged = mergeCommitStats([
		{ sha: 'aaa', iso: '2026-08-13T10:00:00Z', isMerge: false },
		{ sha: 'bbb', iso: '2026-08-13T11:00:00Z', isMerge: false },
		{ sha: 'ccc', iso: '2026-08-13T12:00:00Z', isMerge: false, additions: 1, deletions: 1 },
	], known);
	assert.deepEqual(merged, [
		{ sha: 'aaa', iso: '2026-08-13T10:00:00Z', isMerge: false, additions: 12, deletions: 3 },
		{ sha: 'bbb', iso: '2026-08-13T11:00:00Z', isMerge: false },
		{ sha: 'ccc', iso: '2026-08-13T12:00:00Z', isMerge: false, additions: 1, deletions: 1 },
	]);
	assert.deepEqual(mergeCommitStats(null, known), []);
});

test('commit graph formats axis labels, heat levels, and weekends', () => {
	assert.equal(formatHourRange(23), '23:00–00:00');
	assert.equal(formatHourRange('bad'), '00:00–01:00');
	assert.equal(formatDayLabel('2026-08-13', 'en'), 'Thu 13 Aug');
	assert.equal(formatDayLabel('2026-08-13', 'de'), 'Do 13. Aug');
	assert.equal(formatDayLabel('nope', 'en'), '');
	assert.equal(formatLineCount(12345, 'en'), '12,345');
	assert.equal(formatLineCount(12345, 'de'), '12.345');
	assert.equal(formatLineCount('nope', 'en'), '0');
	assert.equal(formatSignedLines(1200, 'en'), '+1,200');
	assert.equal(formatSignedLines(-1200, 'de'), '−1.200');
	assert.equal(formatSignedLines(0, 'en'), '±0');
	assert.equal(isWeekend('2026-08-15'), true);
	assert.equal(isWeekend('2026-08-13'), false);
});

test('commit graph heat levels follow quantiles so one busy day cannot flatten the ramp', () => {
	const evenValues = Array.from({ length: 100 }, (_, index) => index + 1);
	const evenScale = buildHeatScale(evenValues);

	assert.deepEqual(evenScale, [21, 41, 61, 81]);
	assert.equal(heatLevel(0, evenScale), 0);
	assert.equal(heatLevel(1, evenScale), 1);
	assert.equal(heatLevel(21, evenScale), 1);
	assert.equal(heatLevel(22, evenScale), 2);
	assert.equal(heatLevel(81, evenScale), 4);
	assert.equal(heatLevel(100, evenScale), 5);

	// A single 300-commit day used to push every ordinary hour into the palest step.
	const skewedScale = buildHeatScale([...Array.from({ length: 40 }, () => 1), ...Array.from({ length: 10 }, () => 4), 300, 0, 0]);
	assert.deepEqual(skewedScale, [1, 1, 1, 4]);
	assert.equal(heatLevel(1, skewedScale), 1);
	assert.equal(heatLevel(4, skewedScale), 4);
	assert.equal(heatLevel(300, skewedScale), 5);

	assert.deepEqual(buildHeatScale([]), []);
	assert.deepEqual(buildHeatScale([0, 0]), []);
	assert.equal(heatLevel(3, []), 1);
	assert.equal(heatLevel(3, null), 1);
});

test('commit graph pages through the GitHub API and caps the request count', async () => {
	const requested = [];
	const page = (start) => Array.from({ length: 2 }, (_, index) => ({
		sha: `${start}${index}`.padEnd(7, '0'),
		commit: { author: { date: `2026-08-1${start}T0${index}:00:00Z` } },
		parents: [{}],
	}));
	const fetchImpl = async (url, options) => {
		requested.push({ url, headers: options.headers });
		const requestedPage = Number(new URL(url).searchParams.get('page'));
		return {
			ok: true,
			status: 200,
			headers: new Headers(requestedPage === 1
				? { link: '<https://api.github.com/repositories/1/commits?page=2>; rel="next", <https://api.github.com/repositories/1/commits?page=4>; rel="last"', 'x-ratelimit-remaining': '57', 'x-ratelimit-limit': '60' }
				: {}),
			json: async () => page(requestedPage),
		};
	};

	const progress = [];
	const result = await fetchCommitWindow({ sinceIso: '2026-07-14T00:00:00.000Z', fetchImpl, token: 'secret', maxPages: 3, onProgress: (entry) => progress.push(entry.loaded) });

	assert.equal(result.commits.length, 6);
	assert.equal(result.pages, 3);
	assert.equal(result.truncated, true);
	assert.deepEqual(result.rateLimit, { limit: 60, remaining: 57, resetMs: null });
	assert.deepEqual(requested.map(({ url }) => Number(new URL(url).searchParams.get('page'))).sort(), [1, 2, 3]);
	assert.equal(requested[0].headers.authorization, 'Bearer secret');
	assert.equal(new URL(requested[0].url).searchParams.get('since'), '2026-07-14T00:00:00.000Z');
	assert.deepEqual(progress.sort(), [1, 2, 3]);
	assert.equal(commitsApiUrl('owner/repo', { sinceIso: '2026-07-14T00:00:00.000Z', page: 2 }), 'https://api.github.com/repos/owner/repo/commits?since=2026-07-14T00%3A00%3A00.000Z&per_page=100&page=2');
	assert.equal(parseLastPage('<https://api.github.com/x?page=9>; rel="last"'), 9);
	assert.equal(parseLastPage(undefined), 1);
	assert.equal(windowStartIso(Date.UTC(2026, 7, 13), 30), '2026-07-13T00:00:00.000Z');
});

test('commit graph reports GitHub rate limiting as a recoverable error', async () => {
	const resetSeconds = Math.floor(Date.now() / 1000) + 600;
	const fetchImpl = async () => ({
		ok: false,
		status: 403,
		headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetSeconds) }),
		json: async () => ({}),
	});

	await assert.rejects(fetchCommitWindow({ fetchImpl }), (error) => {
		assert.equal(error.rateLimited, true);
		assert.equal(error.status, 403);
		assert.equal(error.rateLimit.resetMs, resetSeconds * 1000);
		return true;
	});

	await assert.rejects(
		fetchCommitWindow({ fetchImpl: async () => ({ ok: false, status: 404, headers: new Headers(), json: async () => ({}) }) }),
		(error) => error.rateLimited === false && /status 404/.test(error.message),
	);
	const originalFetch = globalThis.fetch;
	try {
		delete globalThis.fetch;
		await assert.rejects(fetchCommitWindow({}), /Fetch is not available/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('commit graph snapshots round-trip newest-first with merge indexes', () => {
	const commits = [
		{ sha: 'aaa', iso: '2026-08-11T08:00:00Z', isMerge: false },
		{ sha: 'bbb', iso: '2026-08-13T10:00:00Z', isMerge: true },
		{ sha: 'ccc', iso: '2026-08-12T09:00:00Z', isMerge: false },
	];
	const snapshot = buildCommitSnapshot(commits, { repo: 'owner/repo', days: 30, truncated: false, generatedAt: '2026-08-13T12:00:00Z' });

	assert.deepEqual(snapshot, {
		repo: 'owner/repo',
		windowDays: 30,
		truncated: false,
		generatedAt: '2026-08-13T12:00:00Z',
		timestamps: ['2026-08-13T10:00:00Z', '2026-08-12T09:00:00Z', '2026-08-11T08:00:00Z'],
		shas: ['bbb', 'ccc', 'aaa'],
		merges: [0],
	});

	const parsed = parseCommitSnapshot(snapshot);
	assert.equal(parsed.repo, 'owner/repo');
	assert.equal(parsed.windowDays, 30);
	assert.equal(parsed.generatedAt, '2026-08-13T12:00:00Z');
	assert.deepEqual(parsed.commits, [
		{ sha: 'bbb', iso: '2026-08-13T10:00:00Z', isMerge: true },
		{ sha: 'ccc', iso: '2026-08-12T09:00:00Z', isMerge: false },
		{ sha: 'aaa', iso: '2026-08-11T08:00:00Z', isMerge: false },
	]);
	assert.equal(parseCommitSnapshot(null), null);
	assert.equal(parseCommitSnapshot({ timestamps: 'nope' }), null);
	assert.deepEqual(buildCommitSnapshot(null).timestamps, []);
});

test('commit graph snapshots carry line counts once any commit has them', () => {
	const commits = [
		{ sha: 'aaa', iso: '2026-08-11T08:00:00Z', isMerge: false, additions: 10, deletions: 4 },
		{ sha: 'bbb', iso: '2026-08-13T10:00:00Z', isMerge: false },
	];
	const snapshot = buildCommitSnapshot(commits, { repo: 'owner/repo', generatedAt: '2026-08-13T12:00:00Z' });

	assert.deepEqual(snapshot.additions, [null, 10]);
	assert.deepEqual(snapshot.deletions, [null, 4]);
	assert.deepEqual(parseCommitSnapshot(snapshot).commits, [
		{ sha: 'bbb', iso: '2026-08-13T10:00:00Z', isMerge: false },
		{ sha: 'aaa', iso: '2026-08-11T08:00:00Z', isMerge: false, additions: 10, deletions: 4 },
	]);

	const pending = buildCommitSnapshot([{ sha: 'bbb', iso: '2026-08-13T10:00:00Z', isMerge: false }], { generatedAt: '2026-08-13T12:00:00Z' });
	assert.equal('additions' in pending, false);
	assert.equal(snapshotIsEquivalent(snapshot, pending), false);
});

test('commit graph reads commit line counts one request at a time and survives a rate limit', async () => {
	const seen = [];
	const fetchImpl = async (url) => {
		seen.push(url);
		const sha = url.split('/').pop();
		if (sha === 'ccc') return { ok: false, status: 404, headers: new Headers(), json: async () => ({}) };
		return { ok: true, status: 200, headers: new Headers(), json: async () => ({ stats: { additions: sha.length, deletions: 1 } }) };
	};

	assert.equal(commitStatsUrl('owner/repo', 'aaa'), 'https://api.github.com/repos/owner/repo/commits/aaa');
	const result = await fetchCommitStats({ repo: 'owner/repo', shas: ['aaa', 'bbbb', 'ccc'], token: 'secret', concurrency: 1, fetchImpl });
	assert.deepEqual(result.stats, { aaa: { additions: 3, deletions: 1 }, bbbb: { additions: 4, deletions: 1 } });
	assert.equal(result.requests, 3);
	assert.equal(result.rateLimited, false);
	assert.equal(seen.length, 3);

	const limited = await fetchCommitStats({
		shas: ['aaa', 'bbb'],
		concurrency: 1,
		fetchImpl: async () => ({ ok: false, status: 403, headers: new Headers({ 'x-ratelimit-remaining': '0' }), json: async () => ({}) }),
	});
	assert.equal(limited.rateLimited, true);
	assert.equal(limited.requests, 1);
	assert.deepEqual(limited.stats, {});
	assert.deepEqual(await fetchCommitStats({ shas: [], fetchImpl }), { stats: {}, requests: 0, rateLimited: false, rateLimit: null });
});

test('commit graph snapshot comparison ignores the generation timestamp', () => {
	const first = buildCommitSnapshot([{ iso: '2026-08-13T10:00:00Z', isMerge: false }], { generatedAt: '2026-08-13T12:00:00Z' });
	const second = buildCommitSnapshot([{ iso: '2026-08-13T10:00:00Z', isMerge: false }], { generatedAt: '2026-08-13T18:00:00Z' });
	const third = buildCommitSnapshot([{ iso: '2026-08-13T11:00:00Z', isMerge: false }], { generatedAt: '2026-08-13T18:00:00Z' });

	assert.equal(snapshotIsEquivalent(first, second), true);
	assert.equal(snapshotIsEquivalent(first, third), false);
	assert.equal(snapshotIsEquivalent(null, second), false);
});

test('commit graph describes snapshot age in both locales', () => {
	assert.equal(formatAge(30 * 1000, 'en'), 'under 1 minute');
	assert.equal(formatAge(30 * 1000, 'de'), 'unter 1 Minute');
	assert.equal(formatAge(60 * 1000, 'en'), '1 minute');
	assert.equal(formatAge(45 * 60 * 1000, 'de'), '45 Minuten');
	assert.equal(formatAge(60 * 60 * 1000, 'en'), '1 hour');
	assert.equal(formatAge(5 * 60 * 60 * 1000, 'de'), '5 Stunden');
	assert.equal(formatAge(26 * 60 * 60 * 1000, 'en'), '1 day');
	assert.equal(formatAge(72 * 60 * 60 * 1000, 'de'), '3 Tage');
	assert.equal(formatAge(Number.NaN, 'en'), 'under 1 minute');
});


test('media info formatting helpers normalize analysis output for display', () => {
	assert.deepEqual(normalizeResult('{"media":{"track":[]}}'), { media: { track: [] } });
	assert.deepEqual(normalizeResult(null), { media: { track: [] } });
	assert.equal(formatResolution({ Width: 1920, Height: 1080 }), '1920 x 1080');
	assert.equal(formatResolution({}), '');
	assert.equal(formatMediaInfoDuration(65.25), '1:05.250');
	assert.equal(formatMediaInfoDuration(3661), '1:01:01');
	assert.equal(formatMediaInfoDuration('unknown'), 'unknown');
	assert.equal(formatMediaInfoDuration(null), '');
	assert.equal(formatBitRate(2500000), '2.5 Mb/s');
	assert.equal(formatBitRate(192000), '192 kb/s');
	assert.equal(formatBitRate('variable'), 'variable');
	assert.equal(formatFrameRate(29.97003), '30 fps');
	assert.equal(formatFrameRate('variable'), 'variable');
	assert.equal(formatChannels(2), '2');
	assert.equal(formatChannels(null), '');
	assert.equal(formatSamplingRate(48000), '48 kHz');
	assert.equal(formatSamplingRate(800), '800 Hz');
	assert.equal(formatSamplingRate('unknown'), 'unknown');
	assert.equal(formatNumericBytes(1536), '1.5 KB');
	assert.equal(formatNumericBytes('unknown'), 'unknown');
	assert.equal(formatMediaInfoBytes(5 * 1024 ** 4), '5 TB');
	assert.equal(formatMediaInfoBytes(Number.NaN), '0 B');
	assert.equal(trimNumber(12.345), '12.3');
	const factory = () => {};
	assert.equal(getMediaInfoFactory(factory), factory);
	assert.equal(getMediaInfoFactory({ mediaInfoFactory: factory }), factory);
	assert.equal(getMediaInfoFactory({ default: factory }), factory);
	assert.equal(getMediaInfoFactory({}), null);
});
