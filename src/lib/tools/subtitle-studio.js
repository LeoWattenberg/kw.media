export function softSubtitleArgs(input, subtitles, output, container = 'mkv') {
	const args = ['-i', input, '-i', subtitles, '-map', '0', '-map', '1:0', '-c', 'copy'];

	if (container === 'mp4') {
		args.push('-c:s', 'mov_text', '-movflags', '+faststart');
	} else {
		args.push('-c:s', 'srt');
	}

	args.push('-metadata:s:s:0', 'language=und', '-y', output);
	return args;
}

export function subtitleStudioOutputName(name, mode, container = 'mkv') {
	const base = String(name || '').replace(/\.[^.]+$/, '') || 'media';
	return mode === 'hard' ? `${base}-hard-subtitles.mp4` : `${base}-soft-subtitles.${container}`;
}

export function subtitleStudioMime(mode, container = 'mkv') {
	if (mode === 'hard' || container === 'mp4') return 'video/mp4';
	return 'video/x-matroska';
}
