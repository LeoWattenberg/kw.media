import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import {
	allPostFiles,
	readAllPosts,
	readPostFile,
	writePostFile,
} from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const write = args.includes('--write');
const dryRun = !write;
const linkDensity = Number(argumentValue('--link-density') ?? process.env.INLINE_POST_LINK_DENSITY ?? 2);
const limit = Number(argumentValue('--limit') ?? 0);
const relatedPath = resolve(argumentValue('--related') ?? join(process.cwd(), 'src/data/related-posts.json'));
const commonStopWords = new Set([
	'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'new', 'of', 'on', 'or', 'the', 'this', 'to', 'was', 'what', 'with',
	'ab', 'als', 'am', 'an', 'auf', 'aus', 'bei', 'bis', 'da', 'das', 'dein', 'deine', 'deines', 'dem', 'den', 'der', 'des', 'die', 'dies', 'du', 'ein', 'eine', 'einem', 'einen', 'einer', 'es', 'für', 'im', 'ist', 'jede', 'jeden', 'jeder', 'mit', 'nach', 'neu', 'neue', 'neuen', 'nicht', 'nur', 'sie', 'und', 'von', 'was', 'wie', 'zu', 'zur',
]);
const englishStopWords = new Set(['are', 'can', 'do', 'does', 'get', 'has', 'have', 'more', 'now', 'that', 'will', 'you', 'your']);
const germanStopWords = new Set(['auch', 'beim', 'beitrag', 'durch', 'euch', 'ihnen', 'jetzt', 'mehr', 'oder', 'sich', 'sind', 'über', 'wenn']);
const genericWords = new Set([
	'aber', 'aktuell', 'aktuellen', 'artikel', 'beispiel', 'dass', 'deinen', 'dich', 'einfach', 'fall', 'frage', 'gibt', 'guide', 'inhalt', 'kanal', 'post', 'stand', 'thema', 'titel', 'video',
	'about', 'article', 'channel', 'content', 'current', 'example', 'guide', 'post', 'title', 'topic', 'video',
]);
const brandOnlyWords = new Set(['youtube', 'twitch', 'google', 'shorts', 'creator', 'creators']);

if (help) {
	console.log(`Usage:
node scripts/add-inline-post-links.mjs [--write] [--link-density=2] [--limit=20] [post.md ...]

Creates inline Markdown links from post bodies to other same-locale posts.
Defaults to dry-run mode. Add --write to edit files.

Options:
- --write          Apply changes. Without it, only print proposed links.
- --link-density=N Maximum new links per 1000 body words. Defaults to 2.
- --limit=N       Process only the first N selected posts.
- --related=...   Related-post JSON path. Defaults to src/data/related-posts.json.`);
	process.exit(0);
}

if (!Number.isFinite(linkDensity) || linkDensity <= 0) {
	throw new Error('--link-density must be a positive number');
}

const allPosts = readAllPosts();
const postsByPath = new Map(allPosts.map((post) => [post.frontmatter.path, post]));
const relatedPosts = readRelatedPosts(relatedPath);
const selectedFiles = selectFiles();
const selectedPosts = (limit > 0 ? selectedFiles.slice(0, limit) : selectedFiles).map((filePath) => readPostFile(filePath));
const results = [];

console.log(`${dryRun ? 'Dry run' : 'Writing inline links'} for ${selectedPosts.length} post(s).`);

for (const [index, post] of selectedPosts.entries()) {
	const candidates = candidatePostsFor(post);
	const result = linkPostBody(post, candidates);
	const label = relative(process.cwd(), post.filePath);

	console.log(`${index + 1}/${selectedPosts.length} ${label} (${result.wordCount} words, max ${result.linkLimit} link(s))`);

	if (!result.links.length) {
		console.log('  no natural inline link target found');
		results.push({ post, result });
		continue;
	}

	for (const link of result.links) {
		console.log(`  ${link.anchor} -> ${link.path}`);
	}

	if (!dryRun) {
		writePostFile(post.filePath, post.frontmatter, result.body);
	}

	results.push({ post, result });
}

const changed = results.filter(({ result }) => result.links.length).length;
console.log(`${dryRun ? 'Would change' : 'Changed'} ${changed} of ${selectedPosts.length} post(s).`);

function selectFiles() {
	const passedFiles = positionalArgs();
	if (passedFiles.length) {
		return passedFiles.map((filePath) => resolve(filePath));
	}

	return allPostFiles();
}

function positionalArgs() {
	return args.filter((argument) => !argument.startsWith('-'));
}

function argumentValue(name) {
	const prefix = `${name}=`;
	const inline = args.find((argument) => argument.startsWith(prefix));
	if (inline) {
		return inline.slice(prefix.length);
	}

	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}

function readRelatedPosts(filePath) {
	if (!existsSync(filePath)) {
		console.warn(`Related-post data not found at ${relative(process.cwd(), filePath)}; falling back to same-locale candidates.`);
		return {};
	}

	return JSON.parse(readFileSync(filePath, 'utf8'));
}

function candidatePostsFor(post) {
	const relatedPaths = Array.isArray(relatedPosts[post.frontmatter.path])
		? relatedPosts[post.frontmatter.path]
		: [];
	const seen = new Set([post.frontmatter.path]);
	const candidates = [];

	for (const path of relatedPaths) {
		const candidate = postsByPath.get(path);
		if (candidate && candidate.frontmatter.locale === post.frontmatter.locale && !seen.has(path)) {
			candidates.push(candidate);
			seen.add(path);
		}
	}

	if (!relatedPaths.length) {
		for (const candidate of allPosts) {
			const path = candidate.frontmatter.path;
			if (candidate.frontmatter.locale === post.frontmatter.locale && !seen.has(path)) {
				candidates.push(candidate);
				seen.add(path);
			}
		}
	}

	return candidates;
}

function linkPostBody(post, candidates) {
	let body = post.body;
	const existingPaths = linkedPostPaths(body);
	const wordCount = countBodyWords(body);
	const linkLimit = linkLimitForWordCount(wordCount);
	const links = [];

	for (const candidate of candidates) {
		if (links.length >= linkLimit) {
			break;
		}

		const targetPath = candidate.frontmatter.path;
		if (existingPaths.has(targetPath)) {
			continue;
		}

		const anchor = findAnchor(body, candidate, post.frontmatter.locale);
		if (!anchor) {
			continue;
		}

		const linked = insertFirstMarkdownLink(body, anchor, targetPath);
		if (linked === body) {
			continue;
		}

		body = linked;
		existingPaths.add(targetPath);
		links.push({ anchor, path: targetPath });
	}

	return { body, links, linkLimit, wordCount };
}

function linkedPostPaths(body) {
	return new Set(
		[...body.matchAll(/\]\((\/youtube-[^)#\s]+\/)(?:#[^)]+)?\)/g)]
			.map((match) => match[1]),
	);
}

function linkLimitForWordCount(wordCount) {
	return Math.max(1, Math.floor((wordCount * linkDensity) / 1000));
}

function countBodyWords(body) {
	const text = body
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`[^`\n]+`/g, ' ')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/<[^>\n]+>/g, ' ')
		.replace(/^#{1,6}\s+/gm, ' ')
		.replace(/[>*_~()[\]{}.,:;!?'"“”‘’]/g, ' ');

	return (text.match(/[\p{L}\p{N}][\p{L}\p{N}+/#.-]*/gu) ?? []).length;
}

function findAnchor(body, candidate, locale) {
	const phrases = anchorPhrases(candidate, locale);

	for (const phrase of phrases) {
		if (findMatchOutsideProtectedRanges(body, phrase)) {
			return phrase;
		}
	}

	return undefined;
}

function anchorPhrases(post, locale) {
	const values = [
		post.frontmatter.title,
		post.frontmatter.excerpt,
	];
	const phrases = new Set();

	for (const value of values) {
		const clean = cleanPhrase(value);
		addPhrase(phrases, clean, locale);

		for (const part of clean.split(/\s+(?:und|and|oder|or)\s+|[:;,.!?()[\]"]/i)) {
			addPhrase(phrases, part, locale);
		}

		for (const ngram of ngrams(clean, locale)) {
			addPhrase(phrases, ngram, locale);
		}
	}

	return [...phrases]
		.sort((a, b) => b.length - a.length)
		.slice(0, 80);
}

function cleanPhrase(value) {
	return String(value ?? '')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/[`*_>#]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function addPhrase(phrases, phrase, locale) {
	const clean = phrase.replace(/^[\s"'“”‘’()[\],:;.!?]+|[\s"'“”‘’()[\],:;.!?]+$/g, '').trim();

	if (isUsefulPhrase(clean, locale)) {
		phrases.add(clean);
	}
}

function ngrams(text, locale) {
	const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}+/#.-]*/gu) ?? [];
	const phrases = [];

	for (let size = 5; size >= 2; size -= 1) {
		for (let index = 0; index <= words.length - size; index += 1) {
			const slice = words.slice(index, index + size);
			if (isStopWord(slice[0], locale) || isStopWord(slice.at(-1), locale)) {
				continue;
			}

			phrases.push(slice.join(' '));
		}
	}

	return phrases;
}

function isUsefulPhrase(phrase, locale) {
	if (phrase.length < 6 || phrase.length > 90) {
		return false;
	}

	const words = phrase.match(/[\p{L}\p{N}][\p{L}\p{N}+/#.-]*/gu) ?? [];
	if (!words.length) {
		return false;
	}

	if (words.length === 1 && !/[A-ZÄÖÜ]{2,}|\/|-|\d/.test(phrase)) {
		return false;
	}

	if (words.every((word) => {
		const normalized = word.toLowerCase();
		return isStopWord(word, locale) || brandOnlyWords.has(normalized) || genericWords.has(normalized);
	})) {
		return false;
	}

	return true;
}

function isStopWord(word, locale) {
	const normalized = word.toLowerCase();
	return commonStopWords.has(normalized) || (locale === 'de' ? germanStopWords.has(normalized) : englishStopWords.has(normalized));
}

function insertFirstMarkdownLink(body, phrase, path) {
	const match = findMatchOutsideProtectedRanges(body, phrase);
	if (!match) {
		return body;
	}

	return `${body.slice(0, match.start)}[${body.slice(match.start, match.end)}](${path})${body.slice(match.end)}`;
}

function findMatchOutsideProtectedRanges(body, phrase) {
	const protectedRanges = markdownProtectedRanges(body);
	const escaped = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
	const regex = new RegExp(`(^|[^\\p{L}\\p{N}/])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
	let match;

	while ((match = regex.exec(body))) {
		const start = match.index + match[1].length;
		const end = start + match[2].length;

		if (isProtected(start, end, protectedRanges) || isHeadingLine(body, start)) {
			continue;
		}

		return { start, end };
	}

	return undefined;
}

function markdownProtectedRanges(body) {
	return [
		...regexRanges(body, /```[\s\S]*?```/g),
		...regexRanges(body, /`[^`\n]+`/g),
		...regexRanges(body, /!?\[[^\]]*]\([^)]+\)/g),
		...regexRanges(body, /<[^>\n]+>/g),
	];
}

function regexRanges(text, regex) {
	return [...text.matchAll(regex)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}));
}

function isProtected(start, end, ranges) {
	return ranges.some((range) => start < range.end && end > range.start);
}

function isHeadingLine(body, index) {
	const lineStart = body.lastIndexOf('\n', index - 1) + 1;
	return /^#{1,6}\s/.test(body.slice(lineStart, index));
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
