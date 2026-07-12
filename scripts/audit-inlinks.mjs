import { relative } from 'node:path';
import { readAllPosts } from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const jsonOutput = args.includes('--json');
const includeNavigation = args.includes('--include-navigation');
const threshold = Number(argumentValue('--threshold') ?? 2);
const localeFilter = argumentValue('--locale');
const categoryFilter = argumentValue('--category');
const limit = Number(argumentValue('--limit') ?? 80);

if (help) {
	console.log(`Usage:
node scripts/audit-inlinks.mjs [--json] [--threshold=2] [--locale=de|en] [--category=news-video] [--include-navigation] [--limit=80]

Counts incoming internal post links from Markdown bodies, post CTA frontmatter, and
relatedPosts frontmatter. Generated previous/next post navigation is reported
separately and included only with --include-navigation.`);
	process.exit(0);
}

if (!Number.isFinite(threshold) || threshold < 0) {
	throw new Error('--threshold must be a non-negative number');
}

const allPosts = readAllPosts();
const selectedPosts = allPosts.filter((post) => (
	(!localeFilter || post.frontmatter.locale === localeFilter)
	&& (!categoryFilter || post.frontmatter.category === categoryFilter)
));
const knownPostsByPath = new Map(allPosts.map((post) => [post.frontmatter.path, post]));
const selectedPaths = new Set(selectedPosts.map((post) => post.frontmatter.path));
const inlinksByPath = new Map(allPosts.map((post) => [post.frontmatter.path, []]));

addBodyInlinks();
addPostCtaInlinks();
addRelatedPostInlinks();
addNavigationInlinks();

const postReports = selectedPosts
	.map((post) => reportForPost(post))
	.sort((a, b) => (
		a.totalForThreshold - b.totalForThreshold
		|| a.editorialTotal - b.editorialTotal
		|| Date.parse(b.date) - Date.parse(a.date)
		|| a.path.localeCompare(b.path)
	));
const weakPosts = postReports.filter((report) => report.totalForThreshold <= threshold);
const summary = summarize(postReports, weakPosts);
const report = {
	options: {
		threshold,
		locale: localeFilter,
		category: categoryFilter,
		includeNavigation,
		limit,
	},
	postCount: selectedPosts.length,
	weakPostCount: weakPosts.length,
	summary,
	weakPosts,
	posts: postReports,
};

if (jsonOutput) {
	console.log(JSON.stringify(report, null, '\t'));
} else {
	printTextReport(report);
}

function addBodyInlinks() {
	for (const post of allPosts) {
		for (const link of extractInternalLinks(post.body)) {
			addInlink(link, {
				sourcePath: post.frontmatter.path,
				sourceFile: post.filePath,
				sourceTitle: post.frontmatter.title,
				kind: 'body',
			});
		}
	}
}

function addPostCtaInlinks() {
	for (const post of allPosts) {
		addInlink(post.frontmatter.postCta?.pagePath, {
			sourcePath: post.frontmatter.path,
			sourceFile: post.filePath,
			sourceTitle: post.frontmatter.title,
			kind: 'postCta',
		});
	}
}

function addRelatedPostInlinks() {
	for (const source of allPosts) {
		const sourcePath = source.frontmatter.path;
		const targetPaths = source.frontmatter.relatedPosts;
		if (!Array.isArray(targetPaths)) {
			continue;
		}

		for (const targetPath of targetPaths) {
			addInlink(targetPath, {
				sourcePath,
				sourceFile: source.filePath,
				sourceTitle: source.frontmatter.title,
				kind: 'related',
			});
		}
	}
}

function addNavigationInlinks() {
	const byLocale = groupPosts((post) => post.frontmatter.locale);
	const byLocaleCategory = groupPosts((post) => `${post.frontmatter.locale}:${post.frontmatter.category}`);

	for (const group of [...byLocale.values(), ...byLocaleCategory.values()]) {
		const sorted = [...group].sort((a, b) => Date.parse(b.frontmatter.date) - Date.parse(a.frontmatter.date));
		for (let index = 0; index < sorted.length; index += 1) {
			const source = sorted[index];
			const previous = sorted[index + 1];
			const next = sorted[index - 1];

			for (const target of [previous, next].filter(Boolean)) {
				addInlink(target.frontmatter.path, {
					sourcePath: source.frontmatter.path,
					sourceFile: source.filePath,
					sourceTitle: source.frontmatter.title,
					kind: 'navigation',
				});
			}
		}
	}
}

function groupPosts(keyForPost) {
	const groups = new Map();

	for (const post of allPosts) {
		const key = keyForPost(post);
		groups.set(key, [...(groups.get(key) ?? []), post]);
	}

	return groups;
}

function addInlink(path, link) {
	const normalizedPath = normalizeInternalPath(path);

	if (!normalizedPath || !knownPostsByPath.has(normalizedPath)) {
		return;
	}

	if (normalizedPath === link.sourcePath) {
		return;
	}

	inlinksByPath.get(normalizedPath)?.push(link);
}

function extractInternalLinks(markdown) {
	const links = [];
	const patterns = [
		/\[[^\]]+\]\((\/[^)#\s]+)(?:#[^)]+)?\)/g,
		/<a\b[^>]*\bhref=(["'])(\/[^"']+)\1/gi,
	];

	for (const pattern of patterns) {
		for (const match of markdown.matchAll(pattern)) {
			links.push(match[2] ?? match[1]);
		}
	}

	return links;
}

function normalizeInternalPath(value) {
	if (!value || typeof value !== 'string' || !value.startsWith('/')) {
		return undefined;
	}

	const path = value.split(/[?#]/, 1)[0];
	return path.endsWith('/') ? path : `${path}/`;
}

function reportForPost(post) {
	const links = inlinksByPath.get(post.frontmatter.path) ?? [];
	const counts = countBy(links, (link) => link.kind);
	const editorialTotal = (counts.body ?? 0) + (counts.postCta ?? 0) + (counts.related ?? 0);
	const navigationTotal = counts.navigation ?? 0;
	const totalForThreshold = includeNavigation ? editorialTotal + navigationTotal : editorialTotal;
	const sampleSources = links
		.filter((link) => includeNavigation || link.kind !== 'navigation')
		.slice(0, 8)
		.map((link) => ({
			kind: link.kind,
			path: link.sourcePath,
			title: link.sourceTitle,
			file: link.sourceFile ? relative(process.cwd(), link.sourceFile) : undefined,
		}));

	return {
		path: post.frontmatter.path,
		file: relative(process.cwd(), post.filePath),
		title: post.frontmatter.title,
		locale: post.frontmatter.locale,
		category: post.frontmatter.category,
		date: post.frontmatter.date,
		modified: post.frontmatter.modified,
		isVideo: Boolean(post.frontmatter.video),
		editorialTotal,
		navigationTotal,
		totalForThreshold,
		counts: {
			body: counts.body ?? 0,
			postCta: counts.postCta ?? 0,
			related: counts.related ?? 0,
			navigation: navigationTotal,
		},
		sampleSources,
	};
}

function countBy(items, keyForItem) {
	const counts = {};

	for (const item of items) {
		const key = keyForItem(item);
		counts[key] = (counts[key] ?? 0) + 1;
	}

	return counts;
}

function summarize(postReports, weakPosts) {
	return {
		byLocale: summarizeBy(postReports, weakPosts, (post) => post.locale),
		byCategory: summarizeBy(postReports, weakPosts, (post) => post.category),
		zeroEditorialInlinks: postReports.filter((post) => post.editorialTotal === 0).length,
		zeroThresholdInlinks: postReports.filter((post) => post.totalForThreshold === 0).length,
	};
}

function summarizeBy(postReports, weakPosts, keyForPost) {
	const allCounts = countBy(postReports, keyForPost);
	const weakCounts = countBy(weakPosts, keyForPost);

	return Object.fromEntries(
		Object.entries(allCounts)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, total]) => [key, { total, weak: weakCounts[key] ?? 0 }]),
	);
}

function printTextReport({ options, postCount, weakPostCount, summary, weakPosts }) {
	const mode = options.includeNavigation ? 'editorial + navigation' : 'editorial';
	console.log(`Audited ${postCount} post(s): ${weakPostCount} at or below ${options.threshold} ${mode} inlink(s).`);
	console.log(`Zero editorial inlinks: ${summary.zeroEditorialInlinks}`);
	console.log(`Zero threshold inlinks: ${summary.zeroThresholdInlinks}`);
	console.log('');
	console.log('Weak posts by locale:');
	for (const [locale, counts] of Object.entries(summary.byLocale)) {
		console.log(`- ${locale}: ${counts.weak}/${counts.total}`);
	}
	console.log('');
	console.log('Weak posts by category:');
	for (const [category, counts] of Object.entries(summary.byCategory)) {
		console.log(`- ${category}: ${counts.weak}/${counts.total}`);
	}

	const displayedPosts = Number.isFinite(options.limit) && options.limit >= 0
		? weakPosts.slice(0, options.limit)
		: weakPosts;

	if (!displayedPosts.length) {
		return;
	}

	console.log('');
	console.log(`Weakest posts${displayedPosts.length < weakPosts.length ? ` (first ${displayedPosts.length})` : ''}:`);
	for (const post of displayedPosts) {
		console.log(`- ${post.totalForThreshold} inlink(s) [body ${post.counts.body}, related ${post.counts.related}, cta ${post.counts.postCta}, nav ${post.counts.navigation}] ${post.path}`);
		console.log(`  ${post.title}`);
		console.log(`  ${post.file}`);
	}
}

function argumentValue(name) {
	const prefix = `${name}=`;
	const inline = args.find((argument) => argument.startsWith(prefix));

	if (inline) {
		return inline.slice(prefix.length);
	}

	const index = args.indexOf(name);
	return index === -1 ? undefined : args[index + 1];
}
