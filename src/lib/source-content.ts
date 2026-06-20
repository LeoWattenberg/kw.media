import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeHtml, prepareContentHtml, stripHtml } from './html';
import { localizeMediaHtml, localizeMediaUrl } from './media';
import { blogExcerpts } from '../data/blog-excerpts';
import type { Locale } from '../i18n';

interface WpRendered {
	rendered: string;
}

interface WpPost {
	id: number;
	slug: string;
	link: string;
	title: WpRendered;
	content: WpRendered;
	excerpt: WpRendered;
	date: string;
	modified: string;
	author?: number;
	categories: number[];
}

interface WpMedia {
	link: string;
	source_url: string;
}

export interface SourcePost {
	id: number;
	slug: string;
	path: string;
	title: string;
	excerpt: string;
	contentHtml: string;
	date: string;
	modified: string;
	locale: Locale;
	categoryIds: number[];
	image?: string;
	authorName: string;
	sourceUrl: string;
}

function readJson<T>(fileName: string): T {
	return JSON.parse(readFileSync(join(process.cwd(), 'reference/source-site', fileName), 'utf8')) as T;
}

function pathFromUrl(url: string): string {
	return new URL(url).pathname;
}

const youtubeTipsCategoryByLocale = {
	de: 17,
	en: 18,
} satisfies Record<Locale, number>;

const defaultPostImage = '/assets/wp-content/uploads/2021/04/yt-banner.png';

const postAuthors: Record<number, string> = {
	2: 'Martin Koytek',
	3: 'Leo Wattenberg',
};

const translatedPostPaths: Array<Partial<Record<Locale, string>>> = [
	{
		de: '/youtube-tipps-de/youtube-strike-was-nun/',
		en: '/youtube-tips-en/i-got-a-strike-what-now/',
	},
	{
		de: '/youtube-tipps-de/lass-uns-uber-geld-und-sponsorships-reden/',
		en: '/youtube-tips-en/lets-talk-about-youtube-money-and-sponsorships-for-youtube-channels/',
	},
	{
		de: '/youtube-tipps-de/wie-du-social-media-nutzen-kannst-um-deinen-youtube-kanal-zu-vergrosern/',
		en: '/youtube-tips-en/how-to-use-social-media-to-grow-your-youtube-channel/',
	},
	{
		de: '/youtube-tipps-de/sei-ein-youtuber-kein-newtuber-mach-guten-content/',
		en: '/youtube-tips-en/be-a-youtuber-not-a-newtuber-make-great-content/',
	},
	{
		de: '/youtube-tipps-de/wie-du-musik-und-videos-legal-verwendest/',
		en: '/youtube-tips-en/the-fuck-copyright-guide-how-to-legally-use-things-in-your-videos-that-other-people-made/',
	},
];

const translatedPostPathsByPath = new Map(
	translatedPostPaths.flatMap((paths) => Object.values(paths).map((path) => [path, paths] as const)),
);

function localeFromPost(post: WpPost): Locale {
	if (post.categories.includes(youtubeTipsCategoryByLocale.de)) {
		return 'de';
	}

	if (post.categories.includes(youtubeTipsCategoryByLocale.en)) {
		return 'en';
	}

	return pathFromUrl(post.link).includes('/de/') || pathFromUrl(post.link).includes('/youtube-tipps-de/') ? 'de' : 'en';
}

function categoryIdsForPost(post: WpPost, locale: Locale): number[] {
	const categoryIds = new Set(post.categories);
	const hasTipsCategory = categoryIds.has(youtubeTipsCategoryByLocale.de) || categoryIds.has(youtubeTipsCategoryByLocale.en);

	if (!hasTipsCategory) {
		categoryIds.add(youtubeTipsCategoryByLocale[locale]);
	}

	return [...categoryIds];
}

function fallbackExcerptForPost(post: WpPost): string {
	const excerpt = stripHtml(post.excerpt.rendered || post.content.rendered).replace(/\s*Read More.*$/i, '');

	if (excerpt.length <= 155) {
		return excerpt;
	}

	const trimmed = excerpt.slice(0, 152);
	const lastSpace = trimmed.lastIndexOf(' ');
	return `${trimmed.slice(0, lastSpace > 80 ? lastSpace : trimmed.length)}...`;
}

function firstImageFromHtml(html: string): string | undefined {
	const match = html.match(/<img[^>]+src=(['"])(.*?)\1/i);
	return match ? decodeHtml(match[2]) : undefined;
}

function imageForPost(post: WpPost, mediaItems: WpMedia[]): string | undefined {
	const attachmentImage = mediaItems.find((item) => item.link.startsWith(`${post.link}attachment/`))?.source_url;
	const candidates = [attachmentImage, firstImageFromHtml(post.content.rendered), defaultPostImage];

	for (const candidate of candidates) {
		const image = localizeMediaUrl(candidate);

		if (image) {
			return image;
		}
	}

	return undefined;
}

export function getAllPosts(): SourcePost[] {
	const posts = readJson<WpPost[]>('posts.json');
	const mediaItems = readJson<WpMedia[]>('media.json');

	return posts.map((post) => {
		const locale = localeFromPost(post);

		return {
			id: post.id,
			slug: post.slug,
			path: pathFromUrl(post.link),
			title: decodeHtml(post.title.rendered),
			excerpt: blogExcerpts[post.slug] ?? fallbackExcerptForPost(post),
			contentHtml: prepareContentHtml(localizeMediaHtml(post.content.rendered)),
			date: post.date,
			modified: post.modified,
			locale,
			categoryIds: categoryIdsForPost(post, locale),
			image: imageForPost(post, mediaItems),
			authorName: postAuthors[post.author ?? 0] ?? 'Koytek Wattenberg Media',
			sourceUrl: post.link,
		};
	});
}

export function getPostAlternatePaths(post: SourcePost): Partial<Record<Locale, string>> {
	return translatedPostPathsByPath.get(post.path) ?? { [post.locale]: post.path };
}

export function getPostsByCategory(categoryId: number): SourcePost[] {
	return getAllPosts().filter((post) => post.categoryIds.includes(categoryId));
}

export function getPostByPath(path: string): SourcePost | undefined {
	const normalizedPath = path.endsWith('/') ? path : `${path}/`;
	return getAllPosts().find((post) => post.path === normalizedPath);
}
