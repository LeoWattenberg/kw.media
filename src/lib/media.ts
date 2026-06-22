const legacyMediaHost = 'https://kw.media/wp-content/uploads/';

export function localizeMediaUrl(url: string | undefined): string | undefined {
	if (!url) {
		return url;
	}

	if (url.startsWith(legacyMediaHost)) {
		return undefined;
	}

	return url;
}
