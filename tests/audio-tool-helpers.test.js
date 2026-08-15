import test from 'node:test';
import assert from 'node:assert/strict';

import {
	amplitudeToDbfs,
	analyzeLevels,
	averageSpectrum,
	clamp,
	createSpectrogram,
	downmixChannels,
	fftReal,
	formatAnalyzerTime,
	integratedLufs,
	kWeightSamples,
	meanSquare,
	normalizeSelection,
	peakAmplitude,
	roseusColor,
} from '../src/lib/tools/audio-analyzer.js';
import {
	chanceProbability,
	combination,
	createTrials,
	fileExtension,
	formatProbability,
	formatTime,
} from '../src/lib/tools/abx-tester.js';
import { estimateAlignmentOffset, shiftSamples } from '../src/lib/tools/audio-alignment.js';
import {
	ASSUMED_LAST_CHAPTER_SECONDS,
	buildFfmetadata,
	defaultMuxContainer,
	lastChapterEnd,
	muxAttempts,
	muxContainerOptions,
	muxContainers,
	muxModes,
	usesAssumedEnd,
} from '../src/lib/tools/podcast-chapters.js';
import {
	buildMasteringArgs,
	buildOutputInfo,
	detectMediaKind,
	selectAudioArgs,
	selectAudioCodec,
	selectOutputProfile,
} from '../src/lib/tools/loudness-mastering.js';
import { buildPodcastCleanerArgs, outputFormat } from '../src/lib/tools/podcast-cleaner.js';

// Which containers each codec can actually be muxed into. The mastering pipeline
// stream-writes the codec straight into the container the profile table picked,
// so a pair that is missing here is a run that ends in "FFmpeg exited with code 1".
const CONTAINERS_BY_CODEC = {
	pcm_s16le: ['.wav'],
	flac: ['.flac'],
	libopus: ['.ogg', '.opus', '.webm'],
	libmp3lame: ['.mp3'],
	aac: ['.m4a', '.mp4', '.mov', '.avi', '.mkv'],
};

// Every MIME type the two mastering tables know about, plus the fallbacks.
const MASTERING_TYPES = [
	'audio/wav',
	'audio/x-wav',
	'audio/flac',
	'audio/ogg',
	'audio/opus',
	'audio/mpeg',
	'audio/mp3',
	'audio/mp4',
	'video/mp4',
	'video/quicktime',
	'video/x-msvideo',
	'video/x-matroska',
	'video/webm',
	'video/x-flv',
	'application/octet-stream',
	'',
];

const sineSamples = (amplitude, { sampleRate = 8000, seconds = 2, frequency = 1000 } = {}) => Float32Array.from(
	{ length: Math.round(sampleRate * seconds) },
	(_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate),
);

/* Broadband, deterministic material: a correlation peak on noise is unambiguous where a tone's is not. */
const noiseSamples = (length, seed = 1) => {
	let state = seed >>> 0;
	return Float32Array.from({ length }, () => {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
		return (state / 2 ** 32) * 2 - 1;
	});
};

/* An encoder delay looks exactly like this: the same samples, pushed back behind silence. */
const withLeadingSilence = (samples, delay) => {
	const delayed = new Float32Array(samples.length + delay);
	delayed.set(samples, delay);
	return delayed;
};

test('mastering profiles only ever pick a container that can hold the chosen codec', () => {
	for (const type of MASTERING_TYPES) {
		const file = { name: `episode.${type.split('/')[1] || 'bin'}`, type };
		const profile = selectOutputProfile(file);
		const codec = selectAudioCodec(file);
		assert.ok(CONTAINERS_BY_CODEC[codec], `unknown codec ${codec} for ${type || '(empty type)'}`);
		assert.ok(
			CONTAINERS_BY_CODEC[codec].includes(profile.extension),
			`${type || '(empty type)'} masters to ${codec} but writes ${profile.extension}`,
		);
		/* The download name is what the user ends up with, so tie it to the codec table too. */
		const output = buildOutputInfo(file);
		assert.equal(output.fileName, `episode-mastered${profile.extension}`);
		assert.ok(
			CONTAINERS_BY_CODEC[codec].includes(output.fileName.replace(/^.*(?=\.)/, '')),
			`${type || '(empty type)'} masters to ${codec} but downloads as ${output.fileName}`,
		);
	}
});

test('mastering recognises the alternative wav and mp3 MIME spellings', () => {
	assert.deepEqual(selectOutputProfile({ type: 'audio/x-wav' }), { extension: '.wav', displayName: 'WAV', mimeType: 'audio/wav' });
	assert.deepEqual(selectOutputProfile({ type: 'audio/mp3' }), { extension: '.mp3', displayName: 'MP3', mimeType: 'audio/mpeg' });
	assert.deepEqual(buildOutputInfo({ name: 'show 12.wav', type: 'audio/x-wav' }), {
		fileName: 'show 12-mastered.wav',
		extension: '.wav',
		displayName: 'WAV',
		mimeType: 'audio/wav',
	});
	assert.deepEqual(buildMasteringArgs('input.bin', 'output.wav', { type: 'audio/x-wav' }), [
		'-i', 'input.bin', '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-c:a', 'pcm_s16le', '-ar', '48000', '-y', 'output.wav',
	]);
	assert.deepEqual(buildMasteringArgs('input.bin', 'output.mp3', { type: 'audio/mp3' }), [
		'-i', 'input.bin', '-vn', '-af', 'loudnorm=I=-14:TP=-1:LRA=11', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', 'output.mp3',
	]);
});

test('mastering falls back per media kind and normalises the MIME casing', () => {
	assert.equal(detectMediaKind({ type: 'VIDEO/MP4' }), 'video');
	assert.equal(detectMediaKind(null), 'audio');
	assert.deepEqual(selectOutputProfile({ type: 'AUDIO/WAV' }), { extension: '.wav', displayName: 'WAV', mimeType: 'audio/wav' });
	assert.equal(selectOutputProfile({ type: 'audio/aiff' }).extension, '.m4a');
	assert.equal(selectOutputProfile({ type: 'video/avi' }, 'video').extension, '.mp4');
	assert.equal(selectAudioCodec({ type: 'AUDIO/X-WAV' }), 'pcm_s16le');
	assert.equal(selectAudioCodec({}), 'aac');
	assert.deepEqual(selectAudioArgs('flac'), ['-ar', '48000']);
	assert.deepEqual(selectAudioArgs('aac'), ['-b:a', '192k']);
	assert.deepEqual(selectAudioArgs('pcm_s16le'), ['-ar', '48000']);
});

test('podcast cleaner emits no filter chain when every cleanup toggle is off', () => {
	assert.deepEqual(
		buildPodcastCleanerArgs('in.wav', 'out.mp3', outputFormat('mp3'), {}),
		['-i', 'in.wav', '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '160k', '-y', 'out.mp3'],
	);
	assert.deepEqual(
		buildPodcastCleanerArgs('in.wav', 'out.wav', outputFormat('wav'), {
			highpass: false,
			lowpass: false,
			denoise: false,
			declick: false,
			silence: false,
			compress: false,
			loudness: false,
		}),
		['-i', 'in.wav', '-map', '0:a:0', '-vn', '-c:a', 'pcm_s16le', '-y', 'out.wav'],
	);
});

test('podcast cleaner builds each individual filter and honours the slider defaults', () => {
	const chainFor = (settings) => {
		const args = buildPodcastCleanerArgs('in.wav', 'out.opus', outputFormat('opus'), settings);
		return args[args.indexOf('-af') + 1];
	};

	assert.equal(chainFor({ declick: true }), 'adeclick');
	assert.equal(chainFor({ denoise: true }), 'afftdn=nf=-25');
	assert.equal(chainFor({ lowpass: true }), 'lowpass=f=14500');
	assert.equal(chainFor({ compress: true }), 'acompressor=threshold=-18dB:ratio=3:attack=12:release=180:makeup=2');
	assert.equal(chainFor({ loudness: true }), 'loudnorm=I=-16:TP=-1.5:LRA=11');
	assert.equal(chainFor({ highpass: true }), 'highpass=f=80');
	assert.equal(chainFor({ highpass: true, highpassFreq: '120' }), 'highpass=f=120');
	assert.equal(
		chainFor({ silence: true }),
		'silenceremove=start_periods=1:start_duration=0.25:start_threshold=-45dB:stop_periods=-1:stop_duration=0.7:stop_threshold=-45dB',
	);
	assert.equal(chainFor({ declick: true, highpass: true, loudness: true }), 'highpass=f=80,adeclick,loudnorm=I=-16:TP=-1.5:LRA=11');
});

test('podcast cleaner output formats keep extension, MIME, and encoder args in step', () => {
	assert.deepEqual(outputFormat('wav'), { extension: 'wav', mime: 'audio/wav', args: ['-c:a', 'pcm_s16le'] });
	assert.deepEqual(outputFormat('m4a'), { extension: 'm4a', mime: 'audio/mp4', args: ['-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'] });
	assert.deepEqual(outputFormat('opus'), { extension: 'opus', mime: 'audio/ogg', args: ['-c:a', 'libopus', '-b:a', '96k'] });
	assert.deepEqual(outputFormat('mp3'), { extension: 'mp3', mime: 'audio/mpeg', args: ['-c:a', 'libmp3lame', '-b:a', '160k'] });
	assert.deepEqual(outputFormat('flac'), outputFormat('mp3'));
	assert.deepEqual(outputFormat(undefined), outputFormat('mp3'));
});

test('abx trials stay balanced between A and B and normalise the requested count', () => {
	assert.deepEqual(createTrials(0), []);
	assert.deepEqual(createTrials(-4), []);
	assert.deepEqual(createTrials(Number.NaN), []);
	assert.equal(createTrials('6', () => 0.9).length, 6);
	assert.equal(createTrials(4.9, () => 0.1).length, 4);

	// 0.5 is the exact boundary: below picks A, at or above picks B.
	assert.deepEqual(createTrials(2, () => 0.499_999), [{ xIs: 'A' }, { xIs: 'A' }]);
	assert.deepEqual(createTrials(2, () => 0.5), [{ xIs: 'B' }, { xIs: 'B' }]);

	const values = [0.05, 0.95, 0.44, 0.56, 0.2, 0.8];
	const trials = createTrials(6, () => values.shift());
	assert.deepEqual(trials.map((trial) => trial.xIs), ['A', 'B', 'A', 'B', 'A', 'B']);
	assert.equal(trials.filter((trial) => trial.xIs === 'A').length, 3);
});

test('abx statistics stay exact at the edges of the binomial table', () => {
	assert.equal(combination(0, 0), 1);
	assert.equal(combination(6, 0), 1);
	assert.equal(combination(6, 6), 1);
	assert.equal(combination(10, 3), 120);
	assert.equal(combination(-2, -2), 1);
	assert.equal(chanceProbability(0, 0), 1);
	assert.equal(chanceProbability(5, 4), 0);
	assert.equal(chanceProbability(3, 4), 5 / 16);
	assert.equal(chanceProbability(4, 4), 1 / 16);
	assert.equal(formatProbability(0), '0.00');
	assert.equal(formatProbability(9.999), '10.00');
	assert.equal(formatProbability(10), '10.0');
	assert.equal(formatProbability(100), '100.0');
	assert.equal(formatTime(0), '0:00');
	assert.equal(formatTime(-12), '0:00');
	assert.equal(formatTime(3599.9), '59:59');
	assert.equal(formatTime(3600), '60:00');
	assert.equal(fileExtension(''), '.audio');
	assert.equal(fileExtension(null), '.audio');
	assert.equal(fileExtension('mix.tar.gz'), '.gz');
	assert.equal(fileExtension('take 2.OggOpus'), '.oggopus');
});

test('alignment finds an injected encoder delay in either direction', () => {
	const reference = noiseSamples(20000);
	const options = { maxOffset: 400, analysisLength: 4000 };

	for (const delay of [1, 17, 137, 400]) {
		// A prepended delay makes the copy lag, which is the positive direction.
		assert.equal(estimateAlignmentOffset(reference, withLeadingSilence(reference, delay), options), delay);
		// A copy that lost its head start leads instead, and has to come back negative.
		assert.equal(estimateAlignmentOffset(reference, reference.subarray(delay), options), -delay);
	}

	// The coarse grid is only there to keep the search cheap; it must not change the answer.
	const delayed = withLeadingSilence(reference, 137);
	assert.equal(estimateAlignmentOffset(reference, delayed, { ...options, coarseStep: 1 }), 137);
	assert.equal(estimateAlignmentOffset(reference, delayed, { ...options, coarseStep: 32 }), 137);
});

test('alignment leaves matched and silent material exactly where it is', () => {
	const reference = noiseSamples(20000, 5);
	const silence = new Float32Array(20000);

	assert.equal(estimateAlignmentOffset(reference, reference.slice(), { maxOffset: 400 }), 0);
	assert.equal(estimateAlignmentOffset(silence, silence.slice(), { maxOffset: 400 }), 0);
	assert.equal(estimateAlignmentOffset(silence, reference, { maxOffset: 400 }), 0);
	assert.equal(estimateAlignmentOffset(reference, silence, { maxOffset: 400 }), 0);
	// Silence correlates equally well at every shift, so nothing may be trimmed off a real sample.
	assert.equal(estimateAlignmentOffset(reference, withLeadingSilence(silence, 137), { maxOffset: 400 }), 0);
});

test('alignment answers inside its window even when the real offset is outside it', () => {
	const reference = noiseSamples(20000, 9);
	const far = withLeadingSilence(reference, 3000);
	const bounded = estimateAlignmentOffset(reference, far, { maxOffset: 120, analysisLength: 4000 });

	assert.ok(Number.isInteger(bounded), `expected a whole sample offset, got ${bounded}`);
	assert.ok(Math.abs(bounded) <= 120, `expected an answer within +-120 samples, got ${bounded}`);
	assert.notEqual(bounded, 3000);
	// Given room to look, the same pair gives up the offset it was hiding.
	assert.equal(estimateAlignmentOffset(reference, far, { maxOffset: 4000, analysisLength: 4000 }), 3000);
});

test('alignment sizes its window from the sample rate and survives useless input', () => {
	const reference = noiseSamples(40000, 3);
	const delayed = withLeadingSilence(reference, 1105);

	// 100 ms of room at 44.1 kHz is 4410 samples, which covers any encoder delay.
	assert.equal(estimateAlignmentOffset(reference, delayed, { sampleRate: 44100 }), 1105);
	assert.equal(estimateAlignmentOffset([...reference], [...delayed], { sampleRate: 44100 }), 1105);
	// 100 ms at 8 kHz is only 800 samples, so the same pair can no longer reach it.
	const tooNarrow = estimateAlignmentOffset(reference, delayed, { sampleRate: 8000 });
	assert.ok(Math.abs(tooNarrow) <= 800, `expected an answer within +-800 samples, got ${tooNarrow}`);
	assert.notEqual(tooNarrow, 1105);

	assert.equal(estimateAlignmentOffset(reference, delayed, { maxOffset: 0 }), 0);
	assert.equal(estimateAlignmentOffset(reference, []), 0);
	assert.equal(estimateAlignmentOffset([], []), 0);
	assert.equal(estimateAlignmentOffset(null, undefined), 0);
	// Nothing to correlate once the guard band eats the whole candidate.
	assert.equal(estimateAlignmentOffset(reference, delayed.subarray(0, 5000), { sampleRate: 44100 }), 0);
});

// The sources the chapter editor is handed, from the two it can copy straight through
// to the ones that reach an MP4-family container only by way of an encoder.
const CHAPTER_SOURCES = {
	mp3: { name: 'episode.mp3', type: 'audio/mpeg' },
	m4a: { name: 'episode.m4a', type: 'audio/mp4' },
	mp4: { name: 'episode.mp4', type: 'video/mp4' },
	mov: { name: 'episode.mov', type: 'video/quicktime' },
	wav: { name: 'episode.wav', type: 'audio/wav' },
	flac: { name: 'episode.flac', type: 'audio/flac' },
	ogg: { name: 'episode.ogg', type: 'audio/ogg' },
	mkv: { name: 'episode.mkv', type: 'video/x-matroska' },
	webm: { name: 'episode.webm', type: 'video/webm' },
	nameless: { name: 'episode', type: '' },
};

const CHAPTER_HEAD = ['-i', 'input.bin', '-i', 'chapters.ffmetadata', '-map_metadata', '0', '-map_chapters', '1'];

const chapterRun = (file, container, output) => muxAttempts(file, container, {
	input: 'input.bin',
	meta: 'chapters.ffmetadata',
	output,
});

test('chapter mux offers every container whatever the source is', () => {
	const options = [
		{ value: 'm4a', label: 'M4A' },
		{ value: 'mp3', label: 'MP3' },
		{ value: 'mp4', label: 'MP4' },
		{ value: 'mkv', label: 'MKV' },
	];

	assert.deepEqual(muxContainers(), ['m4a', 'mp3', 'mp4', 'mkv']);
	assert.deepEqual(muxContainerOptions(), options);

	// PCM, FLAC, Vorbis and video used to shrink this list down to Matroska. The menu is
	// no longer the place where a missing stream copy is settled, so it stays whole.
	for (const file of [null, ...Object.values(CHAPTER_SOURCES)]) {
		assert.deepEqual(muxContainers(file), ['m4a', 'mp3', 'mp4', 'mkv'], `${file?.name ?? 'no file'} must keep every container`);
		assert.deepEqual(muxContainerOptions(file), options);
	}

	// Without a choice of its own the tool starts at the container the source copies into.
	assert.equal(defaultMuxContainer(null, ''), 'm4a');
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.mp3, ''), 'mp3');
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.m4a, undefined), 'm4a');
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.mp4, ''), 'mp4');
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.mov, ''), 'mp4');
	for (const file of [CHAPTER_SOURCES.wav, CHAPTER_SOURCES.flac, CHAPTER_SOURCES.ogg, CHAPTER_SOURCES.mkv, CHAPTER_SOURCES.webm, CHAPTER_SOURCES.nameless]) {
		assert.equal(defaultMuxContainer(file, ''), 'mkv', `${file.name} is copied into Matroska`);
	}

	// A missing or unhelpful MIME type still leaves the extension to go on.
	assert.equal(defaultMuxContainer({ name: 'episode.mp3', type: '' }, ''), 'mp3');
	assert.equal(defaultMuxContainer({ name: 'EPISODE.M4A', type: 'application/octet-stream' }, ''), 'm4a');
	assert.equal(defaultMuxContainer({ name: 'episode.mp4' }, ''), 'mp4');
	assert.equal(defaultMuxContainer({ type: 'audio/mpeg' }, ''), 'mp3');

	// A choice the visitor made is never overruled, however far the source sits from it.
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.wav, 'm4a'), 'm4a');
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.mp4, 'mp3'), 'mp3');
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.mp3, 'mkv'), 'mkv');
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.mp3, 'mp4'), 'mp4');
	// Only a container nobody offers falls back, and it falls back to the source's own.
	assert.equal(defaultMuxContainer(CHAPTER_SOURCES.mp3, 'ogg'), 'mp3');
});

test('chapter mux copies where the container takes the source and re-encodes where it cannot', () => {
	// A copy is lossless and quick, so it goes first wherever the container accepts the streams.
	assert.deepEqual(muxModes(CHAPTER_SOURCES.mp3, 'mp3'), ['copy', 'transcode']);
	assert.deepEqual(muxModes(CHAPTER_SOURCES.m4a, 'm4a'), ['copy', 'transcode']);
	assert.deepEqual(muxModes(CHAPTER_SOURCES.m4a, 'mp4'), ['copy', 'transcode']);
	assert.deepEqual(muxModes(CHAPTER_SOURCES.mp4, 'm4a'), ['copy', 'transcode']);
	assert.deepEqual(muxModes(CHAPTER_SOURCES.mov, 'mp4'), ['copy', 'transcode']);

	// Matroska takes every stream these tools meet, so it is copied into from anywhere.
	for (const file of [null, ...Object.values(CHAPTER_SOURCES)]) {
		assert.deepEqual(muxModes(file, 'mkv'), ['copy', 'transcode'], `${file?.name ?? 'no file'} is copied into Matroska`);
	}

	// The rest is re-encoded rather than refused: the container is what was asked for.
	assert.deepEqual(muxModes(CHAPTER_SOURCES.mp3, 'm4a'), ['transcode']);
	assert.deepEqual(muxModes(CHAPTER_SOURCES.mp3, 'mp4'), ['transcode']);
	assert.deepEqual(muxModes(CHAPTER_SOURCES.mp4, 'mp3'), ['transcode']);
	assert.deepEqual(muxModes(CHAPTER_SOURCES.m4a, 'mp3'), ['transcode']);
	for (const file of [CHAPTER_SOURCES.wav, CHAPTER_SOURCES.flac, CHAPTER_SOURCES.ogg, CHAPTER_SOURCES.webm, CHAPTER_SOURCES.nameless]) {
		for (const container of ['mp3', 'm4a', 'mp4']) {
			assert.deepEqual(muxModes(file, container), ['transcode'], `${file.name} has to be re-encoded for ${container}`);
		}
	}

	// Every source reaches every container by one route or the other.
	for (const file of [null, ...Object.values(CHAPTER_SOURCES)]) {
		for (const container of ['m4a', 'mp3', 'mp4', 'mkv']) {
			assert.ok(muxModes(file, container).length > 0, `${file?.name ?? 'no file'} must reach ${container}`);
		}
	}
});

test('chapter mux builds an FFmpeg run for the container that was picked, not for the one that was easy', () => {
	// An MP3 into MP3 is a plain remux, with the re-encode queued behind it in case the muxer balks.
	const intoMp3 = chapterRun(CHAPTER_SOURCES.mp3, 'mp3', 'out.mp3');
	assert.deepEqual(intoMp3.map((attempt) => attempt.mode), ['copy', 'transcode']);
	assert.deepEqual(intoMp3[0], {
		mode: 'copy',
		container: 'mp3',
		label: 'MP3',
		codec: '',
		args: [...CHAPTER_HEAD, '-map', '0', '-c', 'copy', '-y', 'out.mp3'],
	});
	assert.deepEqual(intoMp3[1], {
		mode: 'transcode',
		container: 'mp3',
		label: 'MP3',
		codec: 'MP3',
		args: [...CHAPTER_HEAD, '-map', '0:a', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', 'out.mp3'],
	});

	// PCM has no home in an MP4-family container, so AAC is what fills the M4A that was asked for.
	const intoM4a = chapterRun(CHAPTER_SOURCES.wav, 'm4a', 'out.m4a');
	assert.deepEqual(intoM4a, [{
		mode: 'transcode',
		container: 'm4a',
		label: 'M4A',
		codec: 'AAC',
		args: [...CHAPTER_HEAD, '-map', '0:a', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', 'out.m4a'],
	}]);

	// An MP3 asked for MP4 gets AAC too, and only the audio: nothing is silently left in MP3.
	assert.deepEqual(chapterRun(CHAPTER_SOURCES.mp3, 'mp4', 'out.mp4'), [{
		mode: 'transcode',
		container: 'mp4',
		label: 'MP4',
		codec: 'AAC',
		args: [...CHAPTER_HEAD, '-map', '0:a', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', 'out.mp4'],
	}]);

	// A WebM keeps its picture on the way into MP4, which means an H.264 encode.
	assert.deepEqual(chapterRun(CHAPTER_SOURCES.webm, 'mp4', 'out.mp4'), [{
		mode: 'transcode',
		container: 'mp4',
		label: 'MP4',
		codec: 'H.264 + AAC',
		args: [
			...CHAPTER_HEAD,
			'-map', '0', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
			'-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', 'out.mp4',
		],
	}]);

	// A video source loses its picture on the way into the audio-only containers, not its chapters.
	assert.deepEqual(chapterRun(CHAPTER_SOURCES.mp4, 'mp3', 'out.mp3')[0].args,
		[...CHAPTER_HEAD, '-map', '0:a', '-c:a', 'libmp3lame', '-b:a', '192k', '-y', 'out.mp3']);

	// Faststart belongs to the MP4 family only, and the copy keeps it.
	const intoMp4 = chapterRun(CHAPTER_SOURCES.mp4, 'mp4', 'out.mp4');
	assert.deepEqual(intoMp4[0].args, [...CHAPTER_HEAD, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', 'out.mp4']);
	assert.deepEqual(chapterRun(CHAPTER_SOURCES.m4a, 'm4a', 'out.m4a')[0].args,
		[...CHAPTER_HEAD, '-map', '0', '-c', 'copy', '-movflags', '+faststart', '-y', 'out.m4a']);

	// Matroska is copied into, and re-encodes losslessly to FLAC if that copy is ever refused.
	const intoMkv = chapterRun(CHAPTER_SOURCES.wav, 'mkv', 'out.mkv');
	assert.deepEqual(intoMkv[0].args, [...CHAPTER_HEAD, '-map', '0', '-c', 'copy', '-y', 'out.mkv']);
	assert.deepEqual(intoMkv[1], {
		mode: 'transcode',
		container: 'mkv',
		label: 'MKV',
		codec: 'FLAC',
		args: [...CHAPTER_HEAD, '-map', '0', '-c:v', 'copy', '-c:a', 'flac', '-y', 'out.mkv'],
	});

	// Chapters come from the second input and metadata from the first, on every route.
	for (const file of [null, ...Object.values(CHAPTER_SOURCES)]) {
		for (const container of ['m4a', 'mp3', 'mp4', 'mkv']) {
			for (const attempt of chapterRun(file, container, `out.${container}`)) {
				assert.deepEqual(attempt.args.slice(0, 8), CHAPTER_HEAD);
				assert.equal(attempt.container, container);
				assert.equal(attempt.args.at(-1), `out.${container}`);
				assert.equal(attempt.args.at(-2), '-y');
				assert.equal(attempt.mode === 'copy', attempt.codec === '');
			}
		}
	}
});

test('the last chapter ends at the media duration instead of a flat minute', () => {
	const chapters = [{ start: 0, title: 'Intro' }, { start: 150, title: 'Main topic' }];

	// Nothing loaded: the guess stands, and the tool has to be able to say so.
	assert.equal(usesAssumedEnd(chapters, Number.NaN), true);
	assert.equal(usesAssumedEnd(chapters, undefined), true);
	assert.equal(lastChapterEnd(chapters, Number.NaN), 150 + ASSUMED_LAST_CHAPTER_SECONDS);
	assert.equal(buildFfmetadata(chapters, Number.NaN), [
		';FFMETADATA1',
		'[CHAPTER]', 'TIMEBASE=1/1000', 'START=0', 'END=149999', 'title=Intro',
		'[CHAPTER]', 'TIMEBASE=1/1000', 'START=150000', 'END=209999', 'title=Main topic',
		'',
	].join('\n'));

	// A loaded episode ends its last chapter where the episode ends, however long that is.
	assert.equal(usesAssumedEnd(chapters, 1875.5), false);
	assert.equal(lastChapterEnd(chapters, 1875.5), 1875.5);
	assert.ok(buildFfmetadata(chapters, 1875.5).includes('START=150000\nEND=1875499\n'));
	assert.ok(buildFfmetadata(chapters, 30.25).includes('START=0\nEND=149999\n'));

	// A duration that runs out before the last chapter starts is no duration at all.
	assert.equal(usesAssumedEnd(chapters, 150), true);
	assert.equal(usesAssumedEnd(chapters, 0), true);
	assert.equal(usesAssumedEnd(chapters, Infinity), true);
	assert.equal(lastChapterEnd(chapters, 90), 210);

	// Every chapter keeps a non-zero span, and titles still reach the file escaped.
	assert.equal(buildFfmetadata([], 60), ';FFMETADATA1\n');
	assert.equal(buildFfmetadata([{ start: 5, title: 'Solo' }], 5), [
		';FFMETADATA1', '[CHAPTER]', 'TIMEBASE=1/1000', 'START=5000', 'END=64999', 'title=Solo', '',
	].join('\n'));
	assert.ok(buildFfmetadata([{ start: 0, title: String.raw`AC\DC; take #2 = final` }], 30)
		.includes(String.raw`title=AC\\DC\; take \#2 \= final`));
});

test('analyzer level helpers clamp their ranges instead of reading past the samples', () => {
	const samples = Float32Array.from([0.5, -0.5, 0.25, -0.25]);
	assert.equal(clamp(Number.NaN, 2, 8), 2);
	assert.equal(clamp(-3, 0, 5), 0);
	assert.equal(clamp(9, 0, 5), 5);
	assert.equal(meanSquare(samples, 3, 1), 0);
	assert.equal(meanSquare(new Float32Array(), 0, 4), 0);
	assert.equal(meanSquare(samples, -10, 99), 0.15625);
	assert.equal(peakAmplitude(samples, 2, 2), 0);
	assert.equal(peakAmplitude(samples, 2, 99), 0.25);
	assert.equal(amplitudeToDbfs(0), -120);
	assert.equal(amplitudeToDbfs(-1), -120);
	assert.equal(amplitudeToDbfs(1e-9), -120);
	assert.equal(amplitudeToDbfs(1), 0);
	assert.equal(formatAnalyzerTime(-4), '0:00.000');
	assert.equal(formatAnalyzerTime(Number.NaN), '0:00.000');
	assert.equal(formatAnalyzerTime(9.5), '0:09.500');
});

test('analyzer selections normalise to the file bounds in either drag direction', () => {
	assert.deepEqual(normalizeSelection(null, 4, 22050), { startTime: 0, endTime: 4, lowFrequency: 0, highFrequency: 22050 });
	assert.deepEqual(normalizeSelection({ startTime: 3, endTime: 1 }, 4, 22050), {
		startTime: 1,
		endTime: 3,
		lowFrequency: 0,
		highFrequency: 22050,
	});
	assert.deepEqual(normalizeSelection({ startTime: -2, endTime: 90, lowFrequency: 30000, highFrequency: -5 }, 4, 22050), {
		startTime: 0,
		endTime: 4,
		lowFrequency: 0,
		highFrequency: 22050,
	});
});

test('analyzer downmixes channels to the shortest common length', () => {
	assert.equal(downmixChannels([]).length, 0);
	assert.deepEqual(
		Array.from(downmixChannels([Float32Array.from([1, 1, 1]), Float32Array.from([0, 0])])),
		[0.5, 0.5],
	);
	assert.deepEqual(Array.from(downmixChannels([Float32Array.from([0.5, -0.5])])), [0.5, -0.5]);
});

test('analyzer loudness stays scale-accurate and reports silence as -120', () => {
	const sampleRate = 8000;
	assert.equal(kWeightSamples(new Float32Array(), sampleRate).length, 0);
	assert.equal(kWeightSamples(Float32Array.from([1, 0]), 0).length, 0);
	assert.equal(integratedLufs(new Float32Array(sampleRate), sampleRate), -120);

	const loud = integratedLufs(kWeightSamples(sineSamples(0.5), sampleRate), sampleRate);
	const quiet = integratedLufs(kWeightSamples(sineSamples(0.25), sampleRate), sampleRate);
	// Halving the amplitude quarters the energy: exactly 6.0206 LUFS quieter.
	assert.ok(Math.abs((loud - quiet) - 6.0206) < 0.01, `expected a 6.02 LUFS gap, got ${loud - quiet}`);

	const silence = analyzeLevels(new Float32Array(sampleRate), sampleRate);
	assert.deepEqual(silence, {
		peakDbfs: -120,
		rmsDbfs: -120,
		momentaryLufs: -120,
		shortTermLufs: -120,
		integratedLufs: -120,
	});
	assert.deepEqual(analyzeLevels(new Float32Array(), sampleRate), silence);
	assert.deepEqual(analyzeLevels(sineSamples(0.5), 0), silence);
});

test('analyzer FFT pads short frames and rounds the size down to a power of two', () => {
	const constant = fftReal(Float32Array.from([1, 1, 1, 1]), 4);
	assert.equal(constant.real.length, 4);
	assert.equal(constant.real[0], 4);
	assert.ok(Math.abs(constant.real[1]) < 1e-12);
	assert.ok(Math.abs(constant.real[2]) < 1e-12);
	assert.ok(constant.imaginary.every((value) => Math.abs(value) < 1e-12));

	// An fftSize of 3 rounds down to 2, and a single sample spreads flat across the bins.
	const rounded = fftReal(Float32Array.from([1, 1]), 3);
	assert.equal(rounded.real.length, 2);
	const impulse = fftReal(Float32Array.from([1]), 4);
	assert.deepEqual(Array.from(impulse.real), [1, 1, 1, 1]);
});

test('analyzer spectrogram and spectrum resolve the tone they were given', () => {
	const sampleRate = 8000;
	const samples = sineSamples(0.5, { sampleRate, seconds: 1 });
	const single = createSpectrogram(samples, sampleRate, { fftSize: 256, maxFrames: 1 });
	assert.equal(single.frames.length, 1);
	assert.equal(single.frames[0].length, 128);
	assert.equal(single.fftSize, 256);
	assert.equal(single.sampleRate, sampleRate);
	assert.ok(single.maximum > single.minimum);

	const silent = createSpectrogram(new Float32Array(512), sampleRate, { fftSize: 256, maxFrames: 2 });
	assert.equal(silent.minimum, -120);
	assert.equal(silent.maximum, -120);

	const full = averageSpectrum(samples, sampleRate, { fftSize: 512, maxFrames: 1 });
	assert.equal(full.length, 255);
	const strongest = full.reduce((best, point) => point.db > best.db ? point : best);
	assert.equal(strongest.frequency, 1000);

	const band = averageSpectrum(samples, sampleRate, { fftSize: 512, lowFrequency: 900, highFrequency: 1100 });
	assert.ok(band.length > 0);
	assert.ok(band.every((point) => point.frequency >= 900 && point.frequency <= 1100));
	assert.equal(averageSpectrum(samples, sampleRate, { fftSize: 512, lowFrequency: 9000 }).length, 0);
});

test('analyzer Roseus ramp interpolates between stops and clamps outside 0..1', () => {
	assert.deepEqual(roseusColor(-1), [0, 0, 0]);
	assert.deepEqual(roseusColor(2), [255, 255, 255]);
	assert.deepEqual(roseusColor(0.5), [174, 52, 77]);
	assert.deepEqual(roseusColor(0.55), [191, 66, 70]);
});

test('shifting a channel by the measured offset is what removes the encoder delay', () => {
	const reference = noiseSamples(6000, 21);
	const delayed = withLeadingSilence(reference, 240);
	const offset = estimateAlignmentOffset(reference, delayed, { maxOffset: 400 });
	const aligned = shiftSamples(delayed, offset);

	assert.equal(offset, 240);
	assert.equal(aligned.length, delayed.length - 240);
	/* Sample for sample, the shifted copy now starts where the reference starts. */
	for (let index = 0; index < 200; index += 1) {
		assert.equal(aligned[index], reference[index]);
	}

	/* A candidate that runs ahead shifts the other way and is padded, never truncated into nonsense. */
	const ahead = shiftSamples(reference, -3);
	assert.equal(ahead.length, reference.length + 3);
	assert.deepEqual([...ahead.subarray(0, 3)], [0, 0, 0]);
	assert.equal(ahead[3], reference[0]);

	/* Nothing measured, nothing moved. */
	assert.equal(shiftSamples(reference, 0), reference);
	assert.equal(shiftSamples(reference, Number.NaN), reference);
	assert.equal(shiftSamples(reference, reference.length + 10).length, reference.length);
});
