import test from 'node:test';
import assert from 'node:assert/strict';

import {
	DEFAULT_MORPH_SETTINGS,
	MORPH_BACKGROUNDS,
	MORPH_EASINGS,
	MORPH_FRAME_RATES,
	MORPH_OUTPUT_FORMATS,
	MORPH_SIZES,
	TRANSPARENT_INK_FLOOR,
	buildMorphLayers,
	buildMorphVideoArgs,
	buildTimeline,
	easingFunction,
	estimateBackground,
	evenSize,
	fitContain,
	frameFileName,
	framePattern,
	hexToRgb,
	inkMap,
	morphOutputName,
	morphTimeline,
	normalizeHexColor,
	normalizeMorphSettings,
	outputDimensions,
	outputFormat,
	renderMorphFrame,
	signedDistanceField,
	squaredDistanceTransform,
} from '../src/lib/tools/image-morph.js';
import {
	DEFAULT_MORPH_SETTINGS as SVG_DEFAULTS,
	MORPH_EASINGS as SVG_EASINGS,
	MORPH_FRAME_RATES as SVG_FRAME_RATES,
	MORPH_OUTPUT_FORMATS as SVG_FORMATS,
	buildMorphVideoArgs as buildSvgVideoArgs,
	morphOutputName as svgOutputName,
	morphTimeline as svgTimeline,
	normalizeMorphSettings as normalizeSvgSettings,
} from '../src/lib/tools/svg-morph.js';

/* An RGBA raster painted by a callback that returns [r, g, b] or [r, g, b, a] for every pixel. */
const raster = (width, height, paint) => {
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const pixel = paint(x, y);
			const offset = (y * width + x) * 4;
			data[offset] = pixel[0];
			data[offset + 1] = pixel[1];
			data[offset + 2] = pixel[2];
			data[offset + 3] = pixel[3] ?? 255;
		}
	}
	return data;
};

const inBox = (x, y, [left, top, width, height]) => x >= left && x < left + width && y >= top && y < top + height;
const WHITE = [255, 255, 255];
const BLACK = [0, 0, 0];
const GREY = [128, 128, 128];
const CLEAR = [0, 0, 0, 0];
const pixelAt = (frame, width, x, y) => [...frame.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} is not within ${tolerance} of ${expected}`);

/*
 * The two morph tools are siblings: same interpolation styles, frame rates, timeline, output formats
 * and encoder arguments, so a creator who learned one knows the other. This is the check that keeps
 * them in step when either side changes.
 */
test('image morph shares its interpolation styles, frame rates and output formats with SVG Morph', () => {
	assert.deepEqual(MORPH_EASINGS.map((easing) => easing.id), SVG_EASINGS.map((easing) => easing.id));
	for (const { id, ease } of MORPH_EASINGS) {
		const theirs = SVG_EASINGS.find((easing) => easing.id === id).ease;
		for (let step = 0; step <= 40; step += 1) {
			near(ease(step / 40), theirs(step / 40), 1e-12, `${id} at ${step / 40}`);
		}
	}
	assert.deepEqual(MORPH_FRAME_RATES, SVG_FRAME_RATES);

	/* SVG Morph's alpha formats come first and unchanged; the opaque MP4 is the one addition. */
	const shared = ({ id, extension, mime, codec, playable }) => ({ id, extension, mime, codec, playable });
	assert.deepEqual(MORPH_OUTPUT_FORMATS.slice(0, SVG_FORMATS.length).map(shared), SVG_FORMATS.map(shared));
	assert.ok(MORPH_OUTPUT_FORMATS.slice(0, SVG_FORMATS.length).every((format) => format.alpha));
	assert.deepEqual(MORPH_OUTPUT_FORMATS.slice(SVG_FORMATS.length).map((format) => format.id), ['mp4-h264']);
	assert.equal(outputFormat('mp4-h264').alpha, false);

	const options = { fps: 25, framePattern: 'f-%05d.png', outputName: 'out.mov' };
	for (const format of SVG_FORMATS) {
		assert.deepEqual(buildMorphVideoArgs(format.id, options), buildSvgVideoArgs(format.id, options), `${format.id} arguments`);
	}

	for (const key of ['holdStart', 'holdEnd', 'duration', 'fps', 'easing', 'format']) {
		assert.equal(DEFAULT_MORPH_SETTINGS[key], SVG_DEFAULTS[key], `default ${key}`);
	}

	const raw = { holdStart: 1, duration: 1, holdEnd: 0.4, fps: 25, easing: 'snap' };
	const mine = morphTimeline(normalizeMorphSettings(raw));
	const theirs = svgTimeline(normalizeSvgSettings(raw));
	assert.equal(mine.frameCount, theirs.frameCount);
	assert.equal(mine.totalDuration, theirs.totalDuration);
	assert.equal(mine.loopDuration, theirs.loopDuration);
	for (let frame = 0; frame < mine.frameCount; frame += 1) {
		near(mine.progressAt(frame), theirs.progressAt(frame), 1e-12, `frame ${frame}`);
	}
	for (let tenth = 0; tenth <= 24; tenth += 1) {
		near(mine.progressAtTime(tenth / 10), theirs.progressAtTime(tenth / 10), 1e-12, `time ${tenth / 10}`);
	}

	assert.equal(morphOutputName('Logo A.png', 'Logo B.jpg', 'webm-vp8'), svgOutputName('Logo A.svg', 'Logo B.svg', 'webm-vp8'));
});

test('easing styles pin both ends and the monotonic ones never run backwards', () => {
	for (const { id, ease } of MORPH_EASINGS) {
		near(ease(0), 0, 1e-9, `${id} starts at 0`);
		near(ease(1), 1, 1e-9, `${id} ends at 1`);
	}
	assert.equal(easingFunction('linear')(0.5), 0.5);
	assert.equal(easingFunction('ease-in')(0.5), 0.125);
	assert.equal(easingFunction('ease-out')(0.5), 0.875);
	assert.equal(easingFunction('snap')(0.5), 0.5);
	assert.ok(easingFunction('overshoot')(0.7) > 1);
	assert.ok(easingFunction('anticipate')(0.2) < 0);
	assert.equal(easingFunction('unknown'), MORPH_EASINGS[0].ease);

	for (const id of ['linear', 'ease-in-out', 'gentle', 'ease-in', 'ease-out', 'ease-in-fast', 'ease-out-fast', 'snap']) {
		const ease = easingFunction(id);
		let previous = 0;
		for (let step = 1; step <= 100; step += 1) {
			const value = ease(step / 100);
			assert.ok(value >= previous - 1e-12, `${id} is monotonic`);
			previous = value;
		}
	}
});

test('morph settings clamp every control, snap the frame rate and fall back to the defaults', () => {
	assert.deepEqual(normalizeMorphSettings({}), DEFAULT_MORPH_SETTINGS);
	assert.deepEqual(normalizeMorphSettings({
		holdStart: -3, holdEnd: '99', duration: 0, fps: '29', easing: 'nope', format: 'gif', levels: 12, size: 4000, background: 'paper', color: 'red', loop: 'yes',
	}), {
		holdStart: 0, holdEnd: 10, duration: 0.1, fps: 30, easing: DEFAULT_MORPH_SETTINGS.easing, format: DEFAULT_MORPH_SETTINGS.format,
		levels: 8, size: 1920, background: 'transparent', color: '#ffffff', loop: true,
	});
	assert.equal(normalizeMorphSettings({ fps: '59' }).fps, 60);
	assert.equal(normalizeMorphSettings({ fps: 'abc' }).fps, 30);
	assert.equal(normalizeMorphSettings({ holdStart: 1.234 }).holdStart, 1.23);
	assert.equal(normalizeMorphSettings({ easing: 'snap', format: 'webm-vp8' }).easing, 'snap');
	assert.equal(normalizeMorphSettings({ format: 'mp4-h264' }).format, 'mp4-h264');
	assert.deepEqual(normalizeMorphSettings({ size: 479, levels: '2', background: 'color', color: '#ABC' }), {
		...DEFAULT_MORPH_SETTINGS, size: 480, levels: 2, background: 'color', color: '#aabbcc',
	});

	assert.equal(normalizeHexColor('#FFF'), '#ffffff');
	assert.equal(normalizeHexColor(' #1A2b3C '), '#1a2b3c');
	assert.equal(normalizeHexColor('blue', '#000000'), '#000000');
	assert.deepEqual(hexToRgb('#102030'), [16, 32, 48]);
	assert.equal(evenSize(1), 2);
	assert.equal(evenSize(479), 480);
	assert.deepEqual(MORPH_SIZES, [360, 480, 720, 1080]);
	assert.deepEqual(MORPH_BACKGROUNDS, ['transparent', 'source', 'color']);
});

test('the timeline counts hold and morph frames and only comes back when asked to loop', () => {
	const settings = normalizeMorphSettings({ holdStart: 1, duration: 1, holdEnd: 0.4, fps: 25, easing: 'linear' });
	const timeline = morphTimeline(settings);
	assert.equal(timeline.startFrames, 25);
	assert.equal(timeline.morphFrames, 25);
	assert.equal(timeline.endFrames, 10);
	assert.equal(timeline.backFrames, 0);
	assert.equal(timeline.frameCount, 60);
	assert.equal(timeline.totalDuration, 2.4);
	assert.equal(timeline.loopDuration, 2.4);
	assert.equal(timeline.progressAt(24), 0);
	assert.equal(timeline.progressAt(25), 0);
	assert.equal(timeline.progressAt(37), 0.5);
	assert.equal(timeline.progressAt(49), 1);
	assert.equal(timeline.progressAt(59), 1);
	assert.equal(timeline.progressAtTime(0.5), 0);
	assert.equal(timeline.progressAtTime(1.5), 0.5);
	assert.equal(timeline.progressAtTime(9), 1);

	const frames = buildTimeline(settings);
	assert.equal(frames.length, 60);
	assert.equal(frames[0], 0);
	near(frames[37], 0.5, 1e-6, 'middle frame');
	assert.equal(frames[59], 1);
	for (let index = 1; index < frames.length; index += 1) assert.ok(frames[index] >= frames[index - 1], 'a plain morph never runs backwards');

	/* Looping mirrors the morph after the end hold and wraps, so the clip repeats without a cut. */
	const loop = morphTimeline(normalizeMorphSettings({ holdStart: 1, duration: 1, holdEnd: 0.4, fps: 25, easing: 'linear', loop: true }));
	assert.equal(loop.backFrames, 25);
	assert.equal(loop.frameCount, 85);
	assert.equal(loop.totalDuration, 3.4);
	assert.equal(loop.loopDuration, 3.4);
	assert.equal(loop.progressAt(59), 1);
	assert.equal(loop.progressAt(60), 1);
	near(loop.progressAt(72), 0.5, 1e-12, 'middle of the way back');
	assert.equal(loop.progressAt(84), 0);
	assert.equal(loop.progressAt(99), 0);
	near(loop.progressAtTime(2.9), 0.5, 1e-9, 'halfway back');
	near(loop.progressAtTime(3.4), 0, 1e-9, 'the wrap lands on the first picture');
	near(loop.progressAtTime(-0.5), 0.5, 1e-9, 'negative time wraps into the way back');
	near(loop.progressAtTime(1.5), 0.5, 1e-9, 'halfway out');

	/* The style shapes the morph frames only, never the holds, and a morph is at least two frames long. */
	const eased = morphTimeline(normalizeMorphSettings({ holdStart: 0, duration: 1, holdEnd: 0, fps: 25, easing: 'ease-in' }));
	assert.equal(eased.frameCount, 25);
	assert.equal(eased.progressAt(12), 0.125);
	assert.equal(eased.progressAt(24), 1);
	assert.equal(morphTimeline(normalizeMorphSettings({ duration: 0.1, fps: 24 })).morphFrames, 2);
});

test('the frame holds both pictures at the chosen long edge, even-sized and centred', () => {
	assert.deepEqual(outputDimensions({ width: 1600, height: 900 }, { width: 900, height: 1600 }, 720), { width: 720, height: 720 });
	assert.deepEqual(outputDimensions({ width: 400, height: 300 }, { width: 800, height: 600 }, 360), { width: 360, height: 270 });
	assert.deepEqual(outputDimensions({ width: 100, height: 75 }, { width: 100, height: 75 }, 101), { width: 102, height: 76 });
	assert.deepEqual(outputDimensions({ width: 0, height: 0 }, { width: 10, height: 5 }, 100), { width: 100, height: 50 });

	assert.deepEqual(fitContain(200, 100, 100, 100), { x: 0, y: 25, width: 100, height: 50 });
	assert.deepEqual(fitContain(100, 200, 100, 100), { x: 25, y: 0, width: 50, height: 100 });
	assert.deepEqual(fitContain(10, 10, 100, 50), { x: 25, y: 0, width: 50, height: 50 });
	assert.deepEqual(fitContain(0, 0, 8, 8), { x: 4, y: 4, width: 1, height: 1 });
});

test('signed distance fields are euclidean, negative inside and positive outside', () => {
	const width = 8;
	const height = 6;
	const point = new Uint8Array(width * height);
	point[2 * width + 3] = 1;
	const squared = squaredDistanceTransform(point, width, height);
	assert.equal(squared[2 * width + 3], 0);
	assert.equal(squared[2 * width + 6], 9);
	assert.equal(squared[5 * width + 7], 25);
	assert.equal(squared[0], 13);

	const box = [2, 1, 4, 4];
	const mask = new Uint8Array(10 * 8);
	for (let y = 0; y < 8; y += 1) for (let x = 0; x < 10; x += 1) mask[y * 10 + x] = inBox(x, y, box) ? 1 : 0;
	const field = signedDistanceField(mask, 10, 8);
	assert.equal(field[2 * 10 + 3], -2);
	assert.equal(field[1 * 10 + 2], -1);
	near(field[0], Math.sqrt(5), 1e-6, 'corner outside the box');
	assert.equal(field[7 * 10 + 9], 5);

	/* Nothing to measure against: the limit stands in for infinity so blends stay finite. */
	assert.ok(signedDistanceField(new Uint8Array(12), 4, 3, 7).every((value) => value === 7));
	assert.ok(signedDistanceField(new Uint8Array(12).fill(1), 4, 3, 7).every((value) => value === -7));
});

test('the background is the colour the border mostly is, unless the border is see-through', () => {
	const logo = raster(20, 20, (x, y) => (x === 0 && y === 0 ? [255, 0, 0] : inBox(x, y, [5, 5, 10, 10]) ? BLACK : WHITE));
	assert.deepEqual(estimateBackground(logo, 20, 20), WHITE);

	const dark = raster(4, 4, (x, y) => (inBox(x, y, [1, 1, 2, 2]) ? [250, 250, 250] : [20, 24, 28]));
	assert.deepEqual(estimateBackground(dark, 4, 4), [20, 24, 28]);

	/* Slightly noisy borders still agree on one bin, and the answer is that bin's real mean. */
	const noisy = raster(20, 20, (x, y) => (inBox(x, y, [1, 1, 18, 18]) ? BLACK : [200 + (x % 2), 200, 200 - (y % 2)]));
	const background = estimateBackground(noisy, 20, 20);
	assert.ok(background[0] >= 200 && background[0] <= 201);
	assert.equal(background[1], 200);
	assert.ok(background[2] >= 199 && background[2] <= 200);

	const cutout = raster(20, 20, (x, y) => (inBox(x, y, [5, 5, 10, 10]) ? BLACK : CLEAR));
	assert.equal(estimateBackground(cutout, 20, 20), null);
	assert.equal(estimateBackground(new Uint8ClampedArray(0), 0, 0), null);
});

test('ink measures distance from the reference colour and scales to the strongest ink in the picture', () => {
	const two = raster(10, 10, (x, y) => (inBox(x, y, [1, 1, 4, 4]) ? BLACK : inBox(x, y, [6, 6, 4, 4]) ? GREY : WHITE));
	const ink = inkMap(two, 10, 10, WHITE);
	assert.equal(ink[2 * 10 + 2], 1);
	near(ink[7 * 10 + 7], 127 / 255, 0.01, 'grey ink');
	assert.equal(ink[0], 0);

	/* A mid-grey logo is as solid as a black one: the picture's own strongest ink counts as full. */
	const grey = raster(10, 10, (x, y) => (inBox(x, y, [2, 2, 6, 6]) ? GREY : WHITE));
	assert.equal(inkMap(grey, 10, 10, WHITE)[5 * 10 + 5], 1);

	assert.ok(inkMap(raster(6, 6, () => WHITE), 6, 6, WHITE).every((value) => value === 0));

	/* Transparency thins the ink: a half-transparent black pixel is half as deep as an opaque one. */
	const faded = raster(10, 10, (x, y) => (inBox(x, y, [1, 1, 4, 4]) ? BLACK : x === 8 && y === 8 ? [0, 0, 0, 128] : CLEAR));
	const fadedInk = inkMap(faded, 10, 10, WHITE);
	assert.equal(fadedInk[2 * 10 + 2], 1);
	near(fadedInk[8 * 10 + 8], 0.5, 0.01, 'half-transparent ink');
	assert.equal(fadedInk[0], 0);

	/* A white logo on nothing has no colour distance at all; the alpha floor keeps it solid. */
	const white = raster(10, 10, (x, y) => (inBox(x, y, [2, 2, 6, 6]) ? WHITE : CLEAR));
	assert.equal(inkMap(white, 10, 10, WHITE)[5 * 10 + 5], 0);
	assert.equal(inkMap(white, 10, 10, WHITE, { alphaFloor: TRANSPARENT_INK_FLOOR })[5 * 10 + 5], 1);
	const mixed = raster(10, 10, (x, y) => (inBox(x, y, [1, 1, 4, 4]) ? BLACK : inBox(x, y, [6, 6, 4, 4]) ? WHITE : CLEAR));
	const mixedInk = inkMap(mixed, 10, 10, WHITE, { alphaFloor: TRANSPARENT_INK_FLOOR });
	assert.equal(mixedInk[2 * 10 + 2], 1);
	near(mixedInk[7 * 10 + 7], TRANSPARENT_INK_FLOOR, 0.01, 'white ink on nothing');
	assert.equal(mixedInk[0], 0);
});

test('layers nest from light to dark and carry the colour of the band each one adds', () => {
	const width = 16;
	const tones = raster(width, width, (x, y) => (inBox(x, y, [5, 5, 6, 6]) ? BLACK : inBox(x, y, [2, 2, 12, 12]) ? GREY : WHITE));
	const { layers, background, backgroundAlpha } = buildMorphLayers(tones, width, width, { levels: 2, background: WHITE });

	assert.deepEqual(background, WHITE);
	assert.equal(backgroundAlpha, 1);
	assert.equal(layers.length, 2);
	assert.equal(layers[0].pixels, 144);
	assert.equal(layers[1].pixels, 36);
	assert.deepEqual(layers[0].color, GREY);
	assert.deepEqual(layers[1].color, BLACK);
	/* Six pixels deep in the grey, but the far field caps every distance at a quarter of the long edge. */
	assert.equal(layers[0].sdf[7 * width + 7], -4);
	assert.equal(layers[1].sdf[7 * width + 7], -3);
	near(layers[0].sdf[0], Math.sqrt(8), 1e-6, 'corner pixel outside the grey');
	for (let index = 0; index < width * width; index += 1) {
		assert.ok(layers[0].sdf[index] <= layers[1].sdf[index], 'the deeper layer sits inside the lighter one');
	}

	/* Pure black on white has no in-between band: every level is the same silhouette in black. */
	const flat = raster(width, width, (x, y) => (inBox(x, y, [4, 4, 8, 8]) ? BLACK : WHITE));
	const flatLayers = buildMorphLayers(flat, width, width, { levels: 3, background: WHITE }).layers;
	assert.equal(flatLayers.length, 3);
	for (const layer of flatLayers) {
		assert.equal(layer.pixels, 64);
		assert.deepEqual(layer.color, BLACK);
	}

	/* An empty picture is all far field, painted in the background colour. */
	const empty = buildMorphLayers(raster(width, width, () => WHITE), width, width, { levels: 2, background: WHITE }).layers;
	assert.equal(empty.length, 2);
	for (const layer of empty) {
		assert.equal(layer.pixels, 0);
		assert.deepEqual(layer.color, WHITE);
		assert.ok(layer.sdf.every((value) => value === 4));
	}

	assert.equal(buildMorphLayers(flat, width, width, { levels: 0.2, background: WHITE }).layers.length, 1);

	/* Ink can be measured against one colour while another is painted behind the layers. */
	const knockedOut = buildMorphLayers(flat, width, width, { levels: 1, background: [10, 20, 30], backgroundAlpha: 0, reference: WHITE });
	assert.deepEqual(knockedOut.background, [10, 20, 30]);
	assert.equal(knockedOut.backgroundAlpha, 0);
	assert.equal(knockedOut.layers[0].pixels, 64);
	assert.deepEqual(knockedOut.layers[0].color, BLACK);
	assert.equal(buildMorphLayers(flat, width, width, { backgroundAlpha: 7 }).backgroundAlpha, 1);
});

test('a morph frame reproduces each picture at its ends and blends the silhouettes between them', () => {
	const width = 16;
	const first = buildMorphLayers(raster(width, width, (x, y) => (inBox(x, y, [2, 4, 8, 8]) ? BLACK : WHITE)), width, width, { levels: 1, background: WHITE });
	const second = buildMorphLayers(raster(width, width, (x, y) => (inBox(x, y, [6, 4, 8, 8]) ? BLACK : WHITE)), width, width, { levels: 1, background: WHITE });
	const out = new Uint8ClampedArray(width * width * 4);

	renderMorphFrame(first, second, 0, out);
	assert.deepEqual(pixelAt(out, width, 3, 7), [0, 0, 0, 255]);
	assert.deepEqual(pixelAt(out, width, 2, 4), [0, 0, 0, 255]);
	assert.deepEqual(pixelAt(out, width, 1, 4), [255, 255, 255, 255]);
	assert.deepEqual(pixelAt(out, width, 12, 7), [255, 255, 255, 255]);
	assert.deepEqual(pixelAt(out, width, 0, 0), [255, 255, 255, 255]);

	renderMorphFrame(first, second, 1, out);
	assert.deepEqual(pixelAt(out, width, 3, 7), [255, 255, 255, 255]);
	assert.deepEqual(pixelAt(out, width, 12, 7), [0, 0, 0, 255]);

	/* Halfway, the overlap is solid, the far sides are clear and each picture's own side is a soft edge. */
	renderMorphFrame(first, second, 0.5, out);
	assert.deepEqual(pixelAt(out, width, 7, 7), [0, 0, 0, 255]);
	assert.deepEqual(pixelAt(out, width, 0, 7), [255, 255, 255, 255]);
	assert.deepEqual(pixelAt(out, width, 15, 7), [255, 255, 255, 255]);
	const left = pixelAt(out, width, 3, 7);
	assert.ok(left[0] > 0 && left[0] < 255, 'the first picture is on its way out');
	near(left[0], 191, 1, 'quarter coverage');
	assert.deepEqual(pixelAt(out, width, 12, 7), left);
	for (let index = 3; index < out.length; index += 4) assert.equal(out[index], 255);

	/* Overshooting styles push the blend past the second picture instead of failing on it. */
	renderMorphFrame(first, second, easingFunction('overshoot')(0.7), out);
	assert.deepEqual(pixelAt(out, width, 12, 7), [0, 0, 0, 255]);
	for (let index = 3; index < out.length; index += 4) assert.equal(out[index], 255);

	/* Backgrounds blend too, and a layer count mismatch paints what both pictures share. */
	const plain = new Uint8ClampedArray(8);
	renderMorphFrame(
		{ width: 2, height: 1, background: [200, 100, 0], layers: [] },
		{ width: 2, height: 1, background: [0, 100, 200], layers: first.layers },
		0.5,
		plain,
	);
	assert.deepEqual([...plain], [100, 100, 100, 255, 100, 100, 100, 255]);
});

test('a transparent background leaves alpha behind the ink, and flattening paints it back in', () => {
	const width = 16;
	const paint = (x, y) => (inBox(x, y, [2, 4, 8, 8]) ? BLACK : WHITE);
	const knockedOut = buildMorphLayers(raster(width, width, paint), width, width, { levels: 1, background: WHITE, backgroundAlpha: 0 });
	const opaque = buildMorphLayers(raster(width, width, paint), width, width, { levels: 1, background: WHITE });
	const out = new Uint8ClampedArray(width * width * 4);

	renderMorphFrame(knockedOut, knockedOut, 0.5, out);
	assert.deepEqual(pixelAt(out, width, 3, 7), [0, 0, 0, 255]);
	/* The paper is gone, but its colour stays under the zero alpha for readers that ignore alpha. */
	assert.deepEqual(pixelAt(out, width, 12, 7), [255, 255, 255, 0]);

	/* Ink on nothing morphing into ink on paper: the paper fades in with the second picture. */
	renderMorphFrame(knockedOut, opaque, 0.5, out);
	assert.deepEqual(pixelAt(out, width, 3, 7), [0, 0, 0, 255]);
	assert.deepEqual(pixelAt(out, width, 12, 7), [255, 255, 255, 128]);

	/* A soft edge over nothing keeps its ink colour and carries the coverage in alpha instead. */
	const shifted = buildMorphLayers(raster(width, width, (x, y) => (inBox(x, y, [6, 4, 8, 8]) ? BLACK : WHITE)), width, width, { levels: 1, background: WHITE, backgroundAlpha: 0 });
	renderMorphFrame(knockedOut, shifted, 0.5, out);
	const edge = pixelAt(out, width, 3, 7);
	assert.deepEqual(edge.slice(0, 3), [0, 0, 0]);
	near(edge[3], 64, 1, 'quarter coverage as alpha');

	/* Containers without alpha get the frame composited onto the background colour. */
	renderMorphFrame(knockedOut, shifted, 0.5, out, { flatten: true });
	assert.deepEqual(pixelAt(out, width, 12, 7), pixelAt(out, width, 3, 7));
	near(pixelAt(out, width, 3, 7)[0], 191, 1, 'flattened quarter coverage');
	assert.deepEqual(pixelAt(out, width, 0, 7), [255, 255, 255, 255]);
	for (let index = 3; index < out.length; index += 4) assert.equal(out[index], 255);
});

test('FFmpeg reads the numbered frames at the clip frame rate and encodes the chosen container', () => {
	assert.equal(frameFileName('morph-1-', 7), 'morph-1-00007.png');
	assert.equal(framePattern('morph-1-'), 'morph-1-%05d.png');

	const options = { fps: 30, framePattern: 'f-%05d.png', outputName: 'out.mov' };
	const prores = buildMorphVideoArgs('prores-4444', options);
	assert.deepEqual(prores.slice(0, 4), ['-framerate', '30', '-i', 'f-%05d.png']);
	assert.deepEqual(prores.slice(-4), ['-r', '30', '-y', 'out.mov']);
	assert.ok(prores.includes('prores_ks') && prores.includes('4444') && prores.includes('yuva444p10le'));
	assert.ok(buildMorphVideoArgs('qt-animation', options).includes('qtrle'));
	assert.ok(buildMorphVideoArgs('png-mov', options).includes('rgba'));
	const webm = buildMorphVideoArgs('webm-vp8', { ...options, outputName: 'out.webm' });
	assert.ok(webm.includes('libvpx') && webm.includes('yuva420p'));

	/* MP4 is the opaque one: H.264 in 4:2:0 with the moov atom up front for streaming. */
	const mp4 = buildMorphVideoArgs('mp4-h264', { ...options, fps: 24, outputName: 'out.mp4' });
	assert.equal(mp4[1], '24');
	assert.ok(mp4.includes('libx264') && mp4.includes('yuv420p') && mp4.includes('+faststart') && !mp4.includes('yuva420p'));
	assert.deepEqual(mp4.slice(-2), ['-y', 'out.mp4']);
	assert.ok(buildMorphVideoArgs('gif', options).includes('prores_ks'));

	assert.equal(outputFormat('unknown').id, 'prores-4444');
	assert.equal(outputFormat('webm-vp8').mime, 'video/webm');
	assert.equal(outputFormat('mp4-h264').mime, 'video/mp4');
	assert.deepEqual(MORPH_OUTPUT_FORMATS.filter((format) => format.playable).map((format) => format.id), ['webm-vp8', 'mp4-h264']);

	assert.equal(morphOutputName('cell.png', 'neuron.jpg', 'mp4-h264'), 'cell-to-neuron.mp4');
	assert.equal(morphOutputName('Logo A.png', 'Logo B.jpg', 'webm-vp8'), 'logo-a-to-logo-b.webm');
	assert.equal(morphOutputName('', undefined, 'qt-animation'), 'image-a-to-image-b.mov');
	assert.equal(morphOutputName('Grün & Blau.png', 'x.PNG', 'prores-4444'), 'grün-blau-to-x.mov');
	assert.equal(morphOutputName('a.b.c.png', 'd.png', 'gif'), 'a-b-c-to-d.mov');
});
