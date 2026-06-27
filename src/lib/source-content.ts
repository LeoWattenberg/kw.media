import type { Locale } from '../i18n';

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
	video?: {
		youtubeId: string;
		embedUrl: string;
		watchUrl: string;
		thumbnailUrl: string;
	};
}

interface MarkdownPostModule {
	frontmatter: Omit<SourcePost, 'contentHtml'>;
	compiledContent: () => Promise<string>;
}

const postModules = import.meta.glob<MarkdownPostModule>('../data/posts/**/*.md', {
	eager: true,
});

const posts = (
	await Promise.all(Object.values(postModules).map(async (post) => ({
		...post.frontmatter,
		contentHtml: await post.compiledContent(),
	})))
).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

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

export function getAllPosts(): SourcePost[] {
	return [...posts];
}

export function getPostAlternatePaths(post: SourcePost): Partial<Record<Locale, string>> {
	return translatedPostPathsByPath.get(post.path) ?? { [post.locale]: post.path };
}

export function getPostsByCategory(categoryId: number): SourcePost[] {
	return posts.filter((post) => post.categoryIds.includes(categoryId));
}

export function getPostByPath(path: string): SourcePost | undefined {
	const normalizedPath = path.endsWith('/') ? path : `${path}/`;
	return posts.find((post) => post.path === normalizedPath);
}
