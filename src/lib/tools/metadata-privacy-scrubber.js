export function imageExtension(type) {
	return type === 'image/jpeg' ? 'jpg' : type === 'image/webp' ? 'webp' : 'png';
}

export function mediaContainerMime(extension) {
	return ({
		mp4: 'video/mp4',
		mov: 'video/quicktime',
		webm: 'video/webm',
		mkv: 'video/x-matroska',
	})[extension] || 'application/octet-stream';
}

export function buildScrubMediaArgs(input, output, container) {
	const args = ['-i', input, '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy'];
	if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart');
	args.push('-y', output);
	return args;
}
