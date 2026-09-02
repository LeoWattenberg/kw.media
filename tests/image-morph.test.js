import test from 'node:test';
import assert from 'node:assert/strict';

import {
	EASING_IDS,
	MORPH_FORMATS,
	MORPH_FRAME_RATES,
	MORPH_SIZES,
	buildMorphLayers,
	buildMorphVideoArgs,
	buildTimeline,
	ease,
	estimateBackground,
	evenSize,
	fitContain,
	frameFileName,
	framePattern,
	hexToRgb,
	inkMap,
	morphFormat,
	morphOutputName,
	morphProgress,
	normalizeHexColor,
	normalizeMorphSettings,
	outputDimensions,
	renderMorphFrame,
	signedDistanceField,
	squaredDistanceTransform,
	timelineDuration,
} from '../src/lib/tools/image-morph.js';

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
const pixelAt = (frame, width, x, y) => [...frame.subarray((y * width + x) * 4, (y * width + x) * 4 + 4)];
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} is not within ${tolerance} of ${expected}`);

test('easing styles start on the first picture, end on the second, and never run backwards', () => {
	assert.deepEqual(EASING_IDS, ['linear', 'ease-in-out', 'fast-ease-in-out', 'ease-in', 'ease-out']);

	for (const id of EASING_IDS) {
		near(ease(id, 0), 0, 1e-12, `${id} at 0`);
		near(ease(id, 1), 1, 1e-12, `${id} at 1`);
		let previous = 0;
		for (let step = 1; step <= 20; step += 1) {
			const value = ease(id, step / 20);
			assert.ok(value >= previous, `${id} runs backwards at ${step / 20}`);
			previous = value;
		}
	}

	/* Both symmetric styles cross the middle at one half; the fast one lingers longer at each end. */
	near(ease('ease-in-out', 0.5), 0.5, 1e-12, 'ease-in-out midpoint');
	near(ease('fast-ease-in-out', 0.5), 0.5, 1e-12, 'fast midpoint');
	near(ease('ease-in-out', 0.3) + ease('ease-in-out', 0.7), 1, 1e-12, 'ease-in-out symmetry');
	near(ease('fast-ease-in-out', 0.3) + ease('fast-ease-in-out', 0.7), 1, 1e-12, 'fast symmetry');
	assert.ok(ease('fast-ease-in-out', 0.3) < ease('ease-in-out', 0.3));
	assert.ok(ease('fast-ease-in-out', 0.7) > ease('ease-in-out', 0.7));
	assert.equal(ease('ease-in', 0.5), 0.125);
	assert.equal(ease('ease-out', 0.5), 0.875);

	/* An unknown style is a linear morph, and progress outside the clip clamps to its ends. */
	assert.equal(ease('bounce', 0.3), 0.3);
	assert.equal(ease('linear', -1), 0);
	assert.equal(ease('linear', 2), 1);
	assert.equal(ease('linear', Number.NaN), 0);
});

test('morph settings clamp every control and fall back to sane defaults', () => {
	assert.deepEqual(normalizeMorphSettings({}), {
		hold: 1,
		duration: 1.5,
		easing: 'ease-in-out',
		levels: 3,
		size: 720,
		fps: 30,
		format: 'mp4',
		background: '#ffffff',
		loop: false,
	});

	assert.deepEqual(normalizeMorphSettings({
		hold: '99', duration: 0, easing: 'bounce', levels: 12, size: 4000, fps: 200, format: 'gif', background: 'red', loop: 'yes',
	}), {
		hold: 10, duration: 0.1, easing: 'ease-in-out', levels: 8, size: 1920, fps: 60, format: 'mp4', background: '#ffffff', loop: true,
	});

	assert.deepEqual(normalizeMorphSettings({
		hold: 0.25, duration: 2.04, easing: 'linear', levels: '2', size: 479, fps: 24.4, format: 'webm', background: '#ABC', loop: false,
	}), {
		hold: 0.3, duration: 2, easing: 'linear', levels: 2, size: 480, fps: 24, format: 'webm', background: '#aabbcc', loop: false,
	});

	assert.equal(normalizeHexColor('#FFF'), '#ffffff');
	assert.equal(normalizeHexColor(' #1A2b3C '), '#1a2b3c');
	assert.equal(normalizeHexColor('blue', '#000000'), '#000000');
	assert.deepEqual(hexToRgb('#102030'), [16, 32, 48]);
	assert.equal(evenSize(1), 2);
	assert.equal(evenSize(479), 480);
	assert.deepEqual(MORPH_SIZES, [360, 480, 720, 1080]);
	assert.deepEqual(MORPH_FRAME_RATES, [12, 24, 30, 60]);
	assert.deepEqual(MORPH_FORMATS.map((profile) => profile.value), ['mp4', 'webm']);
});

test('the timeline holds, morphs, holds, and only comes back when asked to loop', () => {
	const settings = normalizeMorphSettings({ hold: 0.5, duration: 1, fps: 10, easing: 'linear' });
	assert.equal(timelineDuration(settings), 2);
	const frames = buildTimeline(settings);
	assert.equal(frames.length, 20);

	for (let index = 0; index <= 5; index += 1) assert.equal(frames[index], 0, `frame ${index} holds the first picture`);
	near(frames[6], 0.1, 1e-6, 'first morph frame');
	near(frames[10], 0.5, 1e-6, 'middle frame');
	for (let index = 15; index < 20; index += 1) assert.equal(frames[index], 1, `frame ${index} holds the second picture`);
	for (let index = 1; index < frames.length; index += 1) assert.ok(frames[index] >= frames[index - 1], 'the morph never runs backwards');
	assert.equal(morphProgress(99, settings), 1);
	assert.equal(morphProgress(0.5, settings), 0);

	/* Looping appends the way back and wraps, so the clip can repeat without a cut. */
	const loop = normalizeMorphSettings({ hold: 0.5, duration: 1, fps: 10, easing: 'linear', loop: true });
	assert.equal(timelineDuration(loop), 3);
	const loopFrames = buildTimeline(loop);
	assert.equal(loopFrames.length, 30);
	assert.equal(loopFrames[15], 1);
	assert.equal(loopFrames[20], 1);
	near(loopFrames[21], 0.9, 1e-6, 'first frame of the way back');
	near(loopFrames[29], 0.1, 1e-6, 'last frame before the wrap');
	assert.equal(morphProgress(3, loop), 0);
	near(morphProgress(-0.1, loop), 0.1, 1e-9, 'negative time wraps into the way back');

	/* The style shapes the morph frames only, never the holds. */
	const eased = buildTimeline(normalizeMorphSettings({ hold: 0.5, duration: 1, fps: 10, easing: 'ease-in' }));
	near(eased[10], 0.125, 1e-6, 'eased middle frame');
	assert.equal(eased[3], 0);
	assert.equal(eased[19], 1);

	/* A clip is never shorter than two frames, or FFmpeg would have nothing to encode. */
	assert.equal(buildTimeline(normalizeMorphSettings({ hold: 0, duration: 0.1, fps: 1 })).length, 2);
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

	const cutout = raster(20, 20, (x, y) => (inBox(x, y, [5, 5, 10, 10]) ? BLACK : [0, 0, 0, 0]));
	assert.equal(estimateBackground(cutout, 20, 20), null);
	assert.equal(estimateBackground(new Uint8ClampedArray(0), 0, 0), null);
});

test('ink measures distance from the background and scales to the strongest ink in the picture', () => {
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
	const faded = raster(10, 10, (x, y) => (inBox(x, y, [1, 1, 4, 4]) ? BLACK : x === 8 && y === 8 ? [0, 0, 0, 128] : [0, 0, 0, 0]));
	const fadedInk = inkMap(faded, 10, 10, WHITE);
	assert.equal(fadedInk[2 * 10 + 2], 1);
	near(fadedInk[8 * 10 + 8], 0.5, 0.01, 'half-transparent ink');
	assert.equal(fadedInk[0], 0);
});

test('layers nest from light to dark and carry the colour of the band each one adds', () => {
	const width = 16;
	const tones = raster(width, width, (x, y) => (inBox(x, y, [5, 5, 6, 6]) ? BLACK : inBox(x, y, [2, 2, 12, 12]) ? GREY : WHITE));
	const { layers, background } = buildMorphLayers(tones, width, width, { levels: 2, background: WHITE });

	assert.deepEqual(background, WHITE);
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

test('FFmpeg reads the numbered frames at the clip frame rate and encodes the chosen container', () => {
	assert.equal(frameFileName('morph-1', 7), 'morph-1-00007.png');
	assert.equal(framePattern('morph-1'), 'morph-1-%05d.png');

	const mp4 = buildMorphVideoArgs({ prefix: 'morph-1', fps: 30, format: 'mp4', outputName: 'out.mp4' });
	assert.deepEqual(mp4.slice(0, 6), ['-framerate', '30', '-start_number', '0', '-i', 'morph-1-%05d.png']);
	assert.ok(mp4.includes('libx264') && mp4.includes('yuv420p') && mp4.includes('+faststart'));
	assert.deepEqual(mp4.slice(-2), ['-y', 'out.mp4']);

	const webm = buildMorphVideoArgs({ prefix: 'morph-1', fps: 24, format: 'webm', outputName: 'out.webm' });
	assert.ok(webm.includes('libvpx') && !webm.includes('libx264'));
	assert.equal(webm[1], '24');
	assert.ok(buildMorphVideoArgs({ prefix: 'p', fps: 12, format: 'gif', outputName: 'o' }).includes('libx264'));

	assert.equal(morphFormat('webm').mimeType, 'video/webm');
	assert.equal(morphFormat('gif').mimeType, 'video/mp4');
	assert.equal(morphOutputName('cell.png', 'neuron.jpg'), 'cell-to-neuron.mp4');
	assert.equal(morphOutputName('cell.png', 'neuron.jpg', 'webm'), 'cell-to-neuron.webm');
	assert.equal(morphOutputName('a.b.c.png', 'd.png', 'gif'), 'a.b.c-to-d.mp4');
	assert.equal(morphOutputName('only.png', ''), 'only.mp4');
	assert.equal(morphOutputName('', ''), 'morph.mp4');
});
