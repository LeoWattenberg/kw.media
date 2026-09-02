/*
 * Distance-field morph between two still images.
 *
 * A cross-dissolve doubles every outline and averages colours toward mud, and an optical-flow warp
 * needs matching texture that flat artwork never has. This morph reads every pixel as "ink" (how far
 * its colour sits from the picture's background), cuts the ink at a few thresholds into nested
 * silhouettes, turns each silhouette into a signed distance field, blends the fields of both images
 * and re-thresholds the blend. Outlines stay crisp all the way through; parts that have no partner in
 * the other picture shrink away and regrow instead of ghosting.
 *
 * Interpolation styles, frame rates, the hold/morph/hold timeline, the output formats and their
 * encoder arguments are the same as in the SVG Morph tool (svg-morph.js), so the two tools behave
 * alike for the same settings; tests/image-morph.test.js checks that they stay in step.
 */

export const MORPH_FRAME_RATES = [24, 25, 30, 50, 60];

export const MORPH_LIMITS = {
	hold: { min: 0, max: 10 },
	duration: { min: 0.1, max: 10 },
	levels: { min: 1, max: 8 },
	size: { min: 64, max: 1920 },
};

export const MORPH_SIZES = [360, 480, 720, 1080];

export const MORPH_BACKGROUNDS = ['transparent', 'source', 'color'];

const backConstant = 1.70158;

/* Every curve maps [0, 1] onto [0, 1] with fixed end points so the hold frames on either
   side of the morph always show the untouched source and target pictures. */
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

/*
 * The first four are SVG Morph's formats, all carrying an alpha channel. MP4 is the one addition:
 * H.264 has no alpha, so its frames are flattened onto the morph's background colour.
 */
export const MORPH_OUTPUT_FORMATS = [
	{ id: 'prores-4444', extension: 'mov', mime: 'video/quicktime', codec: 'prores_ks', playable: false, alpha: true },
	{ id: 'qt-animation', extension: 'mov', mime: 'video/quicktime', codec: 'qtrle', playable: false, alpha: true },
	{ id: 'png-mov', extension: 'mov', mime: 'video/quicktime', codec: 'png', playable: false, alpha: true },
	/* VP8 rather than VP9: encoding a VP9 alpha plane aborts the ffmpeg.wasm 0.12 core and takes the page with it. */
	{ id: 'webm-vp8', extension: 'webm', mime: 'video/webm', codec: 'libvpx', playable: true, alpha: true },
	{ id: 'mp4-h264', extension: 'mp4', mime: 'video/mp4', codec: 'libx264', playable: true, alpha: false },
];

export const DEFAULT_MORPH_SETTINGS = {
	holdStart: 1,
	holdEnd: 1,
	duration: 1.5,
	fps: 30,
	easing: 'ease-in-out',
	format: 'prores-4444',
	levels: 3,
	size: 720,
	background: 'transparent',
	color: '#ffffff',
	loop: false,
};

/*
 * Distances are capped at this share of the longer edge. An empty silhouette would otherwise be
 * infinitely far away, and a part of the second picture with no partner in the first would pop in
 * on the final frame instead of growing from its core.
 */
const FAR_FIELD = 0.25;
const INF = 1e20;

/*
 * A picture that brings its own transparency has its silhouette in its alpha channel, not in its
 * colours: every opaque pixel counts at least this much as ink, so a white logo on nothing is as
 * solid as a black one while darker parts still sit in deeper tone levels.
 */
export const TRANSPARENT_INK_FLOOR = 0.35;

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

/* Every encoder here accepts odd sizes except VP8's 4:2:0 planes, so even sizes keep the formats interchangeable. */
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
	const defaults = DEFAULT_MORPH_SETTINGS;
	const number = (value, fallback) => {
		const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
		return Number.isFinite(parsed) ? parsed : fallback;
	};
	const fps = number(raw.fps, defaults.fps);

	return {
		holdStart: roundTo(clamp(number(raw.holdStart, defaults.holdStart), MORPH_LIMITS.hold.min, MORPH_LIMITS.hold.max), 2),
		holdEnd: roundTo(clamp(number(raw.holdEnd, defaults.holdEnd), MORPH_LIMITS.hold.min, MORPH_LIMITS.hold.max), 2),
		duration: roundTo(clamp(number(raw.duration, defaults.duration), MORPH_LIMITS.duration.min, MORPH_LIMITS.duration.max), 2),
		fps: MORPH_FRAME_RATES.reduce((best, candidate) => (Math.abs(candidate - fps) < Math.abs(best - fps) ? candidate : best), MORPH_FRAME_RATES[0]),
		easing: MORPH_EASINGS.some((easing) => easing.id === raw.easing) ? raw.easing : defaults.easing,
		format: MORPH_OUTPUT_FORMATS.some((format) => format.id === raw.format) ? raw.format : defaults.format,
		levels: Math.round(clamp(number(raw.levels, defaults.levels), MORPH_LIMITS.levels.min, MORPH_LIMITS.levels.max)),
		size: evenSize(clamp(number(raw.size, defaults.size), MORPH_LIMITS.size.min, MORPH_LIMITS.size.max)),
		background: MORPH_BACKGROUNDS.includes(raw.background) ? raw.background : defaults.background,
		color: normalizeHexColor(raw.color, defaults.color),
		loop: Boolean(raw.loop),
	};
}

/*
 * Hold, morph, hold, counted in whole frames the way SVG Morph counts them. With `loop` the morph
 * runs back again after the end hold, mirrored in time, so a player that repeats the file never cuts.
 */
export function morphTimeline(settings) {
	const ease = easingFunction(settings.easing);
	const startFrames = Math.round(settings.holdStart * settings.fps);
	const morphFrames = Math.max(2, Math.round(settings.duration * settings.fps));
	const endFrames = Math.round(settings.holdEnd * settings.fps);
	const backFrames = settings.loop ? morphFrames : 0;
	const frameCount = startFrames + morphFrames + endFrames + backFrames;
	const forwardDuration = settings.holdStart + settings.duration + settings.holdEnd;
	const loopDuration = settings.loop ? forwardDuration + settings.duration : forwardDuration;

	return {
		frameCount,
		startFrames,
		morphFrames,
		endFrames,
		backFrames,
		totalDuration: frameCount / settings.fps,
		loopDuration,
		progressAt(frame) {
			if (frame < startFrames) return 0;
			if (frame < startFrames + morphFrames) return ease((frame - startFrames) / (morphFrames - 1));
			if (!backFrames || frame < startFrames + morphFrames + endFrames) return 1;
			const back = Math.min(frame - (startFrames + morphFrames + endFrames), backFrames - 1);
			return ease(1 - back / (backFrames - 1));
		},
		progressAtTime(seconds) {
			const at = settings.loop ? ((seconds % loopDuration) + loopDuration) % loopDuration : seconds;
			if (!settings.loop || at <= forwardDuration) {
				return ease(clamp((at - settings.holdStart) / settings.duration, 0, 1));
			}
			return ease(clamp(1 - (at - forwardDuration) / settings.duration, 0, 1));
		},
	};
}

/** Progress of every frame in the clip, in playback order. */
export function buildTimeline(settings) {
	const timeline = morphTimeline(settings);
	const frames = new Float32Array(timeline.frameCount);
	for (let index = 0; index < timeline.frameCount; index += 1) {
		frames[index] = timeline.progressAt(index);
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
 * Ink per pixel in 0..1: how far the colour sits from the reference colour, weighted by alpha, and
 * scaled so the picture's own strongest ink counts as full. A mid-grey logo on white is therefore as
 * solid as a black one, and its bands are cut at the same relative depths. `alphaFloor` is the least
 * an opaque pixel counts, for pictures whose silhouette lives in their alpha channel.
 */
export function inkMap(data, width, height, reference, { alphaFloor = 0 } = {}) {
	const [referenceRed, referenceGreen, referenceBlue] = reference;
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

		const red = data[offset] - referenceRed;
		const green = data[offset + 1] - referenceGreen;
		const blue = data[offset + 2] - referenceBlue;
		const distance = Math.sqrt((red * red + green * green + blue * blue) / 3) / 255;
		const value = alpha * Math.max(alphaFloor, distance);
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
 *
 * `background` is the colour painted behind the layers and `backgroundAlpha` how opaque that paint
 * is; `reference` is the colour ink is measured against when it differs from the paint.
 */
export function buildMorphLayers(data, width, height, {
	levels = 3,
	background = [255, 255, 255],
	backgroundAlpha = 1,
	reference = background,
	alphaFloor = 0,
} = {}) {
	const count = Math.max(1, Math.round(levels));
	const size = width * height;
	const ink = inkMap(data, width, height, reference, { alphaFloor });
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

	return { width, height, background: background.slice(), backgroundAlpha: clamp(backgroundAlpha, 0, 1), layers };
}

/*
 * One frame of the morph as straight RGBA. Every layer's two fields are blended, re-thresholded at
 * zero with a two-pixel ramp for anti-aliasing, and painted in its blended colour over the blended
 * background; the background's own opacity blends too, so a picture on nothing morphs onto nothing.
 * At t = 0 and t = 1 the ramp reproduces each source silhouette exactly. `flatten` composites the
 * frame onto the background colour for containers without an alpha channel.
 */
export function renderMorphFrame(first, second, t, out, { flatten = false } = {}) {
	const size = first.width * first.height;
	const mix = (from, to) => from + (to - from) * t;
	const channel = (value) => (value < 0 ? 0 : value > 255 ? 255 : value);
	const firstAlpha = first.backgroundAlpha ?? 1;
	const secondAlpha = second.backgroundAlpha ?? 1;
	const backgroundRed = channel(mix(first.background[0], second.background[0]));
	const backgroundGreen = channel(mix(first.background[1], second.background[1]));
	const backgroundBlue = channel(mix(first.background[2], second.background[2]));
	const backgroundAlpha = flatten ? 1 : clamp(mix(firstAlpha, secondAlpha), 0, 1);
	/* Premultiplied, so a transparent background contributes no colour of its own. */
	const baseRed = channel(mix(first.background[0] * firstAlpha, second.background[0] * secondAlpha));
	const baseGreen = channel(mix(first.background[1] * firstAlpha, second.background[1] * secondAlpha));
	const baseBlue = channel(mix(first.background[2] * firstAlpha, second.background[2] * secondAlpha));
	const count = Math.min(first.layers.length, second.layers.length);
	const colors = [];
	const fields = [];

	for (let layer = 0; layer < count; layer += 1) {
		const from = first.layers[layer];
		const to = second.layers[layer];
		colors.push([
			channel(mix(from.color[0], to.color[0])),
			channel(mix(from.color[1], to.color[1])),
			channel(mix(from.color[2], to.color[2])),
		]);
		fields.push([from.sdf, to.sdf]);
	}

	for (let index = 0; index < size; index += 1) {
		let red = flatten ? backgroundRed : baseRed;
		let green = flatten ? backgroundGreen : baseGreen;
		let blue = flatten ? backgroundBlue : baseBlue;
		let alpha = backgroundAlpha;

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
			alpha += (1 - alpha) * coverage;
		}

		const offset = index * 4;
		if (alpha >= 1) {
			out[offset] = red;
			out[offset + 1] = green;
			out[offset + 2] = blue;
			out[offset + 3] = 255;
		} else if (alpha > 0) {
			out[offset] = red / alpha;
			out[offset + 1] = green / alpha;
			out[offset + 2] = blue / alpha;
			out[offset + 3] = alpha * 255;
		} else {
			/* Nothing here: keep the background colour under the zero alpha so opaque readers see paper, not black. */
			out[offset] = backgroundRed;
			out[offset + 1] = backgroundGreen;
			out[offset + 2] = backgroundBlue;
			out[offset + 3] = 0;
		}
	}

	return out;
}

export function frameFileName(prefix, index) {
	return `${prefix}${String(index).padStart(5, '0')}.png`;
}

export function framePattern(prefix) {
	return `${prefix}%05d.png`;
}

/** FFmpeg arguments that turn the numbered PNG frames into the chosen container, SVG Morph's arguments for its formats. */
export function buildMorphVideoArgs(formatId, { fps, framePattern: pattern, outputName }) {
	const format = outputFormat(formatId);
	const input = ['-framerate', String(fps), '-i', pattern];
	const codecArgs = {
		'prores-4444': ['-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', '-vendor', 'apl0'],
		'qt-animation': ['-c:v', 'qtrle', '-pix_fmt', 'argb'],
		'png-mov': ['-c:v', 'png', '-pix_fmt', 'rgba'],
		'webm-vp8': ['-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-b:v', '6M', '-crf', '10', '-deadline', 'good', '-cpu-used', '2', '-auto-alt-ref', '0'],
		'mp4-h264': ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'],
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
	return `${stem(fromName, 'image-a')}-to-${stem(toName, 'image-b')}.${format.extension}`;
}
