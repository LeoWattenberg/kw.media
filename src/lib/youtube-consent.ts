import type { Locale } from '../i18n';

export const youtubeConsentCopy = {
	de: {
		text: 'Zum Anzeigen dieses YouTube-Inhalts müssen YouTube-Einbettungen zugelassen werden. Dabei können Daten an YouTube/Google übertragen werden.',
		button: 'YouTube laden',
	},
	en: {
		text: 'To show this YouTube content, allow YouTube embeds. This can transfer data to YouTube/Google.',
		button: 'Load YouTube',
	},
} satisfies Record<Locale, { text: string; button: string }>;

function escapeAttribute(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');
}

function getAttribute(attributes: string, name: string): string | undefined {
	const match = attributes.match(new RegExp(`\\b${name}=("|')([^"']*)\\1`, 'i'));
	return match?.[2];
}

export function youtubeConsentPlaceholder(locale: Locale, src: string, title = 'YouTube video', attributes = ''): string {
	const copy = youtubeConsentCopy[locale];
	const allow = getAttribute(attributes, 'allow');
	const referrerPolicy = getAttribute(attributes, 'referrerpolicy');
	const loading = getAttribute(attributes, 'loading') ?? 'lazy';
	const allowFullscreen = /\ballowfullscreen\b/i.test(attributes);
	const dataAttributes = [
		`data-youtube-src="${escapeAttribute(src)}"`,
		`data-youtube-title="${escapeAttribute(title)}"`,
		`data-youtube-loading="${escapeAttribute(loading)}"`,
		allow ? `data-youtube-allow="${escapeAttribute(allow)}"` : '',
		referrerPolicy ? `data-youtube-referrerpolicy="${escapeAttribute(referrerPolicy)}"` : '',
		allowFullscreen ? 'data-youtube-allowfullscreen' : '',
	]
		.filter(Boolean)
		.join(' ');

	return `<div class="youtube-consent-frame" data-youtube-embed ${dataAttributes}><div class="youtube-consent-placeholder"><p>${copy.text}</p><button type="button" data-youtube-accept>${copy.button}</button></div></div>`;
}

export function gateYouTubeEmbedsInHtml(value: string, locale: Locale): string {
	return value.replace(
		/<iframe\b([^>]*?)\bsrc=(["'])(https?:\/\/(?:www\.)?youtube(?:-nocookie)?\.com\/embed\/[^"']*)\2([^>]*)>\s*(?:<\/iframe>)?/gi,
		(_, before: string, _quote: string, src: string, after: string) => {
			const attributes = `${before} ${after}`;
			const title = getAttribute(attributes, 'title') ?? 'YouTube video';
			return youtubeConsentPlaceholder(locale, src, title, attributes);
		},
	);
}
