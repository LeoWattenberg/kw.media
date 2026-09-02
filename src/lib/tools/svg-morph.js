import flubberModule from 'flubber';
import svgpath from 'svgpath';

/* The UMD build is the only entry that resolves the same way in Node tests and in the
   Vite bundle, and depending on the environment it arrives as the namespace itself or
   as its default export. */
const flubber = flubberModule.interpolate ? flubberModule : flubberModule.default;

export const MORPH_FRAME_RATES = [24, 25, 30, 50, 60];

export const MORPH_LIMITS = {
	hold: { min: 0, max: 10 },
	duration: { min: 0.1, max: 10 },
	size: { min: 16, max: 4096 },
	margin: { min: 0, max: 40 },
};

const backConstant = 1.70158;

/* Every curve maps [0, 1] onto [0, 1] with fixed end points so the hold frames on either
   side of the morph always show the untouched source and target shapes. */
export const MORPH_EASINGS = [
	{ id: 'linear', ease: (t) => t },
	{ id: 'ease-in-out', ease: (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2) },
	{ id: 'gentle', ease: (t) => -(Math.cos(Math.PI * t) - 1) / 2 },
	{ id: 'ease-in', ease: (t) => t * t * t },
	{ id: 'ease-out', ease: (t) => 1 - ((1 - t) ** 3) },
	{ id: 'ease-in-fast', ease: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)) },
	{ id: 'ease-out-fast', ease: (t) => (t >= 1 ? 1 : 1 - (2 ** (-10 * t))) },
	{
		id: 'snap',
		ease: (t) => {
			if (t <= 0) return 0;
			if (t >= 1) return 1;
			return t < 0.5 ? (2 ** (20 * t - 10)) / 2 : (2 - (2 ** (-20 * t + 10))) / 2;
		},
	},
	{ id: 'overshoot', ease: (t) => 1 + (backConstant + 1) * ((t - 1) ** 3) + backConstant * ((t - 1) ** 2) },
	{
		id: 'anticipate',
		ease: (t) => {
			const c2 = backConstant * 1.525;
			return t < 0.5
				? (((2 * t) ** 2) * ((c2 + 1) * 2 * t - c2)) / 2
				: (((2 * t - 2) ** 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
		},
	},
];

export const MORPH_OUTPUT_FORMATS = [
	{ id: 'prores-4444', extension: 'mov', mime: 'video/quicktime', codec: 'prores_ks', playable: false },
	{ id: 'qt-animation', extension: 'mov', mime: 'video/quicktime', codec: 'qtrle', playable: false },
	{ id: 'png-mov', extension: 'mov', mime: 'video/quicktime', codec: 'png', playable: false },
	/* VP8 rather than VP9: encoding a VP9 alpha plane aborts the ffmpeg.wasm 0.12 core and takes the page with it. */
	{ id: 'webm-vp8', extension: 'webm', mime: 'video/webm', codec: 'libvpx', playable: true },
];

export const DEFAULT_MORPH_SETTINGS = {
	holdStart: 1,
	holdEnd: 1,
	duration: 1.5,
	fps: 30,
	width: 1920,
	height: 1080,
	margin: 10,
	easing: 'ease-in-out',
	format: 'prores-4444',
};

export function easingFunction(id) {
	return (MORPH_EASINGS.find((easing) => easing.id === id) ?? MORPH_EASINGS[0]).ease;
}

export function outputFormat(id) {
	return MORPH_OUTPUT_FORMATS.find((format) => format.id === id) ?? MORPH_OUTPUT_FORMATS[0];
}

export function clamp(value, min, max) {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, value));
}

function roundTo(value, decimals) {
	const factor = 10 ** decimals;
	return Math.round(value * factor) / factor;
}

export function normalizeMorphSettings(raw = {}) {
	const defaults = DEFAULT_MORPH_SETTINGS;
	const number = (value, fallback) => {
		const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
		return Number.isFinite(parsed) ? parsed : fallback;
	};
	const fps = number(raw.fps, defaults.fps);
	const width = Math.round(clamp(number(raw.width, defaults.width), MORPH_LIMITS.size.min, MORPH_LIMITS.size.max));
	const height = Math.round(clamp(number(raw.height, defaults.height), MORPH_LIMITS.size.min, MORPH_LIMITS.size.max));

	return {
		holdStart: roundTo(clamp(number(raw.holdStart, defaults.holdStart), MORPH_LIMITS.hold.min, MORPH_LIMITS.hold.max), 2),
		holdEnd: roundTo(clamp(number(raw.holdEnd, defaults.holdEnd), MORPH_LIMITS.hold.min, MORPH_LIMITS.hold.max), 2),
		duration: roundTo(clamp(number(raw.duration, defaults.duration), MORPH_LIMITS.duration.min, MORPH_LIMITS.duration.max), 2),
		/* Every encoder here accepts odd sizes except VP8's 4:2:0 alpha, so even sizes keep the four formats interchangeable. */
		width: width + (width % 2),
		height: height + (height % 2),
		fps: MORPH_FRAME_RATES.reduce((best, candidate) => (Math.abs(candidate - fps) < Math.abs(best - fps) ? candidate : best), MORPH_FRAME_RATES[0]),
		margin: Math.round(clamp(number(raw.margin, defaults.margin), MORPH_LIMITS.margin.min, MORPH_LIMITS.margin.max)),
		easing: MORPH_EASINGS.some((easing) => easing.id === raw.easing) ? raw.easing : defaults.easing,
		format: MORPH_OUTPUT_FORMATS.some((format) => format.id === raw.format) ? raw.format : defaults.format,
	};
}

/* Frames are counted rather than sampled from wall time so the first frame is exactly the
   source, the last morph frame is exactly the target, and the clip length is the sum of
   the three segments to the frame. */
export function morphTimeline(settings) {
	const ease = easingFunction(settings.easing);
	const startFrames = Math.round(settings.holdStart * settings.fps);
	const morphFrames = Math.max(2, Math.round(settings.duration * settings.fps));
	const endFrames = Math.round(settings.holdEnd * settings.fps);
	const frameCount = startFrames + morphFrames + endFrames;
	const loopDuration = settings.holdStart + settings.duration + settings.holdEnd;

	return {
		frameCount,
		startFrames,
		morphFrames,
		endFrames,
		totalDuration: frameCount / settings.fps,
		loopDuration,
		progressAt(frame) {
			if (frame < startFrames) return 0;
			if (frame >= startFrames + morphFrames) return 1;
			return ease((frame - startFrames) / (morphFrames - 1));
		},
		progressAtTime(seconds) {
			return ease(clamp((seconds - settings.holdStart) / settings.duration, 0, 1));
		},
	};
}

export function buildMorphVideoArgs(formatId, { fps, framePattern, outputName }) {
	const format = outputFormat(formatId);
	const input = ['-framerate', String(fps), '-i', framePattern];
	const codecArgs = {
		'prores-4444': ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'],
		'qt-animation': ['-c:v', 'qtrle', '-pix_fmt', 'argb'],
		'png-mov': ['-c:v', 'png', '-pix_fmt', 'rgba'],
		'webm-vp8': ['-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-b:v', '6M', '-crf', '10', '-deadline', 'good', '-cpu-used', '2', '-auto-alt-ref', '0'],
	}[format.id];

	return [...input, ...codecArgs, '-r', String(fps), '-y', outputName];
}

export function morphOutputName(fromName, toName, formatId) {
	const format = outputFormat(formatId);
	const stem = (name, fallback) => String(name || '')
		.replace(/\.[^.]+$/, '')
		.replace(/[^\p{L}\p{N}]+/gu, '-')
		.replace(/^-+|-+$/g, '')
		.toLowerCase() || fallback;
	return `${stem(fromName, 'shape-a')}-to-${stem(toName, 'shape-b')}.${format.extension}`;
}

/* --- colours ---------------------------------------------------------------- */

const namedColors = {
	black: [0, 0, 0],
	white: [255, 255, 255],
	red: [255, 0, 0],
	green: [0, 128, 0],
	lime: [0, 255, 0],
	blue: [0, 0, 255],
	yellow: [255, 255, 0],
	cyan: [0, 255, 255],
	magenta: [255, 0, 255],
	gray: [128, 128, 128],
	grey: [128, 128, 128],
	orange: [255, 165, 0],
};

export function parseColor(value) {
	const text = String(value ?? '').trim().toLowerCase();
	if (!text || text === 'none' || text === 'transparent') {
		return null;
	}

	const hex = text.match(/^#([0-9a-f]{3,8})$/);
	if (hex) {
		const digits = hex[1];
		if (digits.length === 3 || digits.length === 4) {
			const [r, g, b, a = 'ff'] = digits.split('').map((digit) => digit + digit);
			return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16), a: parseInt(a, 16) / 255 };
		}
		if (digits.length === 6 || digits.length === 8) {
			return {
				r: parseInt(digits.slice(0, 2), 16),
				g: parseInt(digits.slice(2, 4), 16),
				b: parseInt(digits.slice(4, 6), 16),
				a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
			};
		}
		return null;
	}

	const functional = text.match(/^rgba?\(\s*([^)]+)\)$/);
	if (functional) {
		const parts = functional[1].split(/[\s,/]+/).filter(Boolean);
		if (parts.length < 3) return null;
		const channel = (part) => (part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part));
		const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? Number.parseFloat(parts[3]) / 100 : Number.parseFloat(parts[3]);
		const color = { r: channel(parts[0]), g: channel(parts[1]), b: channel(parts[2]), a: alpha };
		return [color.r, color.g, color.b, color.a].every(Number.isFinite)
			? { r: clamp(color.r, 0, 255), g: clamp(color.g, 0, 255), b: clamp(color.b, 0, 255), a: clamp(color.a, 0, 1) }
			: null;
	}

	if (namedColors[text]) {
		const [r, g, b] = namedColors[text];
		return { r, g, b, a: 1 };
	}

	return null;
}

export function withAlpha(color, multiplier) {
	if (!color) return null;
	const alpha = clamp(color.a * multiplier, 0, 1);
	return alpha <= 0 ? null : { ...color, a: alpha };
}

export function colorToCss(color) {
	if (!color) return null;
	return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${roundTo(color.a, 3)})`;
}

/* A missing colour on one side keeps the other side's hue and fades through alpha, so a
   shape that appears or disappears does not flash through grey on its way. */
export function mixColors(from, to, t) {
	if (!from && !to) return null;
	if (!from) return withAlpha(to, t);
	if (!to) return withAlpha(from, 1 - t);
	return {
		r: from.r + (to.r - from.r) * t,
		g: from.g + (to.g - from.g) * t,
		b: from.b + (to.b - from.b) * t,
		a: from.a + (to.a - from.a) * t,
	};
}

export function mixStrokes(from, to, t) {
	if (!from && !to) return null;
	const color = mixColors(from?.color ?? null, to?.color ?? null, t);
	const width = (from?.width ?? 0) + ((to?.width ?? 0) - (from?.width ?? 0)) * t;
	if (!color || width <= 0) return null;
	const source = t < 0.5 ? (from ?? to) : (to ?? from);
	return { color, width, join: source.join ?? 'round', cap: source.cap ?? 'round' };
}

/* --- matrices --------------------------------------------------------------- */

export const IDENTITY_MATRIX = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/* Returns the matrix that applies `inner` first and `outer` second. */
export function composeMatrices(outer, inner) {
	return {
		a: outer.a * inner.a + outer.c * inner.b,
		b: outer.b * inner.a + outer.d * inner.b,
		c: outer.a * inner.c + outer.c * inner.d,
		d: outer.b * inner.c + outer.d * inner.d,
		e: outer.a * inner.e + outer.c * inner.f + outer.e,
		f: outer.b * inner.e + outer.d * inner.f + outer.f,
	};
}

export function applyMatrix(matrix, [x, y]) {
	return [matrix.a * x + matrix.c * y + matrix.e, matrix.b * x + matrix.d * y + matrix.f];
}

export function matrixScale(matrix) {
	return Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c));
}

export function matrixToTransform(matrix) {
	return `matrix(${[matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].join(' ')})`;
}

/* Contain-fits a viewBox into the output frame, centred, with a margin in percent of the frame. */
export function fitViewBoxMatrix(viewBox, width, height, marginPercent = 0) {
	const margin = clamp(marginPercent, 0, 45) / 100;
	const innerWidth = width * (1 - 2 * margin);
	const innerHeight = height * (1 - 2 * margin);
	const boxWidth = viewBox.width > 0 ? viewBox.width : 1;
	const boxHeight = viewBox.height > 0 ? viewBox.height : 1;
	const scale = Math.min(innerWidth / boxWidth, innerHeight / boxHeight);

	return {
		a: scale,
		b: 0,
		c: 0,
		d: scale,
		e: (width - boxWidth * scale) / 2 - viewBox.x * scale,
		f: (height - boxHeight * scale) / 2 - viewBox.y * scale,
	};
}

/* --- basic shapes ----------------------------------------------------------- */

/* Turns the non-path SVG shapes into path data so one flattener serves all of them. */
export function shapeToPathData(tag, attrs = {}) {
	const n = (key, fallback = 0) => (Number.isFinite(attrs[key]) ? attrs[key] : fallback);

	switch (tag) {
		case 'path':
			return String(attrs.d ?? '');
		case 'rect': {
			const x = n('x');
			const y = n('y');
			const width = n('width');
			const height = n('height');
			if (width <= 0 || height <= 0) return '';
			let rx = Number.isFinite(attrs.rx) ? attrs.rx : Number.isFinite(attrs.ry) ? attrs.ry : 0;
			let ry = Number.isFinite(attrs.ry) ? attrs.ry : rx;
			rx = clamp(rx, 0, width / 2);
			ry = clamp(ry, 0, height / 2);
			if (rx <= 0 || ry <= 0) {
				return `M${x} ${y}H${x + width}V${y + height}H${x}Z`;
			}
			return [
				`M${x + rx} ${y}`,
				`H${x + width - rx}`,
				`A${rx} ${ry} 0 0 1 ${x + width} ${y + ry}`,
				`V${y + height - ry}`,
				`A${rx} ${ry} 0 0 1 ${x + width - rx} ${y + height}`,
				`H${x + rx}`,
				`A${rx} ${ry} 0 0 1 ${x} ${y + height - ry}`,
				`V${y + ry}`,
				`A${rx} ${ry} 0 0 1 ${x + rx} ${y}`,
				'Z',
			].join('');
		}
		case 'circle':
		case 'ellipse': {
			const cx = n('cx');
			const cy = n('cy');
			const rx = tag === 'circle' ? n('r') : n('rx');
			const ry = tag === 'circle' ? n('r') : n('ry');
			if (rx <= 0 || ry <= 0) return '';
			return `M${cx + rx} ${cy}A${rx} ${ry} 0 1 1 ${cx - rx} ${cy}A${rx} ${ry} 0 1 1 ${cx + rx} ${cy}Z`;
		}
		case 'line':
			return `M${n('x1')} ${n('y1')}L${n('x2')} ${n('y2')}`;
		case 'polyline':
		case 'polygon': {
			const points = Array.isArray(attrs.points) ? attrs.points : [];
			if (points.length < 2) return '';
			const data = points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join('');
			return tag === 'polygon' ? `${data}Z` : data;
		}
		default:
			return '';
	}
}

/* --- flattening ------------------------------------------------------------- */

const MAX_RING_POINTS = 720;

function distance(a, b) {
	return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function samePoint(a, b) {
	return Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;
}

/*
 * Samples path data into polylines: straight segments keep their exact end points so corners
 * survive, curves are subdivided to `step` pixels. Arcs and shorthand curves are normalised
 * away first, and the matrix is applied before sampling so `step` is measured in output space.
 */
export function flattenPathData(d, { matrix = null, step = 2 } = {}) {
	if (!d || !String(d).trim()) return [];

	let path = svgpath(String(d)).abs().unshort().unarc();
	if (path.err) {
		throw new Error(`Invalid path data: ${path.err}`);
	}
	if (matrix) {
		/* Transforms are lazy in svgpath; a string round trip evaluates them into the segments. */
		path = svgpath(path.transform(matrixToTransform(matrix)).toString()).abs();
	}

	const segments = path.segments;
	const approximateLength = estimateLength(segments);
	const spacing = Math.max(step, approximateLength / MAX_RING_POINTS);
	const subpaths = [];
	let current = null;
	let start = [0, 0];
	let cursor = [0, 0];

	const begin = (point) => {
		current = { points: [point.slice()], closed: false };
		subpaths.push(current);
	};
	const add = (point) => {
		if (!current) begin(cursor);
		if (!samePoint(current.points[current.points.length - 1], point)) {
			current.points.push([point[0], point[1]]);
		}
		cursor = point;
	};
	const curve = (evaluate, controlLength) => {
		const steps = Math.max(1, Math.min(400, Math.ceil(controlLength / spacing)));
		for (let index = 1; index <= steps; index += 1) {
			add(evaluate(index / steps));
		}
	};

	for (const segment of segments) {
		const [command, ...values] = segment;
		switch (command) {
			case 'M':
				start = [values[0], values[1]];
				cursor = start;
				begin(start);
				break;
			case 'L':
				add([values[0], values[1]]);
				break;
			case 'H':
				add([values[0], cursor[1]]);
				break;
			case 'V':
				add([cursor[0], values[0]]);
				break;
			case 'C': {
				const [x1, y1, x2, y2, x, y] = values;
				const from = cursor;
				curve((t) => cubicPoint(from, [x1, y1], [x2, y2], [x, y], t), distance(from, [x1, y1]) + distance([x1, y1], [x2, y2]) + distance([x2, y2], [x, y]));
				break;
			}
			case 'Q': {
				const [x1, y1, x, y] = values;
				const from = cursor;
				curve((t) => quadraticPoint(from, [x1, y1], [x, y], t), distance(from, [x1, y1]) + distance([x1, y1], [x, y]));
				break;
			}
			case 'Z':
				if (current) current.closed = true;
				cursor = start;
				current = null;
				break;
			default:
				break;
		}
	}

	return subpaths
		.map((subpath) => {
			const points = subpath.points;
			if (points.length > 1 && samePoint(points[0], points[points.length - 1])) {
				points.pop();
			}
			return { points: decimate(points, MAX_RING_POINTS), closed: subpath.closed };
		})
		.filter((subpath) => subpath.points.length >= 2);
}

function estimateLength(segments) {
	let total = 0;
	let cursor = [0, 0];
	let start = [0, 0];
	for (const [command, ...values] of segments) {
		if (command === 'M') {
			start = [values[0], values[1]];
			cursor = start;
		} else if (command === 'L') {
			total += distance(cursor, [values[0], values[1]]);
			cursor = [values[0], values[1]];
		} else if (command === 'H') {
			total += Math.abs(values[0] - cursor[0]);
			cursor = [values[0], cursor[1]];
		} else if (command === 'V') {
			total += Math.abs(values[0] - cursor[1]);
			cursor = [cursor[0], values[0]];
		} else if (command === 'C') {
			total += distance(cursor, [values[0], values[1]]) + distance([values[0], values[1]], [values[2], values[3]]) + distance([values[2], values[3]], [values[4], values[5]]);
			cursor = [values[4], values[5]];
		} else if (command === 'Q') {
			total += distance(cursor, [values[0], values[1]]) + distance([values[0], values[1]], [values[2], values[3]]);
			cursor = [values[2], values[3]];
		} else if (command === 'Z') {
			total += distance(cursor, start);
			cursor = start;
		}
	}
	return total;
}

function cubicPoint(p0, p1, p2, p3, t) {
	const u = 1 - t;
	return [
		u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
		u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
	];
}

function quadraticPoint(p0, p1, p2, t) {
	const u = 1 - t;
	return [
		u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
		u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
	];
}

/* Keeps every k-th vertex once a traced outline exceeds the budget flubber's rotation search can afford. */
function decimate(points, limit) {
	if (points.length <= limit) return points;
	const stride = Math.ceil(points.length / limit);
	return points.filter((_point, index) => index % stride === 0);
}

/* --- ring geometry ---------------------------------------------------------- */

export function ringArea(ring) {
	let area = 0;
	for (let index = 0, count = ring.length; index < count; index += 1) {
		const [x1, y1] = ring[index];
		const [x2, y2] = ring[(index + 1) % count];
		area += x1 * y2 - x2 * y1;
	}
	return area / 2;
}

export function ringBounds(ring) {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const [x, y] of ring) {
		minX = Math.min(minX, x);
		minY = Math.min(minY, y);
		maxX = Math.max(maxX, x);
		maxY = Math.max(maxY, y);
	}
	return { minX, minY, maxX, maxY };
}

export function ringCentroid(ring) {
	const area = ringArea(ring);
	if (Math.abs(area) < 1e-9 || ring.length < 3) {
		const sum = ring.reduce((acc, [x, y]) => [acc[0] + x, acc[1] + y], [0, 0]);
		return ring.length ? [sum[0] / ring.length, sum[1] / ring.length] : [0, 0];
	}
	let cx = 0;
	let cy = 0;
	for (let index = 0, count = ring.length; index < count; index += 1) {
		const [x1, y1] = ring[index];
		const [x2, y2] = ring[(index + 1) % count];
		const cross = x1 * y2 - x2 * y1;
		cx += (x1 + x2) * cross;
		cy += (y1 + y2) * cross;
	}
	return [cx / (6 * area), cy / (6 * area)];
}

export function pointInRing([px, py], ring) {
	let inside = false;
	for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
		const [xi, yi] = ring[index];
		const [xj, yj] = ring[previous];
		const crosses = (yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
		if (crosses) inside = !inside;
	}
	return inside;
}

export function thereAndBackRing(points) {
	if (points.length < 2) return points.slice();
	return [...points, ...points.slice(1, -1).reverse()];
}

/*
 * Sorts an element's subpaths into outlines and the holes cut into them, following the fill
 * rule the element was drawn with: even-odd counts nesting depth, non-zero adds up winding
 * directions. Each outline becomes one unit that carries the holes directly inside it.
 */
export function classifyRings(rings, fillRule = 'nonzero') {
	const infos = rings.map((ring, index) => ({
		index,
		ring,
		area: ringArea(ring),
		size: Math.abs(ringArea(ring)),
		bounds: ringBounds(ring),
		parent: null,
		depth: 0,
		winding: 0,
		hole: false,
	}));
	const bySize = [...infos].sort((left, right) => right.size - left.size);

	for (const info of bySize) {
		let parent = null;
		for (const candidate of bySize) {
			if (candidate === info || candidate.size <= info.size) continue;
			if (!boundsContain(candidate.bounds, info.bounds)) continue;
			if (!ringContains(candidate.ring, info.ring)) continue;
			if (!parent || candidate.size < parent.size) parent = candidate;
		}
		info.parent = parent;
		info.depth = parent ? parent.depth + 1 : 0;
		info.winding = (parent ? parent.winding : 0) + Math.sign(info.area || 1);
		info.hole = fillRule === 'evenodd' ? info.depth % 2 === 1 : info.winding === 0;
	}

	const units = [];
	const unitByInfo = new Map();
	for (const info of infos) {
		if (info.hole) continue;
		const unit = { outer: info.ring, holes: [] };
		units.push(unit);
		unitByInfo.set(info, unit);
	}
	for (const info of infos) {
		if (!info.hole) continue;
		let owner = info.parent;
		while (owner && owner.hole) owner = owner.parent;
		if (owner && unitByInfo.has(owner)) {
			unitByInfo.get(owner).holes.push(info.ring);
		} else {
			units.push({ outer: info.ring, holes: [] });
		}
	}
	return units;
}

function boundsContain(outer, inner) {
	const slack = 1e-6;
	return outer.minX - slack <= inner.minX && outer.minY - slack <= inner.minY
		&& outer.maxX + slack >= inner.maxX && outer.maxY + slack >= inner.maxY;
}

function ringContains(outer, inner) {
	const samples = [0, Math.floor(inner.length / 3), Math.floor((2 * inner.length) / 3)]
		.map((index) => inner[Math.min(index, inner.length - 1)]);
	const insideCount = samples.filter((point) => pointInRing(point, outer)).length;
	return insideCount * 2 > samples.length;
}

/* --- units ------------------------------------------------------------------ */

/*
 * Converts one extracted element into morph units. Filled elements are rings with holes;
 * stroke-only elements keep open paths as there-and-back rings so their stroke still draws
 * the original line while staying a closed ring flubber can interpolate.
 */
export function buildShapeUnits(element, order = 0) {
	const fill = element.fill ?? null;
	const stroke = element.stroke && element.stroke.color && element.stroke.width > 0 ? element.stroke : null;
	const subpaths = (element.subpaths ?? []).filter((subpath) => subpath.points.length >= 2);
	if (!subpaths.length || (!fill && !stroke)) return [];

	if (fill) {
		const rings = subpaths.map((subpath) => subpath.points).filter((ring) => ring.length >= 3);
		return classifyRings(rings, element.fillRule ?? 'nonzero').map((unit, index) => ({
			...unit,
			fill,
			stroke,
			order: order + index * 1e-3,
		}));
	}

	return subpaths.map((subpath, index) => ({
		outer: subpath.closed ? subpath.points : thereAndBackRing(subpath.points),
		holes: [],
		fill: null,
		stroke,
		order: order + index * 1e-3,
	}));
}

/* --- matching --------------------------------------------------------------- */

function unitCentroid(unit) {
	return unit.centroid ?? (unit.centroid = ringCentroid(unit.outer));
}

function unitSize(unit) {
	return unit.size ?? (unit.size = Math.sqrt(Math.abs(ringArea(unit.outer))));
}

function pairCost(left, right) {
	const [ax, ay] = unitCentroid(left);
	const [bx, by] = unitCentroid(right);
	return Math.hypot(ax - bx, ay - by) + 0.35 * Math.abs(unitSize(left) - unitSize(right));
}

/*
 * Pairs shapes across the two drawings by position and size. When the counts differ every
 * shape on the larger side still gets a partner: the smaller side's shapes are matched first,
 * then the leftovers join their nearest partner's group, which flubber later splits or merges.
 */
export function matchShapeGroups(fromUnits, toUnits) {
	if (!fromUnits.length || !toUnits.length) {
		return [];
	}

	const fromIsSmaller = fromUnits.length <= toUnits.length;
	const small = fromIsSmaller ? fromUnits : toUnits;
	const large = fromIsSmaller ? toUnits : fromUnits;
	const costs = [];
	for (let s = 0; s < small.length; s += 1) {
		for (let l = 0; l < large.length; l += 1) {
			costs.push({ s, l, cost: pairCost(small[s], large[l]) });
		}
	}
	costs.sort((left, right) => left.cost - right.cost || left.s - right.s || left.l - right.l);

	const groups = small.map(() => []);
	const assignedSmall = new Set();
	const assignedLarge = new Set();
	for (const { s, l } of costs) {
		if (assignedSmall.has(s) || assignedLarge.has(l)) continue;
		assignedSmall.add(s);
		assignedLarge.add(l);
		groups[s].push(l);
	}
	for (let l = 0; l < large.length; l += 1) {
		if (assignedLarge.has(l)) continue;
		let best = 0;
		let bestCost = Infinity;
		for (let s = 0; s < small.length; s += 1) {
			const cost = pairCost(small[s], large[l]);
			if (cost < bestCost) {
				bestCost = cost;
				best = s;
			}
		}
		groups[best].push(l);
	}

	return groups.map((members, s) => {
		const sorted = [...members].sort((left, right) => left - right);
		return fromIsSmaller ? { from: [s], to: sorted } : { from: sorted, to: [s] };
	});
}

/* --- interpolation ---------------------------------------------------------- */

/* Small enough that a collapsed hole or shape never covers a pixel, even when a tiny frame is previewed at 10x. */
const COLLAPSE_RADIUS = 0.001;
const DEFAULT_SEGMENT_LENGTH = 6;

function ringPath(ring) {
	return `M${ring.map(([x, y]) => `${x},${y}`).join('L')}Z`;
}

function interpolateRings(from, to, maxSegmentLength) {
	try {
		return flubber.interpolate(from, to, { maxSegmentLength, string: true });
	} catch {
		const fromPath = ringPath(from);
		const toPath = ringPath(to);
		return (t) => (t < 0.5 ? fromPath : toPath);
	}
}

function collapseRing(ring, direction, maxSegmentLength) {
	const [cx, cy] = ringCentroid(ring);
	try {
		return direction === 'out'
			? flubber.toCircle(ring, cx, cy, COLLAPSE_RADIUS, { maxSegmentLength, string: true })
			: flubber.fromCircle(cx, cy, COLLAPSE_RADIUS, ring, { maxSegmentLength, string: true });
	} catch {
		const path = ringPath(ring);
		return (t) => ((direction === 'out' ? t < 0.5 : t >= 0.5) ? path : '');
	}
}

function pairHoles(fromHoles, toHoles, maxSegmentLength) {
	const interpolators = [];
	const groups = matchShapeGroups(
		fromHoles.map((outer) => ({ outer })),
		toHoles.map((outer) => ({ outer })),
	);
	const usedFrom = new Set();
	const usedTo = new Set();
	for (const group of groups) {
		if (group.from.length === 1 && group.to.length === 1) {
			usedFrom.add(group.from[0]);
			usedTo.add(group.to[0]);
			interpolators.push(interpolateRings(fromHoles[group.from[0]], toHoles[group.to[0]], maxSegmentLength));
		}
	}
	fromHoles.forEach((ring, index) => {
		if (!usedFrom.has(index)) interpolators.push(collapseRing(ring, 'out', maxSegmentLength));
	});
	toHoles.forEach((ring, index) => {
		if (!usedTo.has(index)) interpolators.push(collapseRing(ring, 'in', maxSegmentLength));
	});
	return interpolators;
}

function isDegenerate(unit) {
	return Math.abs(ringArea(unit.outer)) < 1e-6;
}

function piece(outer, holes, fromUnit, toUnit) {
	return {
		outer,
		holes,
		fill: [fromUnit?.fill ?? null, toUnit?.fill ?? null],
		stroke: [fromUnit?.stroke ?? null, toUnit?.stroke ?? null],
		order: [fromUnit?.order ?? toUnit?.order ?? 0, toUnit?.order ?? fromUnit?.order ?? 0],
	};
}

function splitPieces(single, many, mode, maxSegmentLength) {
	let interpolators = null;
	if (!isDegenerate(single) && many.every((unit) => !isDegenerate(unit))) {
		try {
			interpolators = mode === 'separate'
				? flubber.separate(single.outer, many.map((unit) => unit.outer), { maxSegmentLength, string: true })
				: flubber.combine(many.map((unit) => unit.outer), single.outer, { maxSegmentLength, string: true });
		} catch {
			interpolators = null;
		}
	}
	if (!interpolators) {
		/* Zero-area strokes cannot be triangulated, so the single shape is cloned into every partner instead. */
		interpolators = many.map((unit) => (mode === 'separate'
			? interpolateRings(single.outer, unit.outer, maxSegmentLength)
			: interpolateRings(unit.outer, single.outer, maxSegmentLength)));
	}

	return interpolators.map((outer, index) => {
		const partner = many[index];
		const fromUnit = mode === 'separate' ? single : partner;
		const toUnit = mode === 'separate' ? partner : single;
		/* The single side's holes ride along with the first piece; every hole grows from or shrinks to a point. */
		const holes = [
			...(index === 0 ? single.holes.map((ring) => collapseRing(ring, mode === 'separate' ? 'out' : 'in', maxSegmentLength)) : []),
			...partner.holes.map((ring) => collapseRing(ring, mode === 'separate' ? 'in' : 'out', maxSegmentLength)),
		];
		return piece(outer, holes, fromUnit, toUnit);
	});
}

/*
 * Builds the morph between two lists of units. `frame(t)` returns drawable shapes for one
 * moment: an outline path, hole paths to subtract with the even-odd rule, blended paint,
 * and a stacking order that slides from the source order to the target order.
 */
export function createMorph(fromUnits, toUnits, { maxSegmentLength = DEFAULT_SEGMENT_LENGTH } = {}) {
	const fromList = normalizeOrders(fromUnits);
	const toList = normalizeOrders(toUnits);
	const pieces = [];

	if (!fromList.length || !toList.length) {
		for (const unit of fromList) {
			pieces.push(piece(collapseRing(unit.outer, 'out', maxSegmentLength), unit.holes.map((ring) => collapseRing(ring, 'out', maxSegmentLength)), unit, null));
		}
		for (const unit of toList) {
			pieces.push(piece(collapseRing(unit.outer, 'in', maxSegmentLength), unit.holes.map((ring) => collapseRing(ring, 'in', maxSegmentLength)), null, unit));
		}
	}

	for (const group of matchShapeGroups(fromList, toList)) {
		if (group.from.length === 1 && group.to.length === 1) {
			const fromUnit = fromList[group.from[0]];
			const toUnit = toList[group.to[0]];
			pieces.push(piece(
				interpolateRings(fromUnit.outer, toUnit.outer, maxSegmentLength),
				pairHoles(fromUnit.holes, toUnit.holes, maxSegmentLength),
				fromUnit,
				toUnit,
			));
		} else if (group.from.length === 1) {
			pieces.push(...splitPieces(fromList[group.from[0]], group.to.map((index) => toList[index]), 'separate', maxSegmentLength));
		} else {
			pieces.push(...splitPieces(toList[group.to[0]], group.from.map((index) => fromList[index]), 'combine', maxSegmentLength));
		}
	}

	return {
		pieces,
		frame(t) {
			const clamped = clamp(t, -1, 2);
			return pieces
				.map((entry) => ({
					path: entry.outer(clamped),
					holes: entry.holes.map((hole) => hole(clamped)).filter(Boolean),
					fill: mixColors(entry.fill[0], entry.fill[1], clamped),
					stroke: mixStrokes(entry.stroke[0], entry.stroke[1], clamped),
					order: entry.order[0] + (entry.order[1] - entry.order[0]) * clamped,
				}))
				.sort((left, right) => left.order - right.order);
		},
	};
}

/* Stacking orders come from element positions in two unrelated documents, so both sides are
   mapped onto [0, 1] before they can be blended. */
function normalizeOrders(units) {
	const list = units.map((unit) => ({ ...unit, holes: unit.holes ?? [] }));
	const orders = list.map((unit) => unit.order ?? 0);
	const min = Math.min(...orders, 0);
	const max = Math.max(...orders, 0);
	const span = max - min || 1;
	return list.map((unit) => ({ ...unit, order: ((unit.order ?? 0) - min) / span }));
}
