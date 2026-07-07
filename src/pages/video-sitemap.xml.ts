import type { APIContext } from 'astro';
import { getAllPosts } from '../lib/source-content';

function escapeXml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function absoluteUrl(site: URL, path: string): string {
	return new URL(path, site).toString();
}

function stableVideoThumbnailUrl(thumbnailUrl: string, youtubeId: string): string {
	if (/^https:\/\/i\.ytimg\.com\/vi\//.test(thumbnailUrl)) {
		return `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;
	}

	return thumbnailUrl;
}

function sitemapDate(value: string): string {
	return value.slice(0, 10);
}

export function GET(context: APIContext) {
	const site = context.site ?? new URL('https://kw.media');
	const videoPosts = getAllPosts().filter((post) => post.video);
	const urls = videoPosts.map((post) => {
		const video = post.video!;
		const description = post.excerpt.slice(0, 2048);

		return [
			'  <url>',
			`    <loc>${escapeXml(absoluteUrl(site, post.path))}</loc>`,
			`    <lastmod>${escapeXml(sitemapDate(post.modified ?? post.date))}</lastmod>`,
			'    <video:video>',
			`      <video:thumbnail_loc>${escapeXml(stableVideoThumbnailUrl(video.thumbnailUrl, video.youtubeId))}</video:thumbnail_loc>`,
			`      <video:title>${escapeXml(post.title)}</video:title>`,
			`      <video:description>${escapeXml(description)}</video:description>`,
			`      <video:player_loc>${escapeXml(video.embedUrl)}</video:player_loc>`,
			`      <video:publication_date>${escapeXml(sitemapDate(post.date))}</video:publication_date>`,
			`      <video:uploader>${escapeXml(post.authorName)}</video:uploader>`,
			'      <video:family_friendly>yes</video:family_friendly>',
			'    </video:video>',
			'  </url>',
		].join('\n');
	});

	const body = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">',
		...urls,
		'</urlset>',
	].join('\n');

	return new Response(body, {
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
		},
	});
}
