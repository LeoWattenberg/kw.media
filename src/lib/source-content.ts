import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeHtml, prepareContentHtml, stripHtml } from './html';
import { localizeMediaHtml, localizeMediaUrl } from './media';
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
	categories: number[];
	yoast_head_json?: {
		description?: string;
		og_locale?: string;
		og_image?: Array<{ url: string }>;
		schema?: {
			'@graph'?: Array<{ inLanguage?: string }>;
		};
	};
}

interface WpPage {
	id: number;
	slug: string;
	link: string;
	title: WpRendered;
	content: WpRendered;
	excerpt: WpRendered;
	date: string;
	modified: string;
	yoast_head_json?: {
		description?: string;
	};
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
	sourceUrl: string;
}

export interface SourcePage {
	id: number;
	path: string;
	title: string;
	contentHtml: string;
	description?: string;
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

function localeFromPost(post: WpPost): Locale {
	if (post.categories.includes(youtubeTipsCategoryByLocale.de)) {
		return 'de';
	}

	if (post.categories.includes(youtubeTipsCategoryByLocale.en)) {
		return 'en';
	}

	const schemaLanguage = post.yoast_head_json?.schema?.['@graph']?.find((item) => item.inLanguage)?.inLanguage;
	const languageHints = [post.yoast_head_json?.og_locale, schemaLanguage, pathFromUrl(post.link)];

	return languageHints.some((value) => value?.toLowerCase().startsWith('de')) ? 'de' : 'en';
}

function categoryIdsForPost(post: WpPost, locale: Locale): number[] {
	const categoryIds = new Set(post.categories);
	const hasTipsCategory = categoryIds.has(youtubeTipsCategoryByLocale.de) || categoryIds.has(youtubeTipsCategoryByLocale.en);

	if (!hasTipsCategory) {
		categoryIds.add(youtubeTipsCategoryByLocale[locale]);
	}

	return [...categoryIds];
}

export function getAllPosts(): SourcePost[] {
	const posts = readJson<WpPost[]>('posts.json');

	return posts.map((post) => {
		const locale = localeFromPost(post);

		return {
			id: post.id,
			slug: post.slug,
			path: pathFromUrl(post.link),
			title: decodeHtml(post.title.rendered),
			excerpt: stripHtml(post.excerpt.rendered || post.content.rendered).replace(/\s*Read More.*$/i, ''),
			contentHtml: prepareContentHtml(localizeMediaHtml(post.content.rendered)),
			date: post.date,
			modified: post.modified,
			locale,
			categoryIds: categoryIdsForPost(post, locale),
			image: localizeMediaUrl(post.yoast_head_json?.og_image?.[0]?.url),
			sourceUrl: post.link,
		};
	});
}

export function getPostsByCategory(categoryId: number): SourcePost[] {
	return getAllPosts().filter((post) => post.categoryIds.includes(categoryId));
}

export function getPostByPath(path: string): SourcePost | undefined {
	const normalizedPath = path.endsWith('/') ? path : `${path}/`;
	return getAllPosts().find((post) => post.path === normalizedPath);
}

export function getSourcePage(id: number): SourcePage | undefined {
	const page = readJson<WpPage[]>('pages.json').find((item) => item.id === id);

	if (!page) {
		return undefined;
	}

	return {
		id: page.id,
		path: pathFromUrl(page.link),
		title: decodeHtml(page.title.rendered),
		contentHtml: prepareContentHtml(page.content.rendered),
		description: page.yoast_head_json?.description,
		sourceUrl: page.link,
	};
}
