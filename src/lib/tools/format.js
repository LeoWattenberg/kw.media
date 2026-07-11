export function formatTemplate(template, values = {}) {
	return String(template).replace(/\{(\w+)\}/g, (_match, key) => {
		return key in values ? String(values[key]) : '';
	});
}

export function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}

	const units = ['B', 'KB', 'MB', 'GB'];
	const power = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
	const value = bytes / (1024 ** power);
	return `${value.toFixed(value >= 10 || power === 0 ? 0 : 1)} ${units[power]}`;
}
