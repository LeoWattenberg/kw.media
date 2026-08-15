import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getRssItems } from '../../lib/rss';

export function GET(context: APIContext) {
	const items = getRssItems('en', context.site);
	// The channel link must point at the English section, not the site root, which serves
	// the German homepage. Item links are root-relative and so resolve against the origin
	// either way.
	const channel = context.site ? new URL('/en/', context.site) : undefined;
	const feedUrl = context.site ? new URL('/en/rss.xml', context.site).toString() : undefined;

	return rss({
		title: 'Koytek Wattenberg Media - YouTube Tips',
		description: 'English YouTube tips and creator news from Koytek Wattenberg Media.',
		site: channel ?? context.site,
		items,
		xmlns: { atom: 'http://www.w3.org/2005/Atom' },
		customData: [
			'<language>en-US</language>',
			items[0] ? `<lastBuildDate>${items[0].pubDate.toUTCString()}</lastBuildDate>` : '',
			feedUrl ? `<atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>` : '',
		].filter(Boolean).join(''),
	});
}
