/*
 * The shipped target formats. They live next to the argument builders rather than
 * in the component frontmatter so the table the page serialises into data-profiles
 * is the same one the tests assert against.
 */
export const CONVERSION_PROFILES = [
	{ value: 'wav', label: 'WAV', extension: '.wav', mimeType: 'audio/wav', kind: 'audio', codec: 'pcm_s16le', args: ['-ar', '48000'] },
	{ value: 'mp3', label: 'MP3', extension: '.mp3', mimeType: 'audio/mpeg', kind: 'audio', codec: 'libmp3lame', args: ['-b:a', '192k'] },
	{ value: 'ogg', label: 'OGG', extension: '.ogg', mimeType: 'audio/ogg', kind: 'audio', codec: 'libopus', args: ['-b:a', '192k', '-ar', '48000'] },
	{ value: 'm4a', label: 'M4A', extension: '.m4a', mimeType: 'audio/mp4', kind: 'audio', codec: 'aac', args: ['-b:a', '192k'] },
	{ value: 'flac', label: 'FLAC', extension: '.flac', mimeType: 'audio/flac', kind: 'audio', codec: 'flac', args: ['-ar', '48000'] },
	{ value: 'mp4', label: 'MP4', extension: '.mp4', mimeType: 'video/mp4', kind: 'video', codec: 'libx264', videoArgs: ['-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], audioCodec: 'aac', audioArgs: ['-b:a', '192k'] },
	{ value: 'webm', label: 'WebM', extension: '.webm', mimeType: 'video/webm', kind: 'video', codec: 'libvpx', videoArgs: ['-deadline', 'realtime', '-cpu-used', '8', '-threads', '2', '-lag-in-frames', '0', '-b:v', '2M'], audioCodec: 'libopus', audioArgs: ['-b:a', '160k', '-ar', '48000'] },
	{ value: 'mov', label: 'MOV', extension: '.mov', mimeType: 'video/quicktime', kind: 'video', codec: 'libx264', videoArgs: ['-crf', '20', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], audioCodec: 'aac', audioArgs: ['-b:a', '192k'] },
];

const videoExtensions = new Set(['3g2', '3gp', 'avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'ts', 'webm', 'wmv']);
const audioExtensions = new Set(['aac', 'aiff', 'aif', 'flac', 'm4a', 'mp3', 'ogg', 'oga', 'opus', 'wav', 'wma']);

export function detectMediaKind(file) {
	if (!file) {
		return 'unknown';
	}

	const type = String(file.type || '').toLowerCase();
	if (type.startsWith('video/')) {
		return 'video';
	}
	if (type.startsWith('audio/')) {
		return 'audio';
	}

	const extension = getFileExtension(file.name || '');
	if (videoExtensions.has(extension)) {
		return 'video';
	}
	if (audioExtensions.has(extension)) {
		return 'audio';
	}

	return 'unknown';
}

export function getFileExtension(name) {
	const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
	return match ? match[1] : '';
}

export function filterProfilesForMediaKind(profileDefinitions, fileOrKind) {
	const kind = typeof fileOrKind === 'string' ? fileOrKind : detectMediaKind(fileOrKind);

	return profileDefinitions.filter((profile) => {
		if (kind === 'audio') {
			return profile.kind === 'audio';
		}
		if (kind === 'video') {
			return profile.kind === 'video' || profile.kind === 'audio';
		}
		return profile.kind === 'video' || profile.kind === 'audio';
	});
}

export function buildConversionArgs(inputName, outputName, file, profile) {
	const kind = detectMediaKind(file);
	if (kind === 'audio') {
		return ['-i', inputName, '-vn', '-c:a', profile.codec, ...profile.args, '-y', outputName];
	}

	if (profile.kind === 'audio') {
		return ['-i', inputName, '-vn', '-map', '0:a:0?', '-c:a', profile.codec, ...profile.args, '-y', outputName];
	}

	const args = [
		'-i', inputName,
		'-map', '0:v:0?',
		'-map', '0:a:0?',
		'-c:v', profile.codec,
		...(profile.videoArgs || []),
		'-c:a', profile.audioCodec || 'aac',
		...(profile.audioArgs || []),
	];
	if (profile.extension === '.mp4' || profile.extension === '.mov') args.push('-movflags', '+faststart');
	args.push('-y', outputName);
	return args;
}

export function buildConversionAttempts(inputName, outputName, file, profile) {
	const transcode = buildConversionArgs(inputName, outputName, file, profile);
	if (detectMediaKind(file) !== 'video' || profile.kind !== 'video' || profile.codec === 'copy') return [transcode];
	const streamCopy = buildConversionArgs(inputName, outputName, file, { ...profile, codec: 'copy', videoArgs: [] });
	return [streamCopy, transcode];
}

export function buildOutputName(name, extension) {
	const baseName = String(name || '').replace(/\.[^.]+$/, '') || 'converted-media';
	return `${baseName}${extension}`;
}

export function inputExtension(file) {
	const extension = getFileExtension(file?.name || '');
	return extension ? `.${extension}` : '.bin';
}
