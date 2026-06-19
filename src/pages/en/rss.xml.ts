import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { getRssItems } from '../../lib/rss';

export function GET(context: APIContext) {
	return rss({
		title: 'Koytek Wattenberg Media - YouTube Tips',
		description: 'English YouTube tips and creator news from Koytek Wattenberg Media.',
		site: context.site,
		items: getRssItems('en', context.site),
		customData: '<language>en-US</language>',
	});
}
