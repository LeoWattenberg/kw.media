import {
	buildMorphVideoArgs,
	buildShapeUnits,
	composeMatrices,
	fitViewBoxMatrix,
	flattenPathData,
	matrixScale,
	morphTimeline,
	outputFormat,
	parseColor,
	shapeToPathData,
	withAlpha,
} from './svg-morph.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const GEOMETRY_TAGS = ['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'];
const IGNORED_TAGS = ['text', 'use', 'image', 'foreignObject'];
const NON_RENDERED = 'defs, clipPath, mask, marker, pattern, symbol, linearGradient, radialGradient, filter';
const HOST_SIZE = 512;

/*
 * Parses SVG markup and mounts it in a shadow root so the browser resolves its CSS, gradients,
 * transforms, and nested viewports for us without the document's styles leaking either way.
 * Scripts are dropped before the markup is mounted.
 */
export function mountSvgDocument(markup, ownerDocument = document) {
	const parsed = new DOMParser().parseFromString(String(markup), 'image/svg+xml');
	const error = parsed.querySelector('parsererror');
	if (error) {
		throw new Error(`SVG could not be parsed: ${error.textContent.trim().split('\n')[0]}`);
	}
	const root = parsed.documentElement;
	if (!root || root.namespaceURI !== SVG_NS || root.localName !== 'svg') {
		throw new Error('The file is not an SVG document.');
	}
	for (const script of parsed.querySelectorAll('script')) {
		script.remove();
	}
	for (const element of parsed.querySelectorAll('*')) {
		for (const attribute of [...element.attributes]) {
			if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
		}
	}

	const svg = ownerDocument.importNode(root, true);
	const viewBox = readViewBox(svg);
	const host = ownerDocument.createElement('div');
	host.setAttribute('aria-hidden', 'true');
	host.style.cssText = `position:fixed;left:-${HOST_SIZE * 4}px;top:0;width:${HOST_SIZE}px;height:${HOST_SIZE}px;overflow:hidden;opacity:0;pointer-events:none;`;
	const shadow = host.attachShadow({ mode: 'open' });
	svg.setAttribute('width', String(HOST_SIZE));
	svg.setAttribute('height', String(HOST_SIZE));
	svg.style.width = `${HOST_SIZE}px`;
	svg.style.height = `${HOST_SIZE}px`;
	svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
	shadow.appendChild(svg);
	ownerDocument.body.appendChild(host);

	return {
		svg,
		viewBox,
		dispose() {
			host.remove();
		},
	};
}

function readViewBox(svg) {
	const box = svg.viewBox?.baseVal;
	if (box && box.width > 0 && box.height > 0) {
		return { x: box.x, y: box.y, width: box.width, height: box.height };
	}
	const width = lengthValue(svg.getAttribute('width'));
	const height = lengthValue(svg.getAttribute('height'));
	if (width > 0 && height > 0) {
		return { x: 0, y: 0, width, height };
	}
	return null;
}

function lengthValue(value) {
	const parsed = Number.parseFloat(String(value ?? ''));
	return Number.isFinite(parsed) && !String(value).trim().endsWith('%') ? parsed : 0;
}

/*
 * Walks the mounted SVG and turns every rendered geometry element into morph units placed in
 * output pixel space. Text, `<use>`, and images cannot be morphed and are counted so the tool
 * can say what it left out.
 */
export function extractSvgShapes(mounted, { width, height, margin = 10, step = 2 } = {}) {
	const { svg } = mounted;
	let viewBox = mounted.viewBox;
	if (!viewBox) {
		const box = svg.getBBox();
		viewBox = { x: box.x, y: box.y, width: box.width || 1, height: box.height || 1 };
		svg.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
	}

	const screen = svg.getScreenCTM();
	if (!screen) {
		throw new Error('The SVG could not be measured.');
	}
	const toUserSpace = screen.inverse();
	const fit = fitViewBoxMatrix(viewBox, width, height, margin);
	const view = svg.ownerDocument.defaultView;
	const units = [];
	const skipped = { text: 0, use: 0, image: 0 };
	let order = 0;

	for (const element of svg.querySelectorAll([...GEOMETRY_TAGS, ...IGNORED_TAGS].join(','))) {
		if (element.closest(NON_RENDERED)) continue;
		const tag = element.localName;
		if (IGNORED_TAGS.includes(tag)) {
			skipped[tag === 'foreignObject' ? 'image' : tag] += 1;
			continue;
		}

		const style = view.getComputedStyle(element);
		if (style.display === 'none' || style.visibility === 'hidden' || isHiddenByAncestor(element, svg, view)) continue;

		const pathData = shapeToPathData(tag, readShapeAttributes(element, tag));
		if (!pathData) continue;

		const ctm = element.getScreenCTM();
		if (!ctm) continue;
		const local = toUserSpace.multiply(ctm);
		const matrix = composeMatrices(fit, { a: local.a, b: local.b, c: local.c, d: local.d, e: local.e, f: local.f });
		const opacity = inheritedOpacity(element, svg, view);
		const fill = withAlpha(resolvePaint(style.fill, svg, view), Number.parseFloat(style.fillOpacity) * opacity);
		const strokeColor = withAlpha(resolvePaint(style.stroke, svg, view), Number.parseFloat(style.strokeOpacity) * opacity);
		const strokeWidth = Number.parseFloat(style.strokeWidth) * matrixScale(matrix);

		let subpaths;
		try {
			subpaths = flattenPathData(pathData, { matrix, step });
		} catch {
			continue;
		}

		units.push(...buildShapeUnits({
			subpaths,
			fill,
			fillRule: style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
			stroke: strokeColor && strokeWidth > 0
				? { color: strokeColor, width: strokeWidth, join: style.strokeLinejoin || 'miter', cap: style.strokeLinecap || 'butt' }
				: null,
		}, order));
		order += 1;
	}

	return { units, skipped, viewBox };
}

function readShapeAttributes(element, tag) {
	const length = (name) => {
		const animated = element[name];
		if (animated && animated.baseVal && Number.isFinite(animated.baseVal.value)) {
			return animated.baseVal.value;
		}
		const parsed = Number.parseFloat(element.getAttribute(name) ?? '');
		return Number.isFinite(parsed) ? parsed : undefined;
	};

	switch (tag) {
		case 'path':
			return { d: element.getAttribute('d') ?? '' };
		case 'rect':
			return { x: length('x'), y: length('y'), width: length('width'), height: length('height'), rx: rectRadius(element, 'rx'), ry: rectRadius(element, 'ry') };
		case 'circle':
			return { cx: length('cx'), cy: length('cy'), r: length('r') };
		case 'ellipse':
			return { cx: length('cx'), cy: length('cy'), rx: length('rx'), ry: length('ry') };
		case 'line':
			return { x1: length('x1'), y1: length('y1'), x2: length('x2'), y2: length('y2') };
		case 'polyline':
		case 'polygon': {
			const points = [];
			const list = element.points;
			for (let index = 0; index < list.numberOfItems; index += 1) {
				const point = list.getItem(index);
				points.push([point.x, point.y]);
			}
			return { points };
		}
		default:
			return {};
	}
}

/* `rx.baseVal.value` reports the browser's auto value, so only explicit attributes count as rounded corners. */
function rectRadius(element, name) {
	if (!element.hasAttribute(name) && !element.hasAttribute(name === 'rx' ? 'ry' : 'rx')) return undefined;
	const animated = element[name];
	return animated && animated.baseVal ? animated.baseVal.value : undefined;
}

function isHiddenByAncestor(element, svg, view) {
	let node = element.parentElement;
	while (node && node !== svg) {
		const style = view.getComputedStyle(node);
		if (style.display === 'none' || style.visibility === 'hidden') return true;
		node = node.parentElement;
	}
	return false;
}

function inheritedOpacity(element, svg, view) {
	let opacity = 1;
	let node = element;
	while (node && node !== svg.parentNode) {
		const value = Number.parseFloat(view.getComputedStyle(node).opacity);
		if (Number.isFinite(value)) opacity *= value;
		node = node.parentElement;
	}
	return opacity;
}

/* Gradients collapse to their first stop and patterns to grey: a morphing outline has no
   stable geometry to map a fill image onto. */
function resolvePaint(value, svg, view) {
	const text = String(value ?? '').trim();
	const reference = text.match(/^url\(["']?#([^"')]+)["']?\)/);
	if (!reference) {
		return parseColor(text);
	}
	const target = svg.querySelector(`[id="${CSS.escape(reference[1])}"]`);
	if (!target) {
		return parseColor(text.replace(/^url\([^)]*\)\s*/, '')) ?? parseColor('#808080');
	}
	if (target.localName === 'linearGradient' || target.localName === 'radialGradient') {
		const stop = firstGradientStop(target, svg);
		if (stop) {
			const style = view.getComputedStyle(stop);
			return withAlpha(parseColor(style.stopColor), Number.parseFloat(style.stopOpacity) || 1);
		}
	}
	return parseColor('#808080');
}

function firstGradientStop(gradient, svg, depth = 0) {
	const stop = gradient.querySelector('stop');
	if (stop || depth > 8) return stop;
	const href = gradient.getAttribute('href') ?? gradient.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
	if (!href || !href.startsWith('#')) return null;
	const parent = svg.querySelector(`[id="${CSS.escape(href.slice(1))}"]`);
	return parent ? firstGradientStop(parent, svg, depth + 1) : null;
}

/* --- rendering -------------------------------------------------------------- */

function cssColor(color) {
	return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${color.a})`;
}

/* Draws one frame of shapes; `scale` maps output pixels onto the canvas for previews. */
export function drawMorphFrame(context, shapes, { scale = 1 } = {}) {
	context.save();
	context.scale(scale, scale);
	for (const shape of shapes) {
		const path = new Path2D(shape.path);
		for (const hole of shape.holes) {
			path.addPath(new Path2D(hole));
		}
		if (shape.fill) {
			context.fillStyle = cssColor(shape.fill);
			context.fill(path, 'evenodd');
		}
		if (shape.stroke) {
			context.strokeStyle = cssColor(shape.stroke.color);
			context.lineWidth = shape.stroke.width;
			context.lineJoin = shape.stroke.join;
			context.lineCap = shape.stroke.cap;
			context.stroke(path);
		}
	}
	context.restore();
}

function canvasToBlob(canvas, type) {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Frame could not be encoded.'))), type);
	});
}

/*
 * Renders every frame to PNG, hands the sequence to FFmpeg, and returns the encoded bytes.
 * PNG keeps straight alpha, which is what the ProRes, Animation, PNG, and VP9 encoders read.
 */
export async function renderMorphVideo({ morph, settings, ffmpegRuntime, onProgress, canvas = document.createElement('canvas') }) {
	const timeline = morphTimeline(settings);
	const format = outputFormat(settings.format);
	canvas.width = settings.width;
	canvas.height = settings.height;
	const context = canvas.getContext('2d');

	return ffmpegRuntime.run(async (ffmpeg) => {
		const prefix = `morph-${Date.now()}-`;
		const written = [];
		try {
			for (let frame = 0; frame < timeline.frameCount; frame += 1) {
				context.clearRect(0, 0, canvas.width, canvas.height);
				drawMorphFrame(context, morph.frame(timeline.progressAt(frame)));
				const blob = await canvasToBlob(canvas, 'image/png');
				const name = `${prefix}${String(frame).padStart(5, '0')}.png`;
				await ffmpeg.writeFile(name, new Uint8Array(await blob.arrayBuffer()));
				written.push(name);
				onProgress?.({ phase: 'frames', done: frame + 1, total: timeline.frameCount });
			}

			const outputName = `${prefix}output.${format.extension}`;
			written.push(outputName);
			onProgress?.({ phase: 'encode', done: 0, total: 1 });
			const code = await ffmpeg.exec(buildMorphVideoArgs(settings.format, {
				fps: settings.fps,
				framePattern: `${prefix}%05d.png`,
				outputName,
			}));
			if (code !== 0) {
				throw new Error(`FFmpeg exited with code ${code}`);
			}
			const output = await ffmpeg.readFile(outputName);
			const bytes = output instanceof Uint8Array ? output : new TextEncoder().encode(String(output));
			return { bytes, format, frameCount: timeline.frameCount, duration: timeline.totalDuration };
		} finally {
			for (const name of written) {
				await ffmpeg.deleteFile(name).catch(() => {});
			}
		}
	});
}
