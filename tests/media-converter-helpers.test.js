import test from 'node:test';
import assert from 'node:assert/strict';

import {
	CONVERSION_PROFILES,
	buildConversionArgs,
	buildConversionAttempts,
	buildOutputName,
	detectMediaKind,
	filterProfilesForMediaKind,
	inputExtension,
} from '../src/lib/tools/video-audio-converter.js';
import { buildLosslessArgs, containerMime } from '../src/lib/tools/lossless-media-surgeon.js';
import {
	buildGifArgs,
	buildGifFilter,
	clamp,
	formatTime,
	normalizeGifSettings,
	roundToHalf,
	roundToTenths,
} from '../src/lib/tools/video-to-gif-converter.js';

const videoFile = { name: 'clip.mkv', type: 'video/x-matroska' };
const audioFile = { name: 'tone.wav', type: 'audio/wav' };
const encoderPattern = /^(libx264|libx265|libvpx|libvpx-vp9|libmp3lame|libopus|libvorbis|aac|flac|gif|pcm_[a-z0-9]+)$/;

const surgeonOperations = ['remux', 'trim', 'extract', 'mute', 'replace'];
const surgeonContainers = ['mkv', 'mp4', 'mov', 'webm', 'mka'];

test('the shipped conversion profiles describe eight consistent targets', () => {
	assert.deepEqual(
		CONVERSION_PROFILES.map((profile) => profile.value),
		['wav', 'mp3', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov'],
	);

	for (const profile of CONVERSION_PROFILES) {
		assert.equal(profile.extension, `.${profile.value}`, `${profile.value} keeps its own extension`);
		assert.ok(profile.label.length > 0, `${profile.value} has a label`);
		assert.ok(['audio', 'video'].includes(profile.kind), `${profile.value} is audio or video`);
		assert.ok(profile.mimeType.startsWith(`${profile.kind}/`) || profile.value === 'm4a', `${profile.value} carries a matching MIME type`);
		assert.ok(profile.codec.length > 0, `${profile.value} names a codec`);

		if (profile.kind === 'audio') {
			assert.ok(Array.isArray(profile.args), `${profile.value} carries audio args`);
			assert.equal(profile.videoArgs, undefined, `${profile.value} carries no video args`);
			assert.equal(profile.audioCodec, undefined, `${profile.value} carries no second audio codec`);
		} else {
			assert.ok(Array.isArray(profile.videoArgs), `${profile.value} carries video args`);
			assert.ok(Array.isArray(profile.audioArgs), `${profile.value} carries audio args`);
			assert.ok(profile.audioCodec.length > 0, `${profile.value} names an audio codec`);
			assert.equal(profile.args, undefined, `${profile.value} carries no audio-only args`);
		}
	}

	/* The m4a profile is the one audio target in an ISO container, hence the exception above. */
	assert.equal(CONVERSION_PROFILES.find((profile) => profile.value === 'm4a').mimeType, 'audio/mp4');
});

test('every conversion profile builds args for its own codec, container flags, and output name', () => {
	for (const profile of CONVERSION_PROFILES) {
		const outputName = buildOutputName(videoFile.name, profile.extension);
		assert.equal(outputName, `clip${profile.extension}`);

		const args = buildConversionArgs('input.mkv', outputName, videoFile, profile);
		assert.deepEqual(args.slice(-2), ['-y', outputName], `${profile.value} writes its own output name last`);
		assert.ok(args.every((arg) => typeof arg === 'string' && arg.length > 0), `${profile.value} emits no empty argument`);

		const wantsFaststart = profile.extension === '.mp4' || profile.extension === '.mov';
		assert.equal(
			args.join(' ').includes('-movflags +faststart'),
			wantsFaststart,
			`${profile.value} only asks for faststart in ISO containers`,
		);

		if (profile.kind === 'audio') {
			assert.deepEqual(args, ['-i', 'input.mkv', '-vn', '-map', '0:a:0?', '-c:a', profile.codec, ...profile.args, '-y', outputName]);
			assert.deepEqual(
				buildConversionArgs('input.wav', outputName, audioFile, profile),
				['-i', 'input.wav', '-vn', '-c:a', profile.codec, ...profile.args, '-y', outputName],
				`${profile.value} drops the stream map for an audio-only source`,
			);
			continue;
		}

		assert.deepEqual(args, [
			'-i', 'input.mkv',
			'-map', '0:v:0?',
			'-map', '0:a:0?',
			'-c:v', profile.codec,
			...profile.videoArgs,
			'-c:a', profile.audioCodec,
			...profile.audioArgs,
			...(wantsFaststart ? ['-movflags', '+faststart'] : []),
			'-y', outputName,
		]);
	}
});

test('video targets try a stream copy before re-encoding, audio targets do not', () => {
	for (const profile of CONVERSION_PROFILES) {
		const outputName = `clip${profile.extension}`;
		const attempts = buildConversionAttempts('input.mkv', outputName, videoFile, profile);

		if (profile.kind === 'audio') {
			assert.equal(attempts.length, 1, `${profile.value} has a single attempt`);
			assert.deepEqual(attempts[0], buildConversionArgs('input.mkv', outputName, videoFile, profile));
			continue;
		}

		assert.equal(attempts.length, 2, `${profile.value} falls back from copy to a re-encode`);
		const [streamCopy, transcode] = attempts;
		assert.deepEqual(streamCopy.slice(streamCopy.indexOf('-c:v'), streamCopy.indexOf('-c:v') + 2), ['-c:v', 'copy']);
		for (const videoArg of profile.videoArgs) {
			assert.ok(!streamCopy.includes(videoArg) || profile.audioArgs.includes(videoArg), `${profile.value} drops encoder tuning from the copy attempt`);
		}
		assert.deepEqual(streamCopy.slice(-2), ['-y', outputName]);
		assert.deepEqual(transcode, buildConversionArgs('input.mkv', outputName, videoFile, profile));
	}
});

test('an unrecognised source still gets a single re-encoding attempt', () => {
	const unknownFile = { name: 'upload.bin', type: '' };
	const profile = CONVERSION_PROFILES.find((entry) => entry.value === 'mp4');

	assert.equal(detectMediaKind(unknownFile), 'unknown');
	assert.deepEqual(
		buildConversionAttempts('input.bin', 'upload.mp4', unknownFile, profile),
		[buildConversionArgs('input.bin', 'upload.mp4', unknownFile, profile)],
	);
	assert.equal(inputExtension(unknownFile), '.bin');
	assert.equal(buildOutputName(unknownFile.name, profile.extension), 'upload.mp4');
});

test('the profile list offered to a file matches the shipped table', () => {
	assert.deepEqual(
		filterProfilesForMediaKind(CONVERSION_PROFILES, audioFile).map((profile) => profile.value),
		['wav', 'mp3', 'ogg', 'm4a', 'flac'],
	);
	assert.deepEqual(
		filterProfilesForMediaKind(CONVERSION_PROFILES, videoFile).map((profile) => profile.value),
		['wav', 'mp3', 'ogg', 'm4a', 'flac', 'mp4', 'webm', 'mov'],
	);
	assert.deepEqual(
		filterProfilesForMediaKind(CONVERSION_PROFILES, { name: 'notes.txt', type: '' }).map((profile) => profile.value),
		CONVERSION_PROFILES.map((profile) => profile.value),
	);
});

test('every lossless operation stays a stream copy in every container', () => {
	for (const operation of surgeonOperations) {
		for (const container of surgeonContainers) {
			const outputName = `result.${container}`;
			const args = buildLosslessArgs('source.mkv', 'audio.wav', outputName, {
				operation,
				container,
				start: operation === 'trim' ? '1' : '',
				end: operation === 'trim' ? '4' : '',
			});
			const label = `${operation} -> ${container}`;

			assert.deepEqual(args.slice(-2), ['-y', outputName], `${label} writes the requested container last`);
			for (const [index, arg] of args.entries()) {
				assert.ok(!encoderPattern.test(arg), `${label} never names the encoder ${arg}`);
				if (arg === '-c' || arg === '-c:a' || arg === '-c:v') {
					assert.equal(args[index + 1], 'copy', `${label} copies the stream after ${arg}`);
				}
			}
			assert.ok(args.includes('copy'), `${label} copies at least one stream`);
			assert.equal(
				args.join(' ').includes('-movflags +faststart'),
				container === 'mp4' || container === 'mov',
				`${label} only asks for faststart in ISO containers`,
			);
		}
	}
});

test('containerMime covers every container the studio offers', () => {
	assert.deepEqual(surgeonContainers.map((container) => containerMime(container)), [
		'video/x-matroska',
		'video/mp4',
		'video/quicktime',
		'video/webm',
		'audio/x-matroska',
	]);
	assert.equal(containerMime('avi'), 'application/octet-stream');
	assert.equal(containerMime(''), 'application/octet-stream');
	assert.equal(containerMime(undefined), 'application/octet-stream');
});

test('lossless trimming turns start and end times into a seek and a duration', () => {
	assert.deepEqual(
		buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'trim', start: '2' }),
		['-ss', '2', '-i', 'in.mkv', '-map', '0', '-c', 'copy', '-y', 'out.mkv'],
	);
	assert.deepEqual(
		buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'trim', end: '4' }),
		['-i', 'in.mkv', '-t', '4', '-map', '0', '-c', 'copy', '-y', 'out.mkv'],
	);
	assert.throws(
		() => buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'trim', start: '5', end: '2' }),
		/End time must be after start time/,
	);
	assert.throws(
		() => buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'trim', start: '3', end: '3' }),
		/End time must be after start time/,
	);
	/* Times only apply to a trim: every other operation ignores them. */
	assert.deepEqual(
		buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'remux', start: '5', end: '2' }),
		['-i', 'in.mkv', '-map', '0', '-c', 'copy', '-y', 'out.mkv'],
	);
	/* Without a replacement track the second input is never opened. */
	assert.deepEqual(
		buildLosslessArgs('in.mkv', null, 'out.mkv', { operation: 'replace' }),
		['-i', 'in.mkv', '-map', '0:v?', '-map', '1:a:0', '-map', '0:s?', '-c', 'copy', '-shortest', '-y', 'out.mkv'],
	);
	assert.deepEqual(buildLosslessArgs('in.mkv', null, 'out.mkv'), ['-i', 'in.mkv', '-map', '0', '-c', 'copy', '-y', 'out.mkv']);
});

test('gif settings clamp to the ranges the sliders expose', () => {
	assert.deepEqual(normalizeGifSettings({ start: '', duration: '', fps: '', width: '', colors: '', loop: 1 }), {
		start: 0,
		duration: 0.5,
		fps: 6,
		width: 240,
		colors: 32,
		loop: true,
	});
	assert.deepEqual(normalizeGifSettings({ start: 'x', duration: 'x', fps: 'x', width: 'x', colors: 'x', loop: 0 }, 5), {
		start: 0,
		duration: 0.5,
		fps: 6,
		width: 240,
		colors: 32,
		loop: false,
	});
	assert.deepEqual(normalizeGifSettings({ start: '0.44', duration: '3', fps: '12', width: '480', colors: '128', loop: true }, 10), {
		start: 0.4,
		duration: 3,
		fps: 12,
		width: 480,
		colors: 128,
		loop: true,
	});
	/* A clip shorter than the requested window shortens the duration instead of running past the end. */
	assert.deepEqual(normalizeGifSettings({ start: '0.4', duration: '3', fps: '24', width: '960', colors: '256', loop: true }, 1), {
		start: 0.4,
		duration: 0.6,
		fps: 24,
		width: 960,
		colors: 256,
		loop: true,
	});
	assert.equal(clamp(12, 6, 24), 12);
	assert.equal(clamp(30, 6, 24), 24);
	assert.equal(clamp(Number.POSITIVE_INFINITY, 6, 24), 6);
	assert.equal(roundToTenths(0.44), 0.4);
	assert.equal(roundToHalf(0.99), 1);
	assert.equal(roundToHalf(0.3), 0.5);
	assert.equal(roundToHalf(0.2), 0);
});

test('gif args carry the slider values into the filter chain and the loop flag', () => {
	const settings = normalizeGifSettings({ start: '0', duration: '1', fps: '6', width: '240', colors: '32', loop: true }, 1);
	const args = buildGifArgs('input.webm', 'output.gif', settings);

	assert.deepEqual(args, [
		'-ss', '0',
		'-t', '1',
		'-i', 'input.webm',
		'-filter_complex', buildGifFilter(settings),
		'-loop', '0',
		'-gifflags', '+transdiff',
		'-y', 'output.gif',
	]);
	assert.ok(buildGifFilter(settings).includes('scale=240:-1:flags=lanczos'), 'the width slider drives the scale filter');
	assert.ok(buildGifFilter(settings).includes('fps=6,'), 'the fps slider drives the fps filter');
	assert.ok(buildGifFilter(settings).includes('palettegen=max_colors=32'), 'the colors slider drives the palette size');

	const once = buildGifArgs('input.webm', 'output.gif', { ...settings, loop: false });
	assert.deepEqual(once.slice(once.indexOf('-loop'), once.indexOf('-loop') + 2), ['-loop', '-1'], 'an unchecked loop toggle writes no loop count');
});

test('a video the browser cannot read converts whole, without a seek or a duration', () => {
	const raw = { start: '2', duration: '3', fps: '6', width: '240', colors: '32', loop: true };
	/* The picker offers AVI, FLV, MKV and more; nothing but ffmpeg can measure some of them,
	   so `trim: false` drops the window the number inputs could not supply. */
	const untrimmed = normalizeGifSettings({ ...raw, trim: false });

	assert.deepEqual(untrimmed, { start: null, duration: null, fps: 6, width: 240, colors: 32, loop: true });
	assert.deepEqual(buildGifArgs('input.avi', 'output.gif', untrimmed), [
		'-i', 'input.avi',
		'-filter_complex', buildGifFilter(untrimmed),
		'-loop', '0',
		'-gifflags', '+transdiff',
		'-y', 'output.gif',
	]);
	assert.ok(!buildGifArgs('input.avi', 'output.gif', untrimmed).includes('-ss'), 'no seek without a known start');
	assert.ok(!buildGifArgs('input.avi', 'output.gif', untrimmed).includes('-t'), 'no limit without a known length');
	/* The sliders that never needed a duration keep driving the filter chain. */
	assert.ok(buildGifFilter(untrimmed).includes('fps=6,scale=240:-1:flags=lanczos'));
	assert.ok(buildGifFilter(untrimmed).includes('palettegen=max_colors=32'));
	assert.deepEqual(
		buildGifArgs('input.avi', 'output.gif', { ...untrimmed, loop: false }).slice(-6, -4),
		['-loop', '-1'],
		'the loop toggle still applies without a trim window',
	);

	/* Trimming stays on for every readable video, including when the flag is passed explicitly. */
	const trimmed = normalizeGifSettings({ ...raw, trim: true }, 10);
	assert.deepEqual(trimmed, { start: 2, duration: 3, fps: 6, width: 240, colors: 32, loop: true });
	assert.deepEqual(buildGifArgs('input.webm', 'output.gif', trimmed).slice(0, 4), ['-ss', '2', '-t', '3']);
	assert.deepEqual(normalizeGifSettings(raw, 10), trimmed, 'an absent flag keeps the trim window');
	/* A zero start is a real seek, not a missing one. */
	assert.deepEqual(
		buildGifArgs('input.webm', 'output.gif', normalizeGifSettings({ ...raw, start: '0' }, 10)).slice(0, 4),
		['-ss', '0', '-t', '3'],
	);
});

test('gif durations render as minutes and seconds', () => {
	assert.equal(formatTime(0), '0:00');
	assert.equal(formatTime(0.99), '0:01');
	assert.equal(formatTime(-5), '0:00');
	assert.equal(formatTime(59.6), '1:00');
	assert.equal(formatTime(605), '10:05');
});
