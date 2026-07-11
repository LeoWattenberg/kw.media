export function resolveAssetUrl(url, basePath = '/') {
	if (!url || /^(https?:|data:|blob:)/.test(url)) {
		return url;
	}

	if (!url.startsWith('/')) {
		return url;
	}

	const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
	return `${normalizedBase}${url}`;
}

export function normalizeManifest(manifest, basePath = '/') {
	return {
		...manifest,
		levels: (manifest.levels || []).map((level) => ({
			...level,
			options: (level.options || []).map((option) => ({
				...option,
				url: resolveAssetUrl(option.url, basePath),
			})),
		})),
	};
}

export function calculatePerfectOdds(levels = []) {
	return levels.reduce((odds, level) => odds * Math.max(1, level.options?.length || 0), 1);
}

export function storageKey(date) {
	return `kwm-mp3-guesser:${date || 'unknown'}`;
}

export function formatDuration(value) {
	const seconds = Math.max(0, Math.round(Number(value) || 0));
	const minutes = Math.floor(seconds / 60);
	const remainder = seconds % 60;

	if (!minutes) {
		return `${remainder}s`;
	}

	return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function escapeHtml(value) {
	return String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#039;');
}

export function formatTemplate(template, values) {
	return Object.entries(values).reduce(
		(result, [key, value]) => result.replaceAll(`{${key}}`, value),
		template,
	);
}
