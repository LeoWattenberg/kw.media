export function buildLosslessArgs(inputName, audioName, outputName, options = {}) {
	const operation = options.operation || 'remux';
	const container = options.container || 'mkv';
	const args = [];

	if (operation === 'trim' && options.start) args.push('-ss', String(options.start));
	args.push('-i', inputName);
	if (operation === 'replace' && audioName) args.push('-i', audioName);

	if (operation === 'trim' && options.end) {
		const start = Number(options.start || 0);
		const duration = Number(options.end) - start;
		if (duration <= 0) throw new Error('End time must be after start time');
		args.push('-t', String(duration));
	}

	if (operation === 'extract') args.push('-map', '0:a:0', '-vn', '-c:a', 'copy');
	else if (operation === 'mute') args.push('-map', '0:v?', '-map', '0:s?', '-c', 'copy');
	else if (operation === 'replace') args.push('-map', '0:v?', '-map', '1:a:0', '-map', '0:s?', '-c', 'copy', '-shortest');
	else args.push('-map', '0', '-c', 'copy');

	if (container === 'mp4' || container === 'mov') args.push('-movflags', '+faststart');
	args.push('-y', outputName);
	return args;
}

export function containerMime(extension) {
	return ({
		mp4: 'video/mp4',
		mov: 'video/quicktime',
		webm: 'video/webm',
		mka: 'audio/x-matroska',
		mkv: 'video/x-matroska',
	})[extension] || 'application/octet-stream';
}
