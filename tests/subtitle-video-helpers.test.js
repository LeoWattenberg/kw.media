import test from 'node:test';
import assert from 'node:assert/strict';

import {
	formatTime,
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
	planSubtitleOutput,
	softSubtitleArgs,
	subtitleStudioMime,
	subtitleStudioOutputName,
} from '../src/lib/tools/subtitle-studio.js';
import { detectCrop } from '../src/lib/tools/crop-doctor.js';
import {
	REPAIR_CONTAINERS,
	REPAIR_MODES,
	buildRepairAttempts,
} from '../src/lib/tools/delivery-doctor.js';
import { verticalCropRect } from '../src/lib/tools/vertical-reframer.js';
import {
	mixAndResampleAudio,
	parseWhisperLog,
	renderWhisperSubtitles,
	whisperSubtitleOutputName,
} from '../src/lib/tools/whisper-subtitle-generator.js';
import {
	formatBitRate,
	formatBytes,
	formatChannels,
	formatDuration,
	formatFrameRate,
	formatNumericBytes,
	formatResolution,
	formatSamplingRate,
	normalizeResult,
	trimNumber,
} from '../src/lib/tools/media-info.js';
import { baseName, fileExtension, lowerFileExtension } from '../src/lib/tools/media-file.js';

const SRT_SOURCE = '1\n00:00:00,000 --> 00:00:01,000\nFirst\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond';

/* A grey-scale stand-in for the canvas frame the crop doctor samples: `paint`
   returns the brightness of every channel at that pixel. */
const frame = (width, height, paint) => {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const index = (y * width + x) * 4;
			data[index] = data[index + 1] = data[index + 2] = paint(x, y);
			data[index + 3] = 255;
		}
	}
	return { width, height, data };
};

test('subtitle parsing rejects blocks that cannot become cues', () => {
	assert.deepEqual(parseCues(''), []);
	assert.deepEqual(parseCues('   \n\n  '), []);
	assert.deepEqual(parseCues(null), []);
	assert.deepEqual(parseCues(undefined), []);
	/* A block without an arrow is prose, not a cue, and must not become an empty subtitle. */
	assert.deepEqual(parseCues('NOTE this file was exported by hand'), []);
	assert.deepEqual(parseCues('1\nHello with no timing'), []);
	/* end <= start would produce a cue that is never on screen. */
	assert.deepEqual(parseCues('1\n00:00:02,000 --> 00:00:02,000\nZero length'), []);
	assert.deepEqual(parseCues('1\n00:00:03,000 --> 00:00:02,000\nBackwards'), []);
	/* An unparsable timestamp is dropped rather than becoming NaN seconds. */
	assert.deepEqual(parseCues('1\nlater --> soon\nBroken'), []);
});

test('subtitle parsing reads comma and dot decimals and keeps multi-line cue text', () => {
	assert.deepEqual(parseCues(SRT_SOURCE, 'srt'), [
		{ start: 0, end: 1, text: 'First' },
		{ start: 2, end: 4, text: 'Second' },
	]);
	assert.deepEqual(parseCues('1\r\n00:00:01,500 --> 00:00:02,750\r\nComma decimals\r\n'), [
		{ start: 1.5, end: 2.75, text: 'Comma decimals' },
	]);
	assert.deepEqual(parseCues('00:00:01.500 --> 00:00:02.750\nDot decimals'), [
		{ start: 1.5, end: 2.75, text: 'Dot decimals' },
	]);
	assert.deepEqual(parseCues('1\n00:00:01,000 --> 00:00:02,000\nLine one\nLine two'), [
		{ start: 1, end: 2, text: 'Line one\nLine two' },
	]);
});

test('subtitle parsing auto-detects WEBVTT and strips its header and cue settings', () => {
	const vtt = 'WEBVTT - exported\n\n00:00:01.000 --> 00:00:02.000 line:90% align:center\nAuto detected\n\n00:00:03.000 --> 00:00:04.000\nSecond';
	assert.deepEqual(parseCues(vtt, 'auto'), [
		{ start: 1, end: 2, text: 'Auto detected' },
		{ start: 3, end: 4, text: 'Second' },
	]);
	/* The explicit format must strip the header too, even when auto-detection is not asked for. */
	assert.deepEqual(parseCues('WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nExplicit', 'vtt'), [
		{ start: 5, end: 6, text: 'Explicit' },
	]);
	/* Forcing SRT on a WebVTT file keeps the header block, which simply has no arrow. */
	assert.deepEqual(parseCues('WEBVTT\n\n00:00:05.000 --> 00:00:06.000\nForced', 'srt'), [
		{ start: 5, end: 6, text: 'Forced' },
	]);
});

test('subtitle timestamps parse with and without an hour field', () => {
	assert.equal(parseTime('01:02:03.400'), 3723.4);
	assert.equal(parseTime('02:03.400'), 123.4);
	assert.equal(parseTime('00:00:01,5'), 1.5);
	assert.equal(parseTime('00:00:01'), 1);
	assert.ok(Number.isNaN(parseTime('soon')));
	assert.ok(Number.isNaN(parseTime(undefined)));
	assert.equal(formatTime(0, ','), '00:00:00,000');
	assert.equal(formatTime(3723.4, '.'), '01:02:03.400');
	assert.equal(formatTime(59.9999, ','), '00:01:00,000');
});

test('offsetCues clamps at zero and drops cues the offset pushes out of the timeline', () => {
	const cues = parseCues(SRT_SOURCE, 'srt');
	/* The editor hands the slider value through as a string. */
	assert.deepEqual(offsetCues(cues, '2.5'), [
		{ start: 2.5, end: 3.5, text: 'First' },
		{ start: 4.5, end: 6.5, text: 'Second' },
	]);
	/* -1 s clamps the first cue to 0-0, so only the second survives: the count the
	   editor shows for an offset has to come from here, not from parseCues. */
	assert.deepEqual(offsetCues(cues, -1), [{ start: 1, end: 3, text: 'Second' }]);
	assert.deepEqual(offsetCues(cues, -30), []);
	assert.deepEqual(offsetCues(cues, 0), cues);
	assert.deepEqual(offsetCues(cues, undefined), cues);
	assert.deepEqual(offsetCues(cues, ''), cues);
	assert.deepEqual(offsetCues([], -5), []);
});

test('subtitle rendering writes SRT and WebVTT bodies for every cue', () => {
	const cues = offsetCues(parseCues(SRT_SOURCE, 'srt'), 1);
	assert.equal(toSrt(cues), '1\n00:00:01,000 --> 00:00:02,000\nFirst\n\n2\n00:00:03,000 --> 00:00:05,000\nSecond\n');
	assert.equal(toVtt(cues), 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst\n\n00:00:03.000 --> 00:00:05.000\nSecond\n');
	assert.equal(toVtt([]), 'WEBVTT\n\n\n');
	/* Round-tripping through both writers must not move a cue. */
	assert.deepEqual(parseCues(toVtt(cues), 'auto'), cues);
	assert.deepEqual(parseCues(toSrt(cues), 'srt'), cues);
});

test('subtitle burner styles raw subtitle text and clamps out-of-range appearance values', () => {
	/* The burner accepts unparsed text, so the ASS build has to parse it itself. */
	const ass = buildSubtitleAss(SRT_SOURCE);
	assert.match(ass, /Style: Default,Arial,58/);
	assert.match(ass, /,2,70,70,180,1/);
	assert.match(ass, /Dialogue: 0,0:00:00\.00,0:00:01\.00,Default,,0,0,0,,First/);
	assert.match(ass, /Dialogue: 0,0:00:02\.00,0:00:04\.00,Default,,0,0,0,,Second/);
	assert.match(buildSubtitleAss([{ start: 0, end: 1, text: 'Clamped' }], { fontSize: 999, marginV: 0 }), /Style: Default,Arial,100/);
	assert.match(buildSubtitleAss([{ start: 0, end: 1, text: 'Clamped' }], { fontSize: 1, marginV: 5000 }), /Style: Default,Arial,28/);
	assert.match(buildSubtitleAss([{ start: 0, end: 1, text: 'Clamped' }], { marginV: 5000 }), /,2,70,70,600,1/);
	assert.equal(assTimestamp(-5), '0:00:00.00');
	assert.equal(assTimestamp(undefined), '0:00:00.00');
	assert.equal(subtitleOutputName(''), 'video-subtitled.mp4');
	assert.equal(subtitleOutputName(undefined), 'video-subtitled.mp4');
	assert.deepEqual(subtitleBurnerArgs('in.mp4', 'subs.ass', 'out.mp4').slice(0, 4), ['-i', 'in.mp4', '-vf', 'subtitles=subs.ass']);
});

test('subtitle studio names and types soft and hard outputs from the chosen container', () => {
	assert.equal(subtitleStudioOutputName('clip.mkv', 'soft', 'mp4'), 'clip-soft-subtitles.mp4');
	assert.equal(subtitleStudioOutputName('clip.mkv', 'hard', 'mkv'), 'clip-hard-subtitles.mp4');
	assert.equal(subtitleStudioOutputName('', 'soft'), 'media-soft-subtitles.mkv');
	assert.equal(subtitleStudioOutputName(null, 'soft', 'mp4'), 'media-soft-subtitles.mp4');
	assert.equal(subtitleStudioMime('soft', 'mp4'), 'video/mp4');
	assert.equal(subtitleStudioMime('soft'), 'video/x-matroska');
	assert.equal(subtitleStudioMime('hard', 'mkv'), 'video/mp4');
	/* Muxing into Matroska must not ask for the MP4-only mov_text codec. */
	assert.ok(!softSubtitleArgs('in.mkv', 'subs.srt', 'out.mkv').includes('mov_text'));
	assert.ok(softSubtitleArgs('in.mp4', 'subs.srt', 'out.mp4', 'mp4').includes('mov_text'));
});

test('subtitle studio plans the container, subtitle file, name, and MIME type of one run', () => {
	const cues = parseCues(SRT_SOURCE, 'srt');
	/* Soft subs keep the chosen container and are muxed from an SRT sidecar. */
	assert.deepEqual(planSubtitleOutput({ mode: 'soft', container: 'mkv', cues, name: 'clip.mp4' }), {
		mode: 'soft',
		container: 'mkv',
		subtitleFormat: 'srt',
		subtitles: toSrt(cues),
		name: 'clip-soft-subtitles.mkv',
		mime: 'video/x-matroska',
	});
	assert.deepEqual(planSubtitleOutput({ mode: 'soft', container: 'mp4', cues, name: 'clip.mkv' }), {
		mode: 'soft',
		container: 'mp4',
		subtitleFormat: 'srt',
		subtitles: toSrt(cues),
		name: 'clip-soft-subtitles.mp4',
		mime: 'video/mp4',
	});

	/* Hard subs are always burned into MP4, so the container select cannot reach the
	   output, and the appearance settings have to end up in the ASS file. */
	const hard = planSubtitleOutput({ mode: 'hard', container: 'mkv', cues, name: 'clip.mkv', style: { mode: 'karaoke', alignment: '8', fontSize: '80', marginV: '300' } });
	assert.equal(hard.mode, 'hard');
	assert.equal(hard.container, 'mp4');
	assert.equal(hard.subtitleFormat, 'ass');
	assert.equal(hard.name, 'clip-hard-subtitles.mp4');
	assert.equal(hard.mime, 'video/mp4');
	assert.match(hard.subtitles, /Style: Default,Arial,80/);
	assert.match(hard.subtitles, /,8,70,70,300,1/);
	assert.match(hard.subtitles, /Dialogue: 0,0:00:00\.00,0:00:01\.00,Default,,0,0,0,,\{\\k100\}First/);
	assert.equal(hard.subtitles, buildSubtitleAss(cues, { mode: 'karaoke', alignment: '8', fontSize: '80', marginV: '300' }));

	/* Nothing chosen yet still has to describe a writable file. */
	assert.deepEqual(planSubtitleOutput(), {
		mode: 'soft',
		container: 'mkv',
		subtitleFormat: 'srt',
		subtitles: toSrt([]),
		name: 'media-soft-subtitles.mkv',
		mime: 'video/x-matroska',
	});
});

test('whisper log parsing skips noise lines and renders both subtitle formats', () => {
	const logs = [
		'whisper_init_from_file_with_params_no_state: loading model',
		'[32m[00:00:00.000 --> 00:00:02.000][0m   Coloured output',
		'[00:00:02.000 --> 00:00:04.000]   [MUSIC]',
		'[00:00:04.000 --> 00:00:06.000]   ',
		'[00:00:06.000 --> 00:00:08.000]   Spaced    out    text',
	];
	assert.deepEqual(parseWhisperLog(logs), [
		{ start: 0, end: 2, text: 'Coloured output' },
		{ start: 6, end: 8, text: 'Spaced out text' },
	]);
	/* The worker may hand back one string instead of an array of lines. */
	assert.deepEqual(parseWhisperLog('[00:00:01.000 --> 00:00:02.000]  Single line'), [
		{ start: 1, end: 2, text: 'Single line' },
	]);
	assert.deepEqual(parseWhisperLog(''), []);
	assert.deepEqual(parseWhisperLog(null), []);
	assert.equal(renderWhisperSubtitles(logs), '1\n00:00:00,000 --> 00:00:02,000\nColoured output\n\n2\n00:00:06,000 --> 00:00:08,000\nSpaced out text\n');
	assert.match(renderWhisperSubtitles(logs, 'vtt'), /^WEBVTT\n\n00:00:00\.000 --> 00:00:02\.000\nColoured output/);
	assert.equal(whisperSubtitleOutputName('podcast.wav'), 'podcast.srt');
	assert.equal(whisperSubtitleOutputName('podcast.wav', 'vtt'), 'podcast.vtt');
	assert.equal(whisperSubtitleOutputName(''), 'generated-subtitles.srt');
	assert.equal(whisperSubtitleOutputName('clip.mp4', 'ass'), 'clip.srt');
});

test('whisper audio preparation mixes channels and resamples in both directions', () => {
	/* Two channels at 4 Hz downsampled to 2 Hz: the mix is the channel average. */
	assert.deepEqual(Array.from(mixAndResampleAudio([
		Float32Array.from([1, 1, -1, -1]),
		Float32Array.from([1, 1, 1, 1]),
	], 4, 2)), [1, 0]);
	/* Upsampling interpolates between neighbours instead of repeating samples. */
	assert.deepEqual(Array.from(mixAndResampleAudio([Float32Array.from([0, 1])], 1, 2)), [0, 0.5, 1, 1]);
	assert.deepEqual(Array.from(mixAndResampleAudio([], 48_000)), []);
	assert.deepEqual(Array.from(mixAndResampleAudio(null, 48_000)), []);
	assert.deepEqual(Array.from(mixAndResampleAudio([Float32Array.from([1])], 0)), []);
	assert.deepEqual(Array.from(mixAndResampleAudio([Float32Array.from([1])], 48_000, 0)), []);
});

test('media info formatting keeps unusable values visible instead of inventing numbers', () => {
	assert.deepEqual(normalizeResult({ media: { track: [{ '@type': 'General' }] } }), { media: { track: [{ '@type': 'General' }] } });
	assert.deepEqual(normalizeResult(undefined), { media: { track: [] } });
	assert.equal(formatResolution({ Width: '160', Height: '120' }), '160 x 120');
	assert.equal(formatResolution({ Width: '160' }), '');
	assert.equal(formatDuration(3723.5), '1:02:03.500');
	assert.equal(formatDuration(0), '');
	assert.equal(formatDuration(-3), '-3');
	assert.equal(formatBitRate(999), '1 kb/s');
	assert.equal(formatBitRate(1536), '1.54 kb/s');
	assert.equal(formatBitRate(0), '');
	assert.equal(formatFrameRate(0), '');
	assert.equal(formatChannels('stereo'), 'stereo');
	assert.equal(formatSamplingRate(0), '');
	assert.equal(formatNumericBytes(-5), '-5');
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(1024), '1 KB');
	assert.equal(trimNumber(5.678), '5.68');
	assert.equal(trimNumber(0), '0');
});

test('crop detection reports an unmeasurable frame instead of a crop at the midpoint', () => {
	/* Every sampled row and column is dark, so both scans run to the middle. Rounding
	   that meeting point used to produce a 2x2 "crop" the tool then offered to export. */
	const black = detectCrop(frame(160, 120, () => 0), 24);
	assert.equal(black.empty, true);
	assert.deepEqual(black, { x: 0, y: 0, w: 0, h: 0, empty: true });
	/* The threshold decides what counts as content: the same flat grey frame is
	   measurable below it and unmeasurable above it. */
	assert.equal(detectCrop(frame(160, 120, () => 30), 24).empty, false);
	assert.equal(detectCrop(frame(160, 120, () => 30), 40).empty, true);
	/* A frame with no pixels at all cannot be measured either. */
	assert.equal(detectCrop({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, 24).empty, true);
	assert.equal(detectCrop(undefined, 24).empty, true);

	/* Real bars on all four sides: the box has to follow the content, not the frame. */
	const boxed = detectCrop(frame(160, 120, (x, y) => (x >= 20 && x <= 139 && y >= 20 && y <= 99 ? 200 : 0)), 24);
	assert.deepEqual(boxed, { x: 20, y: 20, w: 120, h: 80, empty: false });
	/* A full-bleed frame keeps its own size, which is how the tool knows there are no
	   bars to remove and leaves the export disabled. */
	const full = detectCrop(frame(160, 120, () => 200), 24);
	assert.equal(full.empty, false);
	assert.equal(full.w, 160);
	assert.equal(full.h, 120);
});

test('a WebM repair is written with the codecs WebM accepts instead of being refused', () => {
	const names = { input: 'source.mp4', output: 'delivery.webm' };
	const map = ['-map', '0:v?', '-map', '0:a?', '-map_metadata', '0'];
	const vp9 = ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p'];
	const opus = ['-c:a', 'libopus', '-b:a', '160k', '-ar', '48000'];

	/* The web mode used to write H.264 with AAC and was turned away at the panel.
	   The container is what was asked for, so the codecs move instead. */
	assert.deepEqual(buildRepairAttempts('webm', 'web', names), [
		['-i', 'source.mp4', ...map, ...vp9, ...opus, '-y', 'delivery.webm'],
	]);

	/* The audio mode re-encodes the sound to Opus and keeps the picture as long as
	   WebM can hold it; the encode is only there for the sources it cannot. */
	assert.deepEqual(buildRepairAttempts('webm', 'audio', names), [
		['-i', 'source.mp4', ...map, '-c:v', 'copy', ...opus, '-y', 'delivery.webm'],
		['-i', 'source.mp4', ...map, ...vp9, ...opus, '-y', 'delivery.webm'],
	]);

	/* The remux stays the first thing tried, because a VP9 or VP8 source needs no
	   encoding at all to become a WebM. */
	assert.deepEqual(buildRepairAttempts('webm', 'copy', names), [
		['-i', 'source.mp4', ...map, '-c', 'copy', '-y', 'delivery.webm'],
		['-i', 'source.mp4', ...map, ...vp9, ...opus, '-y', 'delivery.webm'],
	]);

	/* WebM carries no subtitle or data streams, so the repair maps picture and
	   sound rather than handing the muxer something it has to reject. */
	assert.equal(buildRepairAttempts('WebM ', 'web', names)[0].includes('-c:s'), false);
	assert.deepEqual(buildRepairAttempts('WebM ', 'web', names), buildRepairAttempts('webm', 'web', names));
});

test('MP4, MOV, and MKV repairs keep H.264 with AAC and the faststart the container needs', () => {
	const map = ['-map', '0', '-map_metadata', '0'];
	const h264 = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
	const aac = ['-c:a', 'aac', '-b:a', '160k'];

	assert.deepEqual(buildRepairAttempts('mp4', 'web', { input: 'in.mkv', output: 'out.mp4' }), [
		['-i', 'in.mkv', ...map, ...h264, ...aac, '-movflags', '+faststart', '-y', 'out.mp4'],
	]);
	assert.deepEqual(buildRepairAttempts('mkv', 'audio', { input: 'in.mp4', output: 'out.mkv' }), [
		['-i', 'in.mp4', ...map, '-c:v', 'copy', ...aac, '-c:s', 'copy', '-y', 'out.mkv'],
		['-i', 'in.mp4', ...map, ...h264, ...aac, '-y', 'out.mkv'],
	]);
	assert.deepEqual(buildRepairAttempts('mov', 'copy', { input: 'in.mp4', output: 'out.mov' }), [
		['-i', 'in.mp4', ...map, '-c', 'copy', '-movflags', '+faststart', '-y', 'out.mov'],
		['-i', 'in.mp4', ...map, ...h264, ...aac, '-movflags', '+faststart', '-y', 'out.mov'],
	]);
	/* Matroska needs no faststart; only the two ISO base media containers get it. */
	assert.equal(buildRepairAttempts('mkv', 'copy', { input: 'in.mp4', output: 'out.mkv' })[0].includes('-movflags'), false);
	/* A container the panel never offers still gets the widely supported plan. */
	assert.deepEqual(buildRepairAttempts('m2ts', 'web', { input: 'in.mp4', output: 'out.m2ts' }), [
		['-i', 'in.mp4', ...map, ...h264, ...aac, '-y', 'out.m2ts'],
	]);
});

test('every container and repair mode the delivery panel offers ends in a file', () => {
	assert.deepEqual(REPAIR_CONTAINERS.map((container) => container.value), ['mp4', 'mkv', 'mov', 'webm']);
	assert.deepEqual(REPAIR_MODES, ['copy', 'audio', 'web']);
	const valueAfter = (args, flag) => args[args.indexOf(flag) + 1];

	for (const { value: container } of REPAIR_CONTAINERS) {
		for (const mode of REPAIR_MODES) {
			const attempts = buildRepairAttempts(container, mode, { input: 'in.bin', output: `out.${container}` });
			assert.ok(attempts.length >= 1, `${container}/${mode} has no plan`);
			for (const args of attempts) {
				assert.deepEqual(args.slice(0, 2), ['-i', 'in.bin']);
				assert.deepEqual(args.slice(-2), ['-y', `out.${container}`]);
			}

			/* Whatever the source turns out to hold, the last attempt encodes both
			   streams, so the requested container is always the one that comes back. */
			const last = attempts.at(-1);
			assert.notEqual(valueAfter(last, '-c:v'), 'copy');
			assert.notEqual(valueAfter(last, '-c:a'), 'copy');
			assert.equal(last.includes('-c'), false);

			/* And nothing asks a muxer for a codec family it cannot hold. */
			const flat = attempts.flat().join(' ');
			if (container === 'webm') {
				assert.equal(/libx264|aac/.test(flat), false, `${mode} writes an MP4 codec into WebM`);
				assert.match(flat, /libvpx-vp9/);
				assert.match(flat, /libopus/);
			} else {
				assert.equal(/libvpx|libopus/.test(flat), false, `${mode} writes a WebM codec into ${container}`);
				assert.match(flat, /libx264/);
			}
		}
	}
});

test('vertical crop rects fit the preset and reject streams without dimensions', () => {
	/* An audio-only or broken file reports no dimensions; `crop=0:0:0:0` is not a filter. */
	assert.equal(verticalCropRect(0, 0, '9:16'), null);
	assert.equal(verticalCropRect(0, 1080, '9:16'), null);
	assert.equal(verticalCropRect(1920, 0, '9:16'), null);
	assert.equal(verticalCropRect(undefined, undefined, '9:16'), null);
	assert.equal(verticalCropRect(1920, 1080, 'square'), null);
	assert.equal(verticalCropRect(1920, 1080, '9:0'), null);

	/* 9:16 out of a landscape frame is as tall as the source and centred on the face. */
	assert.deepEqual(verticalCropRect(1920, 1080, '9:16', 0.5), { x: 656, y: 0, w: 608, h: 1080 });
	assert.deepEqual(verticalCropRect(1920, 1080, '1:1', 0.5), { x: 420, y: 0, w: 1080, h: 1080 });
	assert.deepEqual(verticalCropRect(1920, 1080, '4:5', 0.5), { x: 528, y: 0, w: 864, h: 1080 });
	/* The crop centre is clamped inside the frame at both ends. */
	assert.deepEqual(verticalCropRect(1920, 1080, '9:16', 0), { x: 0, y: 0, w: 608, h: 1080 });
	assert.deepEqual(verticalCropRect(1920, 1080, '9:16', 1), { x: 1312, y: 0, w: 608, h: 1080 });
	assert.deepEqual(verticalCropRect(1920, 1080, '9:16', NaN), { x: 656, y: 0, w: 608, h: 1080 });
	/* A source that is already 9:16 is cropped in full, and a wide 1:1 keeps its height. */
	assert.deepEqual(verticalCropRect(720, 1280, '9:16', 0.5), { x: 0, y: 0, w: 720, h: 1280 });
	assert.deepEqual(verticalCropRect(160, 120, '1:1', 0.5), { x: 20, y: 0, w: 120, h: 120 });
});

test('media file names survive dots, missing extensions, and empty input', () => {
	/* baseName feeds the MediaInfo JSON report download name. */
	assert.equal(baseName('clip.final.mp4'), 'clip.final');
	assert.equal(baseName('noextension'), 'noextension');
	assert.equal(baseName('.gitignore', 'media'), 'media');
	assert.equal(baseName('', 'media'), 'media');
	assert.equal(baseName(null, 'media'), 'media');
	assert.equal(baseName('clip.mp4'), 'clip');
	assert.equal(fileExtension('clip.final.MOV'), '.MOV');
	assert.equal(fileExtension('noextension'), '.bin');
	assert.equal(lowerFileExtension('clip.final.MOV'), '.mov');
	assert.equal(lowerFileExtension('archive.tar.gz', '.zip'), '.gz');
});
