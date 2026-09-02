import test from 'node:test';
import assert from 'node:assert/strict';

import {
	DEFAULT_MORPH_SETTINGS,
	MORPH_EASINGS,
	MORPH_OUTPUT_FORMATS,
	applyMatrix,
	buildMorphVideoArgs,
	buildShapeUnits,
	classifyRings,
	colorToCss,
	composeMatrices,
	createMorph,
	easingFunction,
	fitViewBoxMatrix,
	flattenPathData,
	matchShapeGroups,
	matrixScale,
	mixColors,
	mixStrokes,
	morphOutputName,
	morphTimeline,
	normalizeMorphSettings,
	outputFormat,
	parseColor,
	pointInRing,
	ringArea,
	ringBounds,
	ringCentroid,
	shapeToPathData,
	thereAndBackRing,
	withAlpha,
} from '../src/lib/tools/svg-morph.js';
import { drawMorphFrame, renderMorphVideo } from '../src/lib/tools/svg-morph-browser.js';

const red = { r: 255, g: 0, b: 0, a: 1 };
const blue = { r: 0, g: 0, b: 255, a: 1 };
const square = (x, y, size) => [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, message ?? `${actual} is not within ${tolerance} of ${expected}`);

/* Reads the vertices out of a path string, keeping only arc end points so tiny collapse circles count as points. */
const pathPoints = (d) => {
	const points = [];
	for (const match of d.matchAll(/([MLA])([^MLAZ]*)/g)) {
		const numbers = match[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/g)?.map(Number) ?? [];
		if (match[1] === 'A') {
			for (let index = 5; index + 1 < numbers.length; index += 7) points.push([numbers[index], numbers[index + 1]]);
		} else {
			for (let index = 0; index + 1 < numbers.length; index += 2) points.push([numbers[index], numbers[index + 1]]);
		}
	}
	return points;
};

test('svg morph settings clamp every control and snap the frame rate', () => {
	assert.deepEqual(normalizeMorphSettings({}), DEFAULT_MORPH_SETTINGS);
	assert.deepEqual(normalizeMorphSettings({
		holdStart: -3, holdEnd: '99', duration: 0, fps: '29', width: '1001', height: 9000, margin: 80, easing: 'nope', format: 'gif',
	}), {
		holdStart: 0, holdEnd: 10, duration: 0.1, fps: 30, width: 1002, height: 4096, margin: 40,
		easing: DEFAULT_MORPH_SETTINGS.easing, format: DEFAULT_MORPH_SETTINGS.format,
	});
	assert.equal(normalizeMorphSettings({ fps: '59' }).fps, 60);
	assert.equal(normalizeMorphSettings({ fps: 'abc' }).fps, 30);
	assert.equal(normalizeMorphSettings({ holdStart: 1.234 }).holdStart, 1.23);
	assert.equal(normalizeMorphSettings({ easing: 'snap', format: 'webm-vp8' }).easing, 'snap');
	assert.equal(normalizeMorphSettings({ easing: 'snap', format: 'webm-vp8' }).format, 'webm-vp8');
});

test('svg morph timeline counts hold and morph frames so both end shapes are full frames', () => {
	const timeline = morphTimeline(normalizeMorphSettings({ holdStart: 1, duration: 1, holdEnd: 0.4, fps: 25, easing: 'linear' }));
	assert.equal(timeline.startFrames, 25);
	assert.equal(timeline.morphFrames, 25);
	assert.equal(timeline.endFrames, 10);
	assert.equal(timeline.frameCount, 60);
	assert.equal(timeline.totalDuration, 2.4);
	assert.equal(timeline.loopDuration, 2.4);
	assert.equal(timeline.progressAt(0), 0);
	assert.equal(timeline.progressAt(24), 0);
	assert.equal(timeline.progressAt(25), 0);
	assert.equal(timeline.progressAt(37), 0.5);
	assert.equal(timeline.progressAt(49), 1);
	assert.equal(timeline.progressAt(59), 1);
	assert.equal(timeline.progressAtTime(0.5), 0);
	assert.equal(timeline.progressAtTime(1.5), 0.5);
	assert.equal(timeline.progressAtTime(2.3), 1);

	const eased = morphTimeline(normalizeMorphSettings({ holdStart: 0, duration: 1, holdEnd: 0, fps: 25, easing: 'ease-in' }));
	assert.equal(eased.frameCount, 25);
	assert.equal(eased.progressAt(12), 0.125);
	assert.equal(eased.progressAt(24), 1);
	assert.equal(morphTimeline(normalizeMorphSettings({ duration: 0.1, fps: 24 })).morphFrames, 2);
});

test('svg morph easings pin both ends and differ in the middle as advertised', () => {
	for (const { id, ease } of MORPH_EASINGS) {
		near(ease(0), 0, 1e-9, `${id} starts at 0`);
		near(ease(1), 1, 1e-9, `${id} ends at 1`);
	}
	assert.equal(easingFunction('linear')(0.5), 0.5);
	assert.equal(easingFunction('ease-in')(0.5), 0.125);
	assert.equal(easingFunction('ease-out')(0.5), 0.875);
	assert.equal(easingFunction('ease-in-fast')(0.5), 0.03125);
	assert.equal(easingFunction('ease-out-fast')(0.5), 0.96875);
	assert.equal(easingFunction('snap')(0.5), 0.5);
	assert.equal(easingFunction('ease-in-out')(0.5), 0.5);
	near(easingFunction('gentle')(0.5), 0.5, 1e-9);
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

test('svg morph builds transparent encoder arguments for every output format', () => {
	const options = { fps: 30, framePattern: 'f-%05d.png', outputName: 'out.mov' };
	const prores = buildMorphVideoArgs('prores-4444', options);
	assert.deepEqual(prores.slice(0, 4), ['-framerate', '30', '-i', 'f-%05d.png']);
	assert.deepEqual(prores.slice(-2), ['-y', 'out.mov']);
	assert.ok(prores.includes('prores_ks') && prores.includes('4444') && prores.includes('yuva444p10le'));

	const animation = buildMorphVideoArgs('qt-animation', options);
	assert.ok(animation.includes('qtrle') && animation.includes('argb'));

	const png = buildMorphVideoArgs('png-mov', options);
	assert.ok(png.includes('png') && png.includes('rgba'));

	const webm = buildMorphVideoArgs('webm-vp8', { ...options, outputName: 'out.webm' });
	assert.ok(webm.includes('libvpx') && !webm.includes('libvpx-vp9') && webm.includes('yuva420p'));
	assert.equal(webm[webm.indexOf('-auto-alt-ref') + 1], '0');
	assert.deepEqual(webm.slice(-2), ['-y', 'out.webm']);

	assert.equal(outputFormat('unknown').id, 'prores-4444');
	assert.deepEqual(MORPH_OUTPUT_FORMATS.map((format) => format.extension), ['mov', 'mov', 'mov', 'webm']);
	assert.equal(MORPH_OUTPUT_FORMATS.filter((format) => format.playable).map((format) => format.id).join(), 'webm-vp8');
});

test('svg morph names the download after both shapes and the container', () => {
	assert.equal(morphOutputName('Logo A.svg', 'Logo B.svg', 'webm-vp8'), 'logo-a-to-logo-b.webm');
	assert.equal(morphOutputName('', undefined, 'qt-animation'), 'shape-a-to-shape-b.mov');
	assert.equal(morphOutputName('Grün & Blau.svg', 'x.SVG', 'prores-4444'), 'grün-blau-to-x.mov');
});

test('svg morph parses css colours and blends paint through alpha when one side is missing', () => {
	assert.deepEqual(parseColor('#f00'), red);
	near(parseColor('#ff000080').a, 128 / 255, 1e-9);
	assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
	assert.deepEqual(parseColor('rgba(1,2,3,0.5)'), { r: 1, g: 2, b: 3, a: 0.5 });
	assert.deepEqual(parseColor('rgb(100% 0% 0% / 50%)'), { r: 255, g: 0, b: 0, a: 0.5 });
	assert.deepEqual(parseColor('blue'), blue);
	assert.equal(parseColor('none'), null);
	assert.equal(parseColor('transparent'), null);
	assert.equal(parseColor('nonsense'), null);
	assert.equal(parseColor('rgb(1, 2)'), null);
	assert.equal(parseColor('#12345'), null);

	assert.deepEqual(mixColors(red, blue, 0.5), { r: 127.5, g: 0, b: 127.5, a: 1 });
	assert.equal(colorToCss(mixColors(red, blue, 0.5)), 'rgba(128, 0, 128, 1)');
	assert.deepEqual(mixColors(null, blue, 0.25), { ...blue, a: 0.25 });
	assert.deepEqual(mixColors(red, null, 0.5), { ...red, a: 0.5 });
	assert.equal(mixColors(red, null, 1), null);
	assert.equal(mixColors(null, null, 0.5), null);
	assert.equal(withAlpha(red, 0), null);
	assert.equal(colorToCss(null), null);

	const grown = mixStrokes(null, { color: blue, width: 4, join: 'miter', cap: 'square' }, 0.5);
	assert.equal(grown.width, 2);
	assert.equal(grown.color.a, 0.5);
	assert.equal(mixStrokes(null, null, 0.3), null);
	assert.equal(mixStrokes({ color: red, width: 2, join: 'miter' }, { color: red, width: 2, join: 'round' }, 0.25).join, 'miter');
	assert.equal(mixStrokes({ color: red, width: 2, join: 'miter' }, { color: red, width: 2, join: 'round' }, 0.75).join, 'round');
	assert.equal(mixStrokes({ color: red, width: 2 }, null, 1), null);
});

test('svg morph matrices compose inner-first and contain-fit a viewBox with margin', () => {
	const scale2 = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 };
	const shift = { a: 1, b: 0, c: 0, d: 1, e: 5, f: 5 };
	assert.deepEqual(applyMatrix(composeMatrices(scale2, shift), [1, 1]), [12, 12]);
	assert.deepEqual(applyMatrix(composeMatrices(shift, scale2), [1, 1]), [7, 7]);
	assert.equal(matrixScale(scale2), 2);
	assert.equal(matrixScale({ a: 0, b: 1, c: -1, d: 0, e: 0, f: 0 }), 1);

	const fit = fitViewBoxMatrix({ x: 0, y: 0, width: 100, height: 50 }, 200, 200, 0);
	assert.deepEqual(applyMatrix(fit, [0, 0]), [0, 50]);
	assert.deepEqual(applyMatrix(fit, [100, 50]), [200, 150]);
	const padded = fitViewBoxMatrix({ x: 0, y: 0, width: 100, height: 50 }, 200, 200, 10);
	assert.deepEqual(applyMatrix(padded, [0, 0]), [20, 60]);
	const offset = fitViewBoxMatrix({ x: 10, y: 0, width: 100, height: 50 }, 200, 200, 0);
	assert.deepEqual(applyMatrix(offset, [10, 0]), [0, 50]);
	assert.equal(fitViewBoxMatrix({ x: 0, y: 0, width: 0, height: 0 }, 10, 10, 0).a, 10);
});

test('svg morph converts basic shapes to path data', () => {
	assert.equal(shapeToPathData('rect', { x: 1, y: 2, width: 10, height: 20 }), 'M1 2H11V22H1Z');
	assert.match(shapeToPathData('rect', { x: 0, y: 0, width: 10, height: 10, rx: 50 }), /^M5 0H5A5 5 0 0 1 10 5/);
	assert.match(shapeToPathData('rect', { x: 0, y: 0, width: 20, height: 10, ry: 2 }), /A2 2 0 0 1/);
	assert.equal(shapeToPathData('rect', { x: 0, y: 0, width: 0, height: 10 }), '');
	assert.equal(shapeToPathData('circle', { cx: 50, cy: 50, r: 40 }), 'M90 50A40 40 0 1 1 10 50A40 40 0 1 1 90 50Z');
	assert.equal(shapeToPathData('ellipse', { cx: 0, cy: 0, rx: 4, ry: 2 }), 'M4 0A4 2 0 1 1 -4 0A4 2 0 1 1 4 0Z');
	assert.equal(shapeToPathData('circle', { cx: 0, cy: 0, r: 0 }), '');
	assert.equal(shapeToPathData('line', { x1: 0, y1: 0, x2: 10, y2: 5 }), 'M0 0L10 5');
	assert.equal(shapeToPathData('polygon', { points: [[0, 0], [10, 0], [5, 5]] }), 'M0 0L10 0L5 5Z');
	assert.equal(shapeToPathData('polyline', { points: [[0, 0], [10, 0], [5, 5]] }), 'M0 0L10 0L5 5');
	assert.equal(shapeToPathData('polygon', { points: [[0, 0]] }), '');
	assert.equal(shapeToPathData('path', { d: 'M0 0L1 1' }), 'M0 0L1 1');
	assert.equal(shapeToPathData('text', {}), '');
});

test('svg morph flattens path data with exact corners, sampled curves, and transforms', () => {
	assert.deepEqual(flattenPathData('M0 0H100V100H0Z'), [{ points: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true }]);
	assert.deepEqual(flattenPathData('m10 10 h5 v5 h-5 z'), [{ points: [[10, 10], [15, 10], [15, 15], [10, 15]], closed: true }]);
	assert.deepEqual(flattenPathData('M0 0H10V10H0Z', { matrix: { a: 2, b: 0, c: 0, d: 2, e: 5, f: 5 } }), [
		{ points: [[5, 5], [25, 5], [25, 25], [5, 25]], closed: true },
	]);
	assert.deepEqual(flattenPathData('M0 0L10 0L10 10'), [{ points: [[0, 0], [10, 0], [10, 10]], closed: false }]);

	const [circle] = flattenPathData(shapeToPathData('circle', { cx: 50, cy: 50, r: 40 }));
	assert.equal(circle.closed, true);
	assert.ok(circle.points.length > 20 && circle.points.length <= 720);
	for (const [x, y] of circle.points) {
		near(Math.hypot(x - 50, y - 50), 40, 0.05, 'circle samples sit on the circle');
	}

	const [quadratic] = flattenPathData('M0 0Q50 100 100 0');
	assert.deepEqual(quadratic.points[0], [0, 0]);
	assert.deepEqual(quadratic.points.at(-1), [100, 0]);
	near(quadratic.points[Math.floor(quadratic.points.length / 2)][1], 50, 2);

	const two = flattenPathData('M0 0H10V10H0Z M20 0H30V10H20Z');
	assert.equal(two.length, 2);
	const continued = flattenPathData('M0 0L10 0L10 10Z L5 20');
	assert.deepEqual(continued.map((subpath) => subpath.points[0]), [[0, 0], [0, 0]]);
	assert.equal(continued[1].closed, false);
	assert.deepEqual(continued[1].points, [[0, 0], [5, 20]]);

	assert.deepEqual(flattenPathData(''), []);
	assert.deepEqual(flattenPathData('M5 5'), []);
	assert.throws(() => flattenPathData('M0 0 L bogus'), /Invalid path data/);

	const dense = `M${Array.from({ length: 3000 }, (_, index) => `${index} ${index % 2}`).join('L')}Z`;
	assert.ok(flattenPathData(dense)[0].points.length <= 720);
});

test('svg morph ring geometry reports area, centroid, bounds, and containment', () => {
	const ring = square(0, 0, 10);
	assert.equal(ringArea(ring), 100);
	assert.equal(ringArea([...ring].reverse()), -100);
	assert.deepEqual(ringCentroid(ring), [5, 5]);
	assert.deepEqual(ringCentroid([[0, 0], [10, 0]]), [5, 0]);
	assert.deepEqual(ringBounds(ring), { minX: 0, minY: 0, maxX: 10, maxY: 10 });
	assert.equal(pointInRing([5, 5], ring), true);
	assert.equal(pointInRing([15, 5], ring), false);
	assert.deepEqual(thereAndBackRing([[0, 0], [1, 0], [2, 0]]), [[0, 0], [1, 0], [2, 0], [1, 0]]);
	assert.deepEqual(thereAndBackRing([[0, 0]]), [[0, 0]]);
});

test('svg morph classifies holes by fill rule and nests islands inside them', () => {
	const outer = square(0, 0, 100);
	const inner = square(30, 30, 40);
	const evenOdd = classifyRings([outer, inner], 'evenodd');
	assert.equal(evenOdd.length, 1);
	assert.deepEqual(evenOdd[0].holes, [inner]);

	const sameWinding = classifyRings([outer, inner], 'nonzero');
	assert.equal(sameWinding.length, 2);
	assert.deepEqual(sameWinding.map((unit) => unit.holes.length), [0, 0]);

	const reversedInner = [...inner].reverse();
	const opposite = classifyRings([outer, reversedInner], 'nonzero');
	assert.equal(opposite.length, 1);
	assert.deepEqual(opposite[0].holes, [reversedInner]);

	const island = square(40, 40, 20);
	const nested = classifyRings([island, square(20, 20, 60), outer], 'evenodd');
	assert.equal(nested.length, 2);
	assert.equal(nested.find((unit) => unit.outer === outer).holes.length, 1);
	assert.equal(nested.find((unit) => unit.outer === island).holes.length, 0);

	const disjoint = classifyRings([square(0, 0, 10), square(50, 50, 10)], 'evenodd');
	assert.equal(disjoint.length, 2);
	assert.deepEqual(disjoint.map((unit) => unit.holes.length), [0, 0]);
});

test('svg morph builds fill units with holes and stroke units from open paths', () => {
	const filled = buildShapeUnits({
		subpaths: [{ points: square(0, 0, 100), closed: true }, { points: square(30, 30, 40), closed: true }],
		fill: red,
		fillRule: 'evenodd',
		stroke: { color: blue, width: 2 },
	}, 3);
	assert.equal(filled.length, 1);
	assert.equal(filled[0].holes.length, 1);
	assert.deepEqual(filled[0].fill, red);
	assert.equal(filled[0].stroke.width, 2);
	assert.equal(filled[0].order, 3);

	const stroked = buildShapeUnits({
		subpaths: [{ points: [[0, 0], [10, 0], [20, 5]], closed: false }],
		fill: null,
		stroke: { color: red, width: 2 },
	});
	assert.equal(stroked.length, 1);
	assert.deepEqual(stroked[0].outer, [[0, 0], [10, 0], [20, 5], [10, 0]]);
	assert.equal(stroked[0].fill, null);

	assert.deepEqual(buildShapeUnits({ subpaths: [{ points: square(0, 0, 5), closed: true }], fill: null, stroke: null }), []);
	assert.deepEqual(buildShapeUnits({ subpaths: [{ points: square(0, 0, 5), closed: true }], fill: null, stroke: { color: red, width: 0 } }), []);
	assert.deepEqual(buildShapeUnits({ subpaths: [{ points: [[0, 0], [5, 5]], closed: true }], fill: red }), []);
	assert.deepEqual(buildShapeUnits({ subpaths: [], fill: red }), []);
});

test('svg morph pairs shapes by position and groups the leftovers with their nearest partner', () => {
	const unit = (x, y, size) => ({ outer: square(x, y, size), holes: [] });
	assert.deepEqual(
		matchShapeGroups([unit(0, 0, 10), unit(100, 0, 10)], [unit(100, 0, 10), unit(0, 0, 10)]),
		[{ from: [0], to: [1] }, { from: [1], to: [0] }],
	);
	assert.deepEqual(matchShapeGroups([unit(0, 0, 10)], [unit(0, 0, 10), unit(50, 0, 10), unit(100, 0, 10)]), [{ from: [0], to: [0, 1, 2] }]);
	assert.deepEqual(
		matchShapeGroups([unit(0, 0, 10), unit(100, 0, 10), unit(0, 100, 10)], [unit(0, 0, 10), unit(0, 100, 10)]),
		[{ from: [0, 1], to: [0] }, { from: [2], to: [1] }],
	);
	assert.deepEqual(matchShapeGroups([], [unit(0, 0, 10)]), []);
	/* Size breaks ties when two candidates sit at the same distance. */
	const [group] = matchShapeGroups([unit(45, 0, 10)], [unit(0, 0, 10), unit(90, 0, 40)]);
	assert.deepEqual(group, { from: [0], to: [0, 1] });
});

test('svg morph interpolates a square into a circle and blends its colour', () => {
	const fromUnits = buildShapeUnits({ subpaths: flattenPathData('M0 0H100V100H0Z'), fill: red });
	const toUnits = buildShapeUnits({ subpaths: flattenPathData(shapeToPathData('circle', { cx: 50, cy: 50, r: 40 })), fill: blue });
	const morph = createMorph(fromUnits, toUnits);
	assert.equal(morph.pieces.length, 1);

	const start = morph.frame(0);
	assert.equal(start.length, 1);
	for (const [x, y] of pathPoints(start[0].path)) {
		assert.ok([x, y].some((value) => Math.abs(value) < 1e-6 || Math.abs(value - 100) < 1e-6), 'start frame sits on the square');
	}
	assert.deepEqual(start[0].fill, red);
	assert.equal(start[0].holes.length, 0);

	const end = morph.frame(1);
	for (const [x, y] of pathPoints(end[0].path)) {
		near(Math.hypot(x - 50, y - 50), 40, 0.2, 'end frame sits on the circle');
	}
	assert.deepEqual(end[0].fill, blue);

	const middle = morph.frame(0.5);
	assert.deepEqual(middle[0].fill, { r: 127.5, g: 0, b: 127.5, a: 1 });
	assert.equal(middle[0].stroke, null);
});

test('svg morph keeps paired holes and collapses unpaired ones to a point', () => {
	const donut = buildShapeUnits({ subpaths: flattenPathData('M0 0H100V100H0ZM30 30H70V70H30Z'), fill: red, fillRule: 'evenodd' });
	const disc = buildShapeUnits({ subpaths: flattenPathData(shapeToPathData('circle', { cx: 50, cy: 50, r: 40 })), fill: blue });
	const closing = createMorph(donut, disc);
	assert.equal(closing.frame(0)[0].holes.length, 1);
	for (const [x, y] of pathPoints(closing.frame(1)[0].holes[0])) {
		near(Math.hypot(x - 50, y - 50), 0, 0.2, 'hole shrinks onto its centroid');
	}

	const ring = buildShapeUnits({ subpaths: flattenPathData('M100 50A50 50 0 1 1 0 50A50 50 0 1 1 100 50ZM75 50A25 25 0 1 0 25 50A25 25 0 1 0 75 50Z'), fill: blue, fillRule: 'evenodd' });
	const paired = createMorph(donut, ring);
	assert.equal(paired.pieces[0].holes.length, 1);
	for (const [x, y] of pathPoints(paired.frame(1)[0].holes[0])) {
		near(Math.hypot(x - 50, y - 50), 25, 0.2, 'paired hole ends on the inner circle');
	}
});

test('svg morph splits one shape into many and merges many into one', () => {
	const one = buildShapeUnits({ subpaths: flattenPathData('M0 0H100V100H0Z'), fill: red });
	const left = buildShapeUnits({ subpaths: flattenPathData('M0 0H40V100H0Z'), fill: blue });
	const right = buildShapeUnits({ subpaths: flattenPathData('M60 0H100V100H60Z'), fill: blue }, 1);
	const split = createMorph(one, [...left, ...right]);
	assert.equal(split.pieces.length, 2);
	const splitEnd = split.frame(1);
	const boundsOf = (path) => ringBounds(pathPoints(path));
	assert.deepEqual(splitEnd.map((shape) => Math.round(boundsOf(shape.path).minX)).sort((a, b) => a - b), [0, 60]);
	assert.deepEqual(splitEnd.map((shape) => Math.round(boundsOf(shape.path).maxX)).sort((a, b) => a - b), [40, 100]);
	const splitStart = split.frame(0);
	for (const shape of splitStart) {
		const bounds = boundsOf(shape.path);
		assert.ok(bounds.minX >= -1e-6 && bounds.maxX <= 100 + 1e-6, 'pieces start inside the source square');
		assert.deepEqual(shape.fill, red);
	}

	const merge = createMorph([...left, ...right], one);
	assert.equal(merge.pieces.length, 2);
	assert.deepEqual(merge.frame(0).map((shape) => Math.round(boundsOf(shape.path).minX)).sort((a, b) => a - b), [0, 60]);
	for (const shape of merge.frame(1)) {
		const bounds = boundsOf(shape.path);
		assert.ok(bounds.minX >= -1e-6 && bounds.maxX <= 100 + 1e-6, 'pieces end inside the target square');
		assert.deepEqual(shape.fill, red);
	}
});

test('svg morph collapses shapes without a partner and clones zero-area strokes', () => {
	const disc = buildShapeUnits({ subpaths: flattenPathData(shapeToPathData('circle', { cx: 50, cy: 50, r: 40 })), fill: blue });
	const appearing = createMorph([], disc);
	assert.equal(appearing.pieces.length, 1);
	const first = pathPoints(appearing.frame(0)[0].path);
	for (const [x, y] of first) near(Math.hypot(x - 50, y - 50), 0, 0.2, 'appears from its centroid');
	assert.equal(appearing.frame(0)[0].fill, null);
	assert.deepEqual(appearing.frame(1)[0].fill, blue);

	const vanishing = createMorph(disc, []);
	assert.equal(vanishing.frame(1)[0].fill, null);
	for (const [x, y] of pathPoints(vanishing.frame(1)[0].path)) near(Math.hypot(x - 50, y - 50), 0, 0.2, 'vanishes into its centroid');

	const line = buildShapeUnits({ subpaths: flattenPathData('M0 50L100 50'), fill: null, stroke: { color: red, width: 4 } });
	const targets = buildShapeUnits({ subpaths: flattenPathData('M0 0H40V40H0ZM60 60H100V100H60Z'), fill: blue });
	const cloned = createMorph(line, targets);
	assert.equal(cloned.pieces.length, 2);
	for (const shape of cloned.frame(0)) {
		const bounds = ringBounds(pathPoints(shape.path));
		assert.deepEqual([Math.round(bounds.minY), Math.round(bounds.maxY)], [50, 50]);
		assert.equal(shape.fill, null);
		assert.equal(shape.stroke.width, 4);
	}
	const clonedEnd = cloned.frame(1);
	assert.ok(clonedEnd.every((shape) => shape.stroke === null));
	assert.ok(clonedEnd.every((shape) => shape.fill.a === 1));
});

test('svg morph slides stacking order from the source order to the target order', () => {
	const bottom = { outer: square(0, 0, 50), holes: [], fill: red, stroke: null, order: 0 };
	const top = { outer: square(25, 25, 50), holes: [], fill: blue, stroke: null, order: 1 };
	const morph = createMorph([bottom, top], [{ ...top, fill: red, order: 0 }, { ...bottom, fill: blue, order: 1 }]);
	assert.deepEqual(morph.frame(0).map((shape) => shape.fill), [red, blue]);
	assert.deepEqual(morph.frame(1).map((shape) => shape.fill), [red, blue]);
	assert.deepEqual(morph.frame(0.5).map((shape) => Math.round(shape.order * 100) / 100), [0.5, 0.5]);
});

class FakePath {
	constructor(d) {
		this.d = d;
		this.added = [];
	}

	addPath(path) {
		this.added.push(path.d);
	}
}

const createContext = () => {
	const calls = [];
	const context = {
		save: () => calls.push(['save']),
		restore: () => calls.push(['restore']),
		scale: (x, y) => calls.push(['scale', x, y]),
		clearRect: (...args) => calls.push(['clearRect', ...args]),
		fill: (path, rule) => calls.push(['fill', path.d, path.added, rule, context.fillStyle]),
		stroke: (path) => calls.push(['stroke', path.d, context.strokeStyle, context.lineWidth, context.lineJoin, context.lineCap]),
	};
	return { context, calls };
};

test('svg morph draws outlines with even-odd holes and scaled strokes on a canvas context', () => {
	const originalPath = globalThis.Path2D;
	globalThis.Path2D = FakePath;
	try {
		const { context, calls } = createContext();
		drawMorphFrame(context, [
			{ path: 'M0 0L10 0L10 10Z', holes: ['M2 2L4 2L4 4Z'], fill: red, stroke: { color: blue, width: 3, join: 'round', cap: 'butt' } },
			{ path: 'M20 0L30 0L30 10Z', holes: [], fill: null, stroke: null },
		], { scale: 2 });
		assert.deepEqual(calls, [
			['save'],
			['scale', 2, 2],
			['fill', 'M0 0L10 0L10 10Z', ['M2 2L4 2L4 4Z'], 'evenodd', 'rgba(255, 0, 0, 1)'],
			['stroke', 'M0 0L10 0L10 10Z', 'rgba(0, 0, 255, 1)', 3, 'round', 'butt'],
			['restore'],
		]);
	} finally {
		if (originalPath === undefined) delete globalThis.Path2D;
		else globalThis.Path2D = originalPath;
	}
});

const createFakeEncoder = ({ exitCode = 0, output = Uint8Array.of(9, 8, 7) } = {}) => {
	const files = new Map();
	const log = [];
	const ffmpeg = {
		writeFile: async (name, data) => { files.set(name, data); log.push(['write', name]); },
		exec: async (args) => { log.push(['exec', args]); if (exitCode === 0) files.set(args.at(-1), output); return exitCode; },
		readFile: async (name) => { if (!files.has(name)) throw new Error(`missing ${name}`); return files.get(name); },
		deleteFile: async (name) => { files.delete(name); log.push(['delete', name]); },
	};
	return { ffmpeg, files, log, runtime: { run: (task) => task(ffmpeg) } };
};

const createFakeCanvas = (context) => ({
	width: 0,
	height: 0,
	getContext: () => context,
	toBlob: (callback) => callback(new Blob([Uint8Array.of(1, 2, 3)])),
});

test('svg morph renders every timeline frame to PNG, encodes it, and cleans up the FFmpeg files', async () => {
	const originalPath = globalThis.Path2D;
	globalThis.Path2D = FakePath;
	try {
		const encoder = createFakeEncoder();
		const { context } = createContext();
		const canvas = createFakeCanvas(context);
		const progress = [];
		const frames = [];
		const morph = { frame: (t) => { frames.push(t); return [{ path: 'M0 0L1 0L1 1Z', holes: [], fill: red, stroke: null }]; } };
		const settings = normalizeMorphSettings({ holdStart: 0, duration: 0.1, holdEnd: 0, fps: 30, width: 64, height: 64, format: 'webm-vp8', easing: 'linear' });

		const result = await renderMorphVideo({ morph, settings, ffmpegRuntime: encoder.runtime, canvas, onProgress: (event) => progress.push(event) });

		assert.deepEqual([...result.bytes], [9, 8, 7]);
		assert.equal(result.format.id, 'webm-vp8');
		assert.equal(result.frameCount, 3);
		near(result.duration, 0.1, 1e-9);
		assert.deepEqual(frames, [0, 0.5, 1]);
		assert.deepEqual([canvas.width, canvas.height], [64, 64]);

		const writes = encoder.log.filter(([kind]) => kind === 'write').map(([, name]) => name);
		assert.equal(writes.length, 3);
		assert.ok(writes.every((name, index) => name.endsWith(`${String(index).padStart(5, '0')}.png`)));
		const [, args] = encoder.log.find(([kind]) => kind === 'exec');
		assert.equal(args[1], '30');
		assert.ok(args[3].endsWith('%05d.png') && writes[0].startsWith(args[3].replace('%05d.png', '')));
		assert.ok(args.includes('libvpx'));
		assert.ok(args.at(-1).endsWith('.webm'));
		assert.equal(encoder.files.size, 0);
		assert.equal(encoder.log.filter(([kind]) => kind === 'delete').length, 4);
		assert.deepEqual(progress.slice(0, 3), [
			{ phase: 'frames', done: 1, total: 3 },
			{ phase: 'frames', done: 2, total: 3 },
			{ phase: 'frames', done: 3, total: 3 },
		]);
		assert.deepEqual(progress.at(-1), { phase: 'encode', done: 0, total: 1 });

		const failing = createFakeEncoder({ exitCode: 1 });
		await assert.rejects(
			renderMorphVideo({ morph, settings, ffmpegRuntime: failing.runtime, canvas: createFakeCanvas(context) }),
			/exited with code 1/,
		);
		assert.equal(failing.files.size, 0);
	} finally {
		if (originalPath === undefined) delete globalThis.Path2D;
		else globalThis.Path2D = originalPath;
	}
});
