export function imageExtension(type) {
	return type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
}

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

/* The scrub re-renders images through a canvas, and canvas.toBlob only encodes these. */
const canvasImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

/* Files from a download or an unknown source arrive with an empty type, so the name has to decide. */
const imageMimeByExtension = new Map(Object.entries({
	apng: 'image/png', avif: 'image/avif', bmp: 'image/bmp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif',
	ico: 'image/x-icon', jfif: 'image/jpeg', jpe: 'image/jpeg', jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png',
	svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff', webp: 'image/webp',
}));

export function metadataOutputProfile(file) {
	const type = String(file?.type || '').toLowerCase();
	const name = String(file?.name || '');
	const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
	const extension = match?.[1] || extensionForMime(type);
	const imageType = type || imageMimeByExtension.get(extension) || '';
	const isImage = imageType.startsWith('image/');
	if (isImage) {
		/* Everything the canvas cannot write (GIF, AVIF, BMP, TIFF, SVG) comes back out of it as PNG. */
		if (!canvasImageTypes.has(imageType)) {
			return { isImage: true, extension: 'png', mimeType: 'image/png' };
		}
		return { isImage: true, extension: imageExtension(imageType), mimeType: imageType };
	}
	return {
		isImage,
		extension: extension || 'bin',
		mimeType: type || mediaContainerMime(extension),
	};
}

const mimeExtensions = new Map(Object.entries({
	'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav',
	'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
	'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
}));

function extensionForMime(type) {
	return mimeExtensions.get(type) || '';
}

export function buildScrubMediaArgs(input, output, container) {
	const args = ['-i', input, '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy'];
	if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart');
	args.push('-y', output);
	return args;
}
