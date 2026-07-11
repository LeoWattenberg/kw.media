export function createOutputName(name, extension) {
	const baseName = String(name || '').replace(/\.[^.]+$/, '') || 'converted-image';
	return `${baseName}.${extension}`;
}

export function fileExtension(name) {
	const match = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
	return match ? match[0] : '.image';
}

export function formatFrames(frames, copy) {
	if (!Number.isFinite(frames) || frames <= 1) {
		return copy.singleFrame;
	}

	return String(copy.multipleFrames).replace(/\{(\w+)\}/g, (_match, key) => {
		return key === 'count' ? String(frames) : '';
	});
}
