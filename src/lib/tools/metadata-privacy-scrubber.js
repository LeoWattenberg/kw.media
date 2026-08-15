/* Maps rather than object lookups: a file named "notes.constructor" must not read off the prototype. */
const containerMimes = new Map(Object.entries({
	aac: 'audio/aac',
	flac: 'audio/flac',
	m4a: 'audio/mp4',
	mp3: 'audio/mpeg',
	oga: 'audio/ogg',
	ogg: 'audio/ogg',
	opus: 'audio/ogg',
	wav: 'audio/wav',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	webm: 'video/webm',
	mkv: 'video/x-matroska',
}));

export function mediaContainerMime(extension) {
	return containerMimes.get(extension) || 'application/octet-stream';
}

/* The extension a scrubbed image keeps, one per format the tool writes back. */
const imageExtensions = new Map(Object.entries({
	'image/apng': 'apng',
	'image/avif': 'avif',
	'image/bmp': 'bmp',
	'image/gif': 'gif',
	'image/heic': 'heic',
	'image/heif': 'heif',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/svg+xml': 'svg',
	'image/tiff': 'tiff',
	'image/vnd.adobe.photoshop': 'psd',
	'image/vnd.microsoft.icon': 'ico',
	'image/webp': 'webp',
	'image/x-icon': 'ico',
}));

export function imageExtension(type) {
	return imageExtensions.get(String(type || '').toLowerCase()) || '';
}

/*
 * ImageMagick's own name for each format, which is both the coder the source is read with and the
 * coder it is written back with. Anything not listed falls back to the uppercased file extension,
 * which is how ImageMagick spells the rest of its coders (PSD, TGA, DDS, PPM …).
 */
const magickImageFormats = new Map(Object.entries({
	'image/apng': 'APNG',
	'image/avif': 'AVIF',
	'image/bmp': 'BMP',
	'image/gif': 'GIF',
	'image/heic': 'HEIC',
	'image/heif': 'HEIF',
	'image/jpeg': 'JPEG',
	'image/png': 'PNG',
	'image/tiff': 'TIFF',
	'image/vnd.adobe.photoshop': 'PSD',
	'image/vnd.microsoft.icon': 'ICO',
	'image/webp': 'WEBP',
	'image/x-icon': 'ICO',
}));

export function magickImageFormat(type, extension = '') {
	return magickImageFormats.get(String(type || '').toLowerCase()) || String(extension || '').toUpperCase();
}

/**
 * Which engine rewrites an image in its own format: `svg` for markup, which is stripped as
 * text, and `magick` for every raster, which ImageMagick WASM reads and writes back as itself
 * with every profile removed.
 */
export function imageScrubEngine(type) {
	const imageType = String(type || '').toLowerCase();
	if (imageType === 'image/svg+xml') return 'svg';
	/*
	 * A canvas re-draw drops EXIF, but it cannot be told to drop anything else and
	 * Chromium stamps its own sRGB profile onto the WebP it writes — a scrub that
	 * leaves an ICCP chunk behind is not the scrub this tool promises. ImageMagick's
	 * strip() removes every profile, and it writes each format back as itself.
	 */
	return 'magick';
}

/* Files from a download or an unknown source arrive with an empty type, so the name has to decide. */
const imageMimeByExtension = new Map(Object.entries({
	apng: 'image/apng', avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
	ico: 'image/x-icon', jfif: 'image/jpeg', jpe: 'image/jpeg', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png',
	psd: 'image/vnd.adobe.photoshop', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp',
}));

export function metadataOutputProfile(file) {
	const type = String(file?.type || '').toLowerCase();
	const name = String(file?.name || '');
	const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
	const extension = match?.[1] || extensionForMime(type);
	const imageType = type || imageMimeByExtension.get(extension) || '';
	const isImage = imageType.startsWith('image/');
	if (isImage) {
		/* The source format is what comes back out: GIF stays GIF, TIFF stays TIFF, SVG stays SVG. */
		return { isImage: true, extension: imageExtension(imageType) || extension || 'png', mimeType: imageType };
	}
	return {
		isImage,
		extension: extension || 'bin',
		mimeType: type || mediaContainerMime(extension),
	};
}

const mimeExtensions = new Map(Object.entries({
	'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav',
	'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
}));

function extensionForMime(type) {
	return mimeExtensions.get(type) || imageExtension(type);
}

export function buildScrubMediaArgs(input, output, container) {
	const args = ['-i', input, '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy'];
	if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart');
	args.push('-y', output);
	return args;
}

function asBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return null;
}

function readAscii(bytes, at, length) {
	let text = '';
	for (let index = 0; index < length; index += 1) text += String.fromCharCode(bytes[at + index] || 0);
	return text;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/* An APNG is a PNG whose animation control chunk sits ahead of the first frame of image data. */
function hasPngAnimationControl(bytes) {
	if (bytes.length < 8) return false;
	for (let index = 0; index < 8; index += 1) {
		if (bytes[index] !== pngSignature[index]) return false;
	}

	let at = 8;
	while (at + 8 <= bytes.length) {
		const name = readAscii(bytes, at + 4, 4);
		if (name === 'acTL') return true;
		if (name === 'IDAT' || name === 'IEND') return false;
		const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
		at += 12 + length;
	}

	return false;
}

/* An animated WebP is a RIFF file carrying ANIM/ANMF chunks next to the still image data. */
function hasWebpAnimationChunk(bytes) {
	if (bytes.length < 16 || readAscii(bytes, 0, 4) !== 'RIFF' || readAscii(bytes, 8, 4) !== 'WEBP') return false;

	let at = 12;
	while (at + 8 <= bytes.length) {
		const name = readAscii(bytes, at, 4);
		if (name === 'ANIM' || name === 'ANMF') return true;
		const size = bytes[at + 4] | (bytes[at + 5] << 8) | (bytes[at + 6] << 16) | (bytes[at + 7] * 0x1000000);
		at += 8 + size + (size % 2);
	}

	return false;
}

/**
 * Whether a PNG or WebP carries more than the one frame a canvas would keep. Those two formats are
 * otherwise handled by canvas.toBlob, which flattens an animation into its first frame; when the
 * source moves, ImageMagick has to write it instead.
 */
export function isAnimatedRaster(bytes, mimeType) {
	const view = asBytes(bytes);
	if (!view) return false;
	const type = String(mimeType || '').toLowerCase();
	if (type === 'image/png' || type === 'image/apng') return hasPngAnimationControl(view);
	if (type === 'image/webp') return hasWebpAnimationChunk(view);
	return false;
}

/*
 * SVG is XML, so its metadata is elements and attributes rather than a binary profile: Inkscape and
 * Illustrator leave RDF descriptions, XMP packets, editor namespaces and a document name behind.
 * <title> and <desc> stay: they are what a screen reader announces, not provenance.
 */
const svgMetadataElements = ['metadata', 'xmpmeta', 'RDF', 'namedview'];
const svgMetadataPrefixes = 'inkscape|sodipodi|dc|cc|rdf|xmp|xmpMM|xmpRights|photoshop|exif|tiff|illustrator|xapGImg';

export function stripSvgMetadata(markup) {
	let svg = String(markup ?? '');

	/* Processing instructions other than the XML declaration are XMP packets and editor hints. */
	svg = svg.replace(/<\?(?!xml[\s?])[\s\S]*?\?>/g, '');
	svg = svg.replace(/<!--[\s\S]*?-->/g, '');

	for (const element of svgMetadataElements) {
		svg = svg
			.replace(new RegExp(`<(?:[\\w.-]+:)?${element}\\b[^>]*/>`, 'gi'), '')
			.replace(new RegExp(`<(?:[\\w.-]+:)?${element}\\b[^>]*>[\\s\\S]*?</(?:[\\w.-]+:)?${element}\\s*>`, 'gi'), '');
	}

	svg = svg.replace(new RegExp(`\\s(?:${svgMetadataPrefixes}):[\\w.:-]+\\s*=\\s*("[^"]*"|'[^']*')`, 'g'), '');
	svg = svg.replace(new RegExp(`\\sxmlns:(?:${svgMetadataPrefixes})\\s*=\\s*("[^"]*"|'[^']*')`, 'g'), '');

	return svg.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
}
