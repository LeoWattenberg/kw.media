import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getRssItems } from '../../lib/rss';

export function GET(context: APIContext) {
	return rss({
		title: 'Koytek Wattenberg Media - YouTube Tipps',
		description: 'Deutschsprachige YouTube Tipps und Creator News von Koytek Wattenberg Media.',
		site: context.site,
		items: getRssItems('de', context.site),
		customData: '<language>de-DE</language>',
	});
}
