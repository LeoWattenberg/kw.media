export function fileExtension(name, fallback = '.bin') {
	const match = String(name || '').match(/\.[^.]+$/);
	return match ? match[0] : fallback;
}

export function lowerFileExtension(name, fallback = '.bin') {
	const match = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
	return match ? match[0] : fallback;
}

export function baseName(name, fallback = 'file') {
	return String(name || '').replace(/\.[^.]+$/, '') || fallback;
}
