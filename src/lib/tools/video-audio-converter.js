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

	return [
		'-i', inputName,
		'-map', '0:v:0?',
		'-map', '0:a:0?',
		'-c:v', profile.codec,
		'-c:a', profile.audioCodec || 'aac',
		...(profile.audioArgs || []),
		'-y', outputName,
	];
}

export function buildOutputName(name, extension) {
	const baseName = String(name || '').replace(/\.[^.]+$/, '') || 'converted-media';
	return `${baseName}${extension}`;
}

export function inputExtension() {
	return '.bin';
}
