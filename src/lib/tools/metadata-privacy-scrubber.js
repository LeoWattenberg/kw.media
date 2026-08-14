export function imageExtension(type) {
	return type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
}

export function mediaContainerMime(extension) {
	return ({
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
	})[extension] || 'application/octet-stream';
}

/* The scrub re-renders images through a canvas, and canvas.toBlob only encodes these. */
const canvasImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function metadataOutputProfile(file) {
	const type = String(file?.type || '').toLowerCase();
	const name = String(file?.name || '');
	const match = name.toLowerCase().match(/\.([a-z0-9]+)$/);
	let extension = match?.[1] || extensionForMime(type);
	const isImage = type.startsWith('image/');
	/* Everything else (GIF, AVIF, BMP, TIFF, SVG) comes back out of the canvas as PNG. */
	if (isImage && !canvasImageTypes.has(type)) {
		return { isImage: true, extension: 'png', mimeType: 'image/png' };
	}
	if (isImage && extension === 'jpeg') extension = 'jpg';
	return {
		isImage,
		extension: extension || 'bin',
		mimeType: type || mediaContainerMime(extension),
	};
}

function extensionForMime(type) {
	return ({
		'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/opus': 'opus', 'audio/wav': 'wav',
		'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
		'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/x-matroska': 'mkv',
	})[type] || '';
}

export function buildScrubMediaArgs(input, output, container) {
	const args = ['-i', input, '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy'];
	if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart');
	args.push('-y', output);
	return args;
}
