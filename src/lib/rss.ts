import type { Locale } from '../i18n';
import { getAllPosts } from './source-content';

function absolutizeRootRelativeUrls(html: string, site?: URL) {
	if (!site) {
		return html;
	}

	return html.replace(/\b(href|src)="(\/[^"]*)"/g, (_, attribute: string, path: string) => {
		return `${attribute}="${new URL(path, site).toString()}"`;
	});
}

export function getRssItems(locale: Locale, site?: URL) {
	return getAllPosts()
		.filter((post) => post.locale === locale)
		.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
		.map((post) => ({
			title: post.title,
			description: post.excerpt,
			pubDate: new Date(post.date),
			link: post.path,
			content: absolutizeRootRelativeUrls(post.contentHtml, site),
		}));
}
