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
	translationKey?: string;
	category: Category;
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

export type Category = 'blog' | 'short-tutorial' | 'video-tutorial' | 'news-video';

export interface AdjacentPosts {
	previous?: SourcePost;
	next?: SourcePost;
}

export interface PostNavigation {
	chronological: AdjacentPosts;
	category: AdjacentPosts;
}

interface MarkdownPostModule {
	frontmatter: Omit<SourcePost, 'contentHtml' | 'category'> & { category?: Category };
	compiledContent: () => Promise<string>;
}

const postModules = import.meta.glob<MarkdownPostModule>('../data/posts/**/*.md', {
	eager: true,
});

const posts = (
	await Promise.all(Object.values(postModules).map(async (post) => ({
		...post.frontmatter,
		category: getCategory(post.frontmatter),
		contentHtml: await post.compiledContent(),
	})))
).sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

function getCategory(post: MarkdownPostModule['frontmatter']): Category {
	if (post.category) {
		return post.category;
	}

	if (!post.video) {
		return 'blog';
	}

	if (post.video.watchUrl.includes('/shorts/')) {
		return 'short-tutorial';
	}

	return 'video-tutorial';
}

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

function translationGroupKey(post: SourcePost): string {
	return post.translationKey ?? (post.video ? `video:${post.video.youtubeId}` : post.path);
}

const inferredTranslatedPostPaths = new Map<string, SourcePost[]>();

for (const post of posts) {
	const key = translationGroupKey(post);
	inferredTranslatedPostPaths.set(key, [...(inferredTranslatedPostPaths.get(key) ?? []), post]);
}

const inferredTranslatedPostPathsByPath = new Map(
	[...inferredTranslatedPostPaths.values()]
		.filter((group) => group.length > 1)
		.map((group) => Object.fromEntries(group.map((post) => [post.locale, post.path])) as Partial<Record<Locale, string>>)
		.flatMap((paths) => Object.values(paths).map((path) => [path, paths] as const)),
);

export function getAllPosts(): SourcePost[] {
	return [...posts];
}

export function getPostAlternatePaths(post: SourcePost): Partial<Record<Locale, string>> {
	return translatedPostPathsByPath.get(post.path)
		?? inferredTranslatedPostPathsByPath.get(post.path)
		?? { [post.locale]: post.path };
}

export function getPostNavigation(post: SourcePost): PostNavigation {
	return {
		chronological: getAdjacentPosts(posts.filter((candidate) => candidate.locale === post.locale), post),
		category: getAdjacentPosts(
			posts.filter((candidate) => candidate.locale === post.locale && candidate.category === post.category),
			post,
		),
	};
}

export function getPostByPath(path: string): SourcePost | undefined {
	const normalizedPath = path.endsWith('/') ? path : `${path}/`;
	return posts.find((post) => post.path === normalizedPath);
}

function getAdjacentPosts(candidates: SourcePost[], post: SourcePost): AdjacentPosts {
	const currentIndex = candidates.findIndex((candidate) => candidate.path === post.path);

	if (currentIndex === -1) {
		return {};
	}

	return {
		previous: candidates[currentIndex + 1],
		next: candidates[currentIndex - 1],
	};
}
