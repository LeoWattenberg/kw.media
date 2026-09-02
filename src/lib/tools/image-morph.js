/*
 * Distance-field morph between two still images.
 *
 * A cross-dissolve doubles every outline and averages colours toward mud, and an optical-flow warp
 * needs matching texture that flat artwork never has. This morph reads every pixel as "ink" (how far
 * its colour sits from the picture's background), cuts the ink at a few thresholds into nested
 * silhouettes, turns each silhouette into a signed distance field, blends the fields of both images
 * and re-thresholds the blend. Outlines stay crisp all the way through; parts that have no partner in
 * the other picture shrink away and regrow instead of ghosting.
 */

import { baseName } from './media-file.js';

export const EASINGS = {
	linear: (t) => t,
	'ease-in-out': (t) => t * t * (3 - 2 * t),
	/* Sits on both pictures longer and crosses the middle quickly: a steep symmetric sigmoid. */
	'fast-ease-in-out': (t) => {
		const rise = t ** 4;
		const fall = (1 - t) ** 4;
		return rise / (rise + fall);
	},
	'ease-in': (t) => t * t * t,
	'ease-out': (t) => 1 - (1 - t) ** 3,
};

export const EASING_IDS = Object.keys(EASINGS);

export const MORPH_FORMATS = [
	{ value: 'mp4', extension: '.mp4', mimeType: 'video/mp4' },
	{ value: 'webm', extension: '.webm', mimeType: 'video/webm' },
];

export const MORPH_SIZES = [360, 480, 720, 1080];
export const MORPH_FRAME_RATES = [12, 24, 30, 60];

/*
 * Distances are capped at this share of the longer edge. An empty silhouette would otherwise be
 * infinitely far away, and a part of the second picture with no partner in the first would pop in
 * on the final frame instead of growing from its core.
 */
const FAR_FIELD = 0.25;
const INF = 1e20;

export function ease(id, t) {
	const clamped = Number.isFinite(t) ? Math.min(1, Math.max(0, t)) : 0;
	return (EASINGS[id] ?? EASINGS.linear)(clamped);
}

export function clamp(value, min, max, fallback = min) {
	if (!Number.isFinite(value)) {
		return fallback;
	}
	return Math.min(max, Math.max(min, value));
}

export function roundToTenths(value) {
	return Math.round(value * 10) / 10;
}

/* H.264 and VP8 in yuv420p need even dimensions, so every size the tool hands FFmpeg is even. */
export function evenSize(value) {
	return Math.max(2, Math.round(value / 2) * 2);
}

export function normalizeHexColor(value, fallback = '#ffffff') {
	const text = String(value ?? '').trim().toLowerCase();
	if (/^#[0-9a-f]{6}$/.test(text)) {
		return text;
	}
	if (/^#[0-9a-f]{3}$/.test(text)) {
		return `#${[...text.slice(1)].map((digit) => digit + digit).join('')}`;
	}
	return fallback;
}

export function hexToRgb(value) {
	const text = normalizeHexColor(value);
	return [parseInt(text.slice(1, 3), 16), parseInt(text.slice(3, 5), 16), parseInt(text.slice(5, 7), 16)];
}

export function normalizeMorphSettings(raw = {}) {
	return {
		hold: roundToTenths(clamp(Number(raw.hold), 0, 10, 1)),
		duration: roundToTenths(clamp(Number(raw.duration), 0.1, 10, 1.5)),
		easing: EASING_IDS.includes(raw.easing) ? raw.easing : 'ease-in-out',
		levels: Math.round(clamp(Number(raw.levels), 1, 8, 3)),
		size: evenSize(clamp(Number(raw.size), 64, 1920, 720)),
		fps: Math.round(clamp(Number(raw.fps), 1, 60, 30)),
		format: MORPH_FORMATS.some((profile) => profile.value === raw.format) ? raw.format : 'mp4',
		background: normalizeHexColor(raw.background),
		loop: Boolean(raw.loop),
	};
}

/* Seconds the finished clip runs: hold, morph, hold, and the way back again when it loops. */
export function timelineDuration({ hold, duration, loop }) {
	return loop ? 2 * (hold + duration) : 2 * hold + duration;
}

/* Raw morph progress at a moment of the clip, before easing: 0 shows the first picture, 1 the second. */
export function morphProgress(time, settings) {
	const { hold, duration, loop } = settings;
	const total = timelineDuration(settings);
	const at = loop ? ((time % total) + total) % total : time;

	if (at <= hold) {
		return 0;
	}
	if (at <= hold + duration) {
		return (at - hold) / duration;
	}
	if (!loop || at <= 2 * hold + duration) {
		return 1;
	}
	return Math.max(0, 1 - (at - (2 * hold + duration)) / duration);
}

/* Eased progress of every frame in the clip, in playback order. */
export function buildTimeline(settings) {
	const frameCount = Math.max(2, Math.ceil(timelineDuration(settings) * settings.fps - 1e-9));
	const frames = new Float32Array(frameCount);

	for (let index = 0; index < frameCount; index += 1) {
		frames[index] = ease(settings.easing, morphProgress(index / settings.fps, settings));
	}

	return frames;
}

/*
 * The frame is the smallest even-sized box that holds both pictures once each is scaled to the chosen
 * long edge: a landscape and a portrait picture therefore morph inside a square.
 */
export function outputDimensions(first, second, longEdge) {
	const scaled = [first, second].map(({ width, height }) => {
		const scale = longEdge / Math.max(width, height, 1);
		return { width: width * scale, height: height * scale };
	});

	return {
		width: evenSize(Math.max(scaled[0].width, scaled[1].width)),
		height: evenSize(Math.max(scaled[0].height, scaled[1].height)),
	};
}

export function fitContain(sourceWidth, sourceHeight, targetWidth, targetHeight) {
	const scale = Math.min(targetWidth / Math.max(sourceWidth, 1), targetHeight / Math.max(sourceHeight, 1));
	const width = Math.max(1, Math.round(sourceWidth * scale));
	const height = Math.max(1, Math.round(sourceHeight * scale));

	return {
		x: Math.round((targetWidth - width) / 2),
		y: Math.round((targetHeight - height) / 2),
		width,
		height,
	};
}

/* Felzenszwalb & Huttenlocher: one-dimensional squared distance transform by lower envelope of parabolas. */
function transform1d(f, n, d, v, z) {
	let k = 0;
	v[0] = 0;
	z[0] = -INF;
	z[1] = INF;

	for (let q = 1; q < n; q += 1) {
		let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
		while (s <= z[k]) {
			k -= 1;
			s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
		}
		k += 1;
		v[k] = q;
		z[k] = s;
		z[k + 1] = INF;
	}

	k = 0;
	for (let q = 0; q < n; q += 1) {
		while (z[k + 1] < q) {
			k += 1;
		}
		d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
	}
}

/** Squared Euclidean distance from every pixel to the nearest set pixel of the mask; INF when the mask is empty. */
export function squaredDistanceTransform(mask, width, height) {
	const f = new Float64Array(width * height);
	for (let index = 0; index < f.length; index += 1) {
		f[index] = mask[index] ? 0 : INF;
	}

	const n = Math.max(width, height);
	const d = new Float64Array(n);
	const v = new Int32Array(n);
	const z = new Float64Array(n + 1);
	const line = new Float64Array(n);

	for (let x = 0; x < width; x += 1) {
		for (let y = 0; y < height; y += 1) line[y] = f[y * width + x];
		transform1d(line, height, d, v, z);
		for (let y = 0; y < height; y += 1) f[y * width + x] = d[y];
	}

	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) line[x] = f[y * width + x];
		transform1d(line, width, d, v, z);
		for (let x = 0; x < width; x += 1) f[y * width + x] = d[x];
	}

	return f;
}

/** Signed distance in pixels: negative inside the mask, positive outside, clamped to ±limit. */
export function signedDistanceField(mask, width, height, limit = Math.hypot(width, height)) {
	const inverse = new Uint8Array(mask.length);
	for (let index = 0; index < mask.length; index += 1) {
		inverse[index] = mask[index] ? 0 : 1;
	}

	const outside = squaredDistanceTransform(mask, width, height);
	const inside = squaredDistanceTransform(inverse, width, height);
	const field = new Float32Array(mask.length);

	for (let index = 0; index < mask.length; index += 1) {
		const value = Math.sqrt(outside[index]) - Math.sqrt(inside[index]);
		field[index] = value > limit ? limit : value < -limit ? -limit : value;
	}

	return field;
}

/*
 * The background is whatever colour the border of the picture mostly is. Null means the border is
 * mostly transparent, so the picture brings no background of its own.
 */
export function estimateBackground(data, width, height) {
	const ring = Math.max(1, Math.round(Math.min(width, height) * 0.02));
	const bins = new Map();
	let total = 0;
	let transparent = 0;

	for (let y = 0; y < height; y += 1) {
		const onEdgeRow = y < ring || y >= height - ring;
		for (let x = 0; x < width; x += 1) {
			if (!onEdgeRow && x >= ring && x < width - ring) {
				continue;
			}

			total += 1;
			const offset = (y * width + x) * 4;
			if (data[offset + 3] < 128) {
				transparent += 1;
				continue;
			}

			const key = ((data[offset] >> 3) << 10) | ((data[offset + 1] >> 3) << 5) | (data[offset + 2] >> 3);
			let bin = bins.get(key);
			if (!bin) {
				bin = { count: 0, red: 0, green: 0, blue: 0 };
				bins.set(key, bin);
			}
			bin.count += 1;
			bin.red += data[offset];
			bin.green += data[offset + 1];
			bin.blue += data[offset + 2];
		}
	}

	if (!total || transparent * 2 > total) {
		return null;
	}

	let best = null;
	for (const bin of bins.values()) {
		if (!best || bin.count > best.count) best = bin;
	}

	return [Math.round(best.red / best.count), Math.round(best.green / best.count), Math.round(best.blue / best.count)];
}

/*
 * Ink per pixel in 0..1: how far the colour sits from the background, weighted by alpha, and scaled so
 * the picture's own strongest ink counts as full. A mid-grey logo on white is therefore as solid as a
 * black one, and its bands are cut at the same relative depths.
 */
export function inkMap(data, width, height, background) {
	const [backgroundRed, backgroundGreen, backgroundBlue] = background;
	const size = width * height;
	const ink = new Float32Array(size);
	const histogram = new Uint32Array(256);
	let inked = 0;

	for (let index = 0; index < size; index += 1) {
		const offset = index * 4;
		const alpha = data[offset + 3] / 255;
		if (alpha <= 0) {
			continue;
		}

		const red = data[offset] - backgroundRed;
		const green = data[offset + 1] - backgroundGreen;
		const blue = data[offset + 2] - backgroundBlue;
		const value = alpha * Math.sqrt((red * red + green * green + blue * blue) / 3) / 255;
		ink[index] = value;

		if (value > 0.02) {
			histogram[Math.min(255, Math.round(value * 255))] += 1;
			inked += 1;
		}
	}

	if (!inked) {
		return ink;
	}

	/* The 98th percentile rather than the maximum, so one noisy pixel cannot wash out the rest. */
	let seen = 0;
	let percentile = 255;
	for (let bucket = 0; bucket < 256; bucket += 1) {
		seen += histogram[bucket];
		if (seen >= inked * 0.98) {
			percentile = bucket;
			break;
		}
	}

	const scale = 1 / Math.max(0.2, percentile / 255);
	for (let index = 0; index < size; index += 1) {
		const value = ink[index] * scale;
		ink[index] = value > 1 ? 1 : value;
	}

	return ink;
}

/*
 * Nested silhouettes of one picture with a signed distance field and a colour each. Layer k holds
 * every pixel at least (k + 0.5) / levels deep in ink, so later layers sit inside earlier ones and are
 * painted on top; its colour is the mean of the band it adds over the layer before it.
 */
export function buildMorphLayers(data, width, height, { levels = 3, background = [255, 255, 255] } = {}) {
	const count = Math.max(1, Math.round(levels));
	const size = width * height;
	const ink = inkMap(data, width, height, background);
	const limit = Math.max(width, height) * FAR_FIELD;
	const layers = [];

	for (let level = 0; level < count; level += 1) {
		const threshold = (level + 0.5) / count;
		const upper = (level + 1.5) / count;
		const mask = new Uint8Array(size);
		const band = { count: 0, red: 0, green: 0, blue: 0 };
		const whole = { count: 0, red: 0, green: 0, blue: 0 };

		for (let index = 0; index < size; index += 1) {
			if (ink[index] < threshold) {
				continue;
			}

			mask[index] = 1;
			const offset = index * 4;
			const target = ink[index] < upper ? band : whole;
			target.count += 1;
			target.red += data[offset];
			target.green += data[offset + 1];
			target.blue += data[offset + 2];
		}

		/* Every pixel of the layer counts toward the whole-layer mean, the band is the exclusive part. */
		whole.count += band.count;
		whole.red += band.red;
		whole.green += band.green;
		whole.blue += band.blue;

		const source = band.count ? band : whole;
		const color = source.count
			? [source.red / source.count, source.green / source.count, source.blue / source.count]
			: (layers.at(-1)?.color ?? background).slice();

		layers.push({
			threshold,
			pixels: whole.count,
			color,
			sdf: signedDistanceField(mask, width, height, limit),
		});
	}

	return { width, height, background: background.slice(), layers };
}

/*
 * One frame of the morph as opaque RGBA. Every layer's two fields are blended, re-thresholded at zero
 * with a two-pixel ramp for anti-aliasing, and painted in its blended colour over the blended
 * background. At t = 0 and t = 1 the ramp reproduces each source silhouette exactly.
 */
export function renderMorphFrame(first, second, t, out) {
	const size = first.width * first.height;
	const mix = (from, to) => from + (to - from) * t;
	const backgroundRed = mix(first.background[0], second.background[0]);
	const backgroundGreen = mix(first.background[1], second.background[1]);
	const backgroundBlue = mix(first.background[2], second.background[2]);
	const count = Math.min(first.layers.length, second.layers.length);
	const colors = [];
	const fields = [];

	for (let layer = 0; layer < count; layer += 1) {
		const from = first.layers[layer];
		const to = second.layers[layer];
		colors.push([mix(from.color[0], to.color[0]), mix(from.color[1], to.color[1]), mix(from.color[2], to.color[2])]);
		fields.push([from.sdf, to.sdf]);
	}

	for (let index = 0; index < size; index += 1) {
		let red = backgroundRed;
		let green = backgroundGreen;
		let blue = backgroundBlue;

		for (let layer = 0; layer < count; layer += 1) {
			const from = fields[layer][0][index];
			const value = from + (fields[layer][1][index] - from) * t;
			let coverage = (1 - value) * 0.5;
			if (coverage <= 0) {
				continue;
			}
			if (coverage > 1) {
				coverage = 1;
			}

			const color = colors[layer];
			red += (color[0] - red) * coverage;
			green += (color[1] - green) * coverage;
			blue += (color[2] - blue) * coverage;
		}

		const offset = index * 4;
		out[offset] = red;
		out[offset + 1] = green;
		out[offset + 2] = blue;
		out[offset + 3] = 255;
	}

	return out;
}

export function frameFileName(prefix, index) {
	return `${prefix}-${String(index).padStart(5, '0')}.png`;
}

export function framePattern(prefix) {
	return `${prefix}-%05d.png`;
}

/** FFmpeg arguments that turn the numbered PNG frames into the chosen container. */
export function buildMorphVideoArgs({ prefix, fps, format, outputName }) {
	const video = format === 'webm'
		? ['-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-lag-in-frames', '0', '-b:v', '4M', '-pix_fmt', 'yuv420p']
		: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'];

	return [
		'-framerate', String(fps),
		'-start_number', '0',
		'-i', framePattern(prefix),
		...video,
		'-y', outputName,
	];
}

export function morphFormat(format) {
	return MORPH_FORMATS.find((profile) => profile.value === format) ?? MORPH_FORMATS[0];
}

export function morphOutputName(firstName, secondName, format = 'mp4') {
	const first = baseName(firstName, '');
	const second = baseName(secondName, '');
	const stem = first && second ? `${first}-to-${second}` : first || second || 'morph';
	return `${stem}${morphFormat(format).extension}`;
}
