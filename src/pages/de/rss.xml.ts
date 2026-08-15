import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getRssItems } from '../../lib/rss';

export function GET(context: APIContext) {
	const items = getRssItems('de', context.site);
	const feedUrl = context.site ? new URL('/de/rss.xml', context.site).toString() : undefined;

	return rss({
		title: 'Koytek Wattenberg Media - YouTube Tipps',
		description: 'Deutschsprachige YouTube Tipps und Creator News von Koytek Wattenberg Media.',
		site: context.site,
		items,
		xmlns: { atom: 'http://www.w3.org/2005/Atom' },
		customData: [
			'<language>de-DE</language>',
			items[0] ? `<lastBuildDate>${items[0].pubDate.toUTCString()}</lastBuildDate>` : '',
			feedUrl ? `<atom:link href="${feedUrl}" rel="self" type="application/rss+xml"/>` : '',
		].filter(Boolean).join(''),
	});
}
