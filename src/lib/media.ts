import { wpMedia } from '../data/wp-media';

const mediaEntries = Object.entries(wpMedia);

export function localizeMediaUrl(url: string | undefined): string | undefined {
	if (!url) {
		return url;
	}

	return wpMedia[url as keyof typeof wpMedia] ?? url;
}

export function localizeMediaHtml(html: string): string {
	return mediaEntries.reduce((content, [remoteUrl, localPath]) => {
		return content.replaceAll(remoteUrl, localPath);
	}, html);
}
