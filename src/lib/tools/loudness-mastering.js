export function inputExtension() {
	return '.bin';
}

export function getBaseName(name) {
	return String(name || '').replace(/\.[^.]+$/, '');
}

export function detectMediaKind(file) {
	const type = String(file && file.type ? file.type : '').toLowerCase();
	return type.startsWith('video/') ? 'video' : 'audio';
}

export function selectOutputProfile(file, kind = detectMediaKind(file)) {
	const type = String(file && file.type ? file.type : '').toLowerCase();
	const profiles = {
		'audio/wav': { extension: '.wav', displayName: 'WAV', mimeType: 'audio/wav' },
		'audio/x-wav': { extension: '.wav', displayName: 'WAV', mimeType: 'audio/wav' },
		'audio/mpeg': { extension: '.mp3', displayName: 'MP3', mimeType: 'audio/mpeg' },
		'audio/mp3': { extension: '.mp3', displayName: 'MP3', mimeType: 'audio/mpeg' },
		'audio/flac': { extension: '.flac', displayName: 'FLAC', mimeType: 'audio/flac' },
		'audio/ogg': { extension: '.ogg', displayName: 'OGG', mimeType: 'audio/ogg' },
		'audio/opus': { extension: '.opus', displayName: 'OPUS', mimeType: 'audio/opus' },
		'audio/mp4': { extension: '.m4a', displayName: 'M4A', mimeType: 'audio/mp4' },
		'video/mp4': { extension: '.mp4', displayName: 'MP4', mimeType: 'video/mp4' },
		'video/quicktime': { extension: '.mov', displayName: 'MOV', mimeType: 'video/quicktime' },
		'video/x-msvideo': { extension: '.avi', displayName: 'AVI', mimeType: 'video/x-msvideo' },
		'video/x-matroska': { extension: '.mkv', displayName: 'MKV', mimeType: 'video/x-matroska' },
		'video/webm': { extension: '.webm', displayName: 'WEBM', mimeType: 'video/webm' },
	};

	return profiles[type] || (kind === 'video'
		? { extension: '.mp4', displayName: 'MP4', mimeType: 'video/mp4' }
		: { extension: '.m4a', displayName: 'M4A', mimeType: 'audio/mp4' });
}

export function buildOutputInfo(file) {
	const kind = detectMediaKind(file);
	const output = selectOutputProfile(file, kind);
	const base = getBaseName(file.name);
	return {
		fileName: `${base}-mastered${output.extension}`,
		extension: output.extension,
		displayName: output.displayName,
		mimeType: output.mimeType,
	};
}

export function selectAudioCodec(file, isVideo = detectMediaKind(file) === 'video') {
	const type = String(file && file.type ? file.type : '').toLowerCase();
	if (type === 'audio/wav' || type === 'audio/x-wav') return 'pcm_s16le';
	if (type === 'audio/flac') return 'flac';
	if (type === 'audio/ogg' || type === 'audio/opus' || type === 'video/webm') return 'libopus';
	if (type === 'audio/mpeg' || type === 'audio/mp3') return 'libmp3lame';
	return isVideo ? 'aac' : 'aac';
}

export function selectAudioArgs(codec) {
	if (codec === 'pcm_s16le') return ['-ar', '48000'];
	if (codec === 'flac') return ['-ar', '48000'];
	if (codec === 'libopus') return ['-b:a', '192k', '-ar', '48000'];
	if (codec === 'libmp3lame') return ['-b:a', '192k'];
	if (codec === 'aac') return ['-b:a', '192k'];
	return [];
}

export function buildMasteringArgs(inputName, outputName, file) {
	const isVideo = detectMediaKind(file) === 'video';
	const audioCodec = selectAudioCodec(file, isVideo);
	const audioArgs = selectAudioArgs(audioCodec);

	if (isVideo) {
		return [
			'-i', inputName,
			'-af', 'loudnorm=I=-14:TP=-1:LRA=11',
			'-map', '0:v:0',
			'-map', '0:a:0?',
			'-c:v', 'copy',
			'-c:a', audioCodec,
			...audioArgs,
			'-y', outputName,
		];
	}

	return [
		'-i', inputName,
		'-vn',
		'-af', 'loudnorm=I=-14:TP=-1:LRA=11',
		'-c:a', audioCodec,
		...audioArgs,
		'-y', outputName,
	];
}
