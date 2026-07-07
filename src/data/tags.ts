import { locales, type Locale } from '../i18n';
import { getAllPosts, type SourcePost } from '../lib/source-content';

export interface TagPageData {
	slug: string;
	name: string;
	locale: Locale;
	path: string;
	count: number;
	posts: SourcePost[];
}

const tagPrefix: Record<Locale, string> = {
	de: '/de/tag/',
	en: '/en/tag/',
};

export function tagSlug(tag: string): string {
	return String(tag ?? '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ß/g, 'ss')
		.toLowerCase()
		.replace(/&/g, ' and ')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
}

export function getTagPath(locale: Locale, slug: string): string {
	return `${tagPrefix[locale]}${slug}/`;
}

interface TagBucket {
	nameCounts: Map<string, number>;
	posts: SourcePost[];
}

function buildTagIndex(): Map<Locale, Map<string, TagBucket>> {
	const index = new Map<Locale, Map<string, TagBucket>>();

	for (const post of getAllPosts()) {
		const tags = post.tags;
		if (!Array.isArray(tags)) {
			continue;
		}

		const localeMap = index.get(post.locale) ?? new Map<string, TagBucket>();
		if (!index.has(post.locale)) {
			index.set(post.locale, localeMap);
		}

		for (const rawTag of tags) {
			const slug = tagSlug(rawTag);
			if (!slug) {
				continue;
			}

			const bucket = localeMap.get(slug) ?? { nameCounts: new Map<string, number>(), posts: [] };
			if (!localeMap.has(slug)) {
				localeMap.set(slug, bucket);
			}

			bucket.posts.push(post);
			const name = String(rawTag).trim();
			if (name) {
				bucket.nameCounts.set(name, (bucket.nameCounts.get(name) ?? 0) + 1);
			}
		}
	}

	return index;
}

const tagIndex = buildTagIndex();

function pickDisplayName(slug: string, bucket: TagBucket): string {
	let best = '';
	let bestCount = 0;

	for (const [name, count] of bucket.nameCounts) {
		if (count > bestCount || (count === bestCount && name.length > best.length)) {
			best = name;
			bestCount = count;
		}
	}

	return best || slug;
}

function toTagPage(locale: Locale, slug: string, bucket: TagBucket): TagPageData {
	const posts = [...bucket.posts].sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

	return {
		slug,
		name: pickDisplayName(slug, bucket),
		locale,
		path: getTagPath(locale, slug),
		count: posts.length,
		posts,
	};
}

export function getAllTags(locale?: Locale): TagPageData[] {
	const scopedLocales = locale ? [locale] : [...locales];
	const tags = scopedLocales.flatMap((currentLocale) => {
		const localeMap = tagIndex.get(currentLocale);
		if (!localeMap) {
			return [];
		}

		return [...localeMap.entries()].map(([slug, bucket]) => toTagPage(currentLocale, slug, bucket));
	});

	return tags.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function getTag(locale: Locale, slug: string): TagPageData | undefined {
	const bucket = tagIndex.get(locale)?.get(slug);
	return bucket ? toTagPage(locale, slug, bucket) : undefined;
}

export function getTagAlternatePaths(locale: Locale, slug: string): Partial<Record<Locale, string>> {
	const paths: Partial<Record<Locale, string>> = { [locale]: getTagPath(locale, slug) };
	const otherLocale: Locale = locale === 'de' ? 'en' : 'de';

	if (tagIndex.get(otherLocale)?.has(slug)) {
		paths[otherLocale] = getTagPath(otherLocale, slug);
	}

	return paths;
}
