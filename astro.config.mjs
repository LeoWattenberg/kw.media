// @ts-check
import { defineConfig } from 'astro/config';

const site = process.env.ASTRO_SITE ?? 'https://kw.media';
const base = process.env.ASTRO_BASE ?? '/';

// https://astro.build/config
export default defineConfig({
	site,
	base,
	redirects: {
		'/de/': '/',

		'/ads/': '/en/ads/',
		'/b2b/': '/de/b2b/',
		'/creator/': '/de/creator/',
		'/imprint-service/': '/en/imprint-service/',
		'/live/': '/de/live/',
		'/vtuber/': '/en/vtuber/',
		'/werbung/': '/de/werbung/',

		'/new/ads/': '/en/ads/',
		'/new/creator/': '/en/creator/',
		'/new/': '/en/',

		'/blog/': '/en/youtube-tips/',
		'/category/': '/en/youtube-tips/',
		'/category/blog/': '/en/youtube-tips/',
		'/category/uncategorized/': '/en/youtube-tips/',
		'/category/uncategorized-de/': '/de/youtube-tipps/',
		'/category/youtube-tips-de/': '/de/youtube-tipps/',
		'/category/youtube-tips-en/': '/en/youtube-tips/',
		'/category/youtube-tipps-de/': '/de/youtube-tipps/',
		'/youtube-tips-en/': '/en/youtube-tips/',
		'/youtube-tipps-de/': '/de/youtube-tipps/',

		'/author/koytekconsulting/': '/en/creator/',
		'/author/leo/': '/en/vtuber/',
		'/author/': '/en/creator/',
		'/creatorguides/': '/en/youtube-tips/',
		'/youtube/': 'https://www.youtube.com/channel/UCGu6U-UNczXKxShRiJj6kXQ',
	},
});
