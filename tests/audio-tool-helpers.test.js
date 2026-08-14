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
