// These additional locales belong only to the download page, not the rest of kw.media.
export const DOWNLOAD_LANGUAGES = ['de', 'en', 'ar', 'cs', 'el', 'es', 'fa', 'fi', 'fr', 'he', 'hi', 'hy', 'id', 'it', 'ja', 'ko', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'tr', 'uk', 'vi', 'zh-CN', 'zh-TW'];

export function downloadPagePath(language) {
	return `/audacity/download/${language.toLowerCase()}/`;
}

export function downloadComparisonUrl(language) {
	const supported = DOWNLOAD_LANGUAGES.find(candidate => candidate.toLowerCase() === language.toLowerCase());
	return `https://soundscaper.org/docs/${supported && supported !== 'en' ? `${supported.toLowerCase()}/` : ''}start/how-soundscaper-compares/`;
}

/** Translate text nodes after formatting so status colors, icons and links stay independent of wording. */
export function localizeDownloadComparison(html, translations) {
	return html.split(/(<[^>]+>)/g).map(part => {
		if (part.startsWith('<') || !Object.hasOwn(translations, part.trim())) return part;
		const text = translations[part.trim()].replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
		return part.replace(part.trim(), () => text);
	}).join('');
}
