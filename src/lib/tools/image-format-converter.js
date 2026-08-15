import { formatTemplate } from './format.js';

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

/**
 * Describe the file that was written. `metadata` comes from re-reading the
 * produced bytes; when they could not be read back the panel falls back to the
 * one thing it measured itself, the size of the output blob.
 */
export function formatOutputMeta(metadata, size, copy) {
	if (!metadata || !Number.isFinite(metadata.frames) || metadata.frames < 1) {
		return size;
	}

	return formatTemplate(copy.imageMeta, {
		width: metadata.width || '?',
		height: metadata.height || '?',
		frames: formatFrames(metadata.frames, copy),
		size,
	});
}
