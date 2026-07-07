import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import {
	allPostFiles,
	readAllPosts,
	readPostFile,
	writePostFile,
} from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const useAi = !args.includes('--no-ai') && process.env.INLINE_POST_LINK_AI !== '0';
const linkDensity = Number(argumentValue('--link-density') ?? process.env.INLINE_POST_LINK_DENSITY ?? 2);
const limit = Number(argumentValue('--limit') ?? 0);
const candidateCount = Number(argumentValue('--candidates') ?? process.env.INLINE_POST_LINK_CANDIDATES ?? 8);
const relatedPath = resolve(argumentValue('--related') ?? join(process.cwd(), 'src/data/related-posts.json'));
const ollamaUrl = process.env.OLLAMA_URL ?? process.env.OLLAMA_TRANSLATE_URL ?? 'http://172.20.208.1:11434';
const anchorModel = process.env.OLLAMA_INLINE_LINK_MODEL ?? 'gemma4:31b';
const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 300000);
const commonStopWords = new Set([
	'a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'how', 'in', 'into', 'is', 'it', 'new', 'of', 'on', 'or', 'the', 'this', 'to', 'was', 'what', 'with',
	'ab', 'als', 'am', 'an', 'auf', 'aus', 'bei', 'bis', 'da', 'das', 'dein', 'deine', 'deines', 'dem', 'den', 'der', 'des', 'die', 'dies', 'du', 'ein', 'eine', 'einem', 'einen', 'einer', 'es', 'für', 'im', 'ist', 'jede', 'jeden', 'jeder', 'mit', 'nach', 'neu', 'neue', 'neuen', 'nicht', 'nur', 'sie', 'und', 'von', 'was', 'wie', 'zu', 'zur',
]);
const englishStopWords = new Set(['are', 'can', 'do', 'does', 'get', 'has', 'have', 'more', 'now', 'that', 'will', 'you', 'your']);
const germanStopWords = new Set(['auch', 'beim', 'beitrag', 'durch', 'euch', 'ihnen', 'jetzt', 'mehr', 'oder', 'sich', 'sind', 'über', 'wenn']);
const genericWords = new Set([
	'aber', 'aktuell', 'aktuellen', 'artikel', 'beispiel', 'dass', 'deinen', 'dich', 'einfach', 'fall', 'frage', 'gibt', 'guide', 'inhalt', 'kanal', 'news', 'post', 'stand', 'thema', 'titel', 'update', 'updates', 'video',
	'about', 'article', 'channel', 'content', 'current', 'example', 'guide', 'news', 'post', 'title', 'topic', 'update', 'updates', 'video',
]);
const brandOnlyWords = new Set(['youtube', 'twitch', 'google', 'shorts', 'creator', 'creators']);
const boilerplateAnchorPatterns = [
	/^creator news$/i,
	/^youtube creator news$/i,
	/^youtube updates?$/i,
	/^willkommen zu den creator news/i,
	/^welcome to (the )?creator news/i,
	/^was creator wissen (müssen|sollten)$/i,
	/^what creators? (need|should) know$/i,
	/^take care$/i,
	/^bye-?bye$/i,
];
const sidebarPageOrder = [
	'home',
	'creator',
	'brands',
	'courses',
	'live',
	'ads',
	'website-design-management',
	'vtuber',
	'dubbing',
	'tips',
	'audacity',
	'tools',
	'imprint-service',
	'legal',
];

if (help) {
	console.log(`Usage:
node scripts/add-inline-post-links.mjs [--dry] [--link-density=2] [--limit=20] [post.md ...]

Creates inline Markdown links from post bodies to other same-locale posts.
Writes changes by default. Add --dry to preview proposed links.

Options:
- --dry            Preview proposed links without editing files.
- --link-density=N Maximum new links per 1000 body words. Defaults to 2.
- --candidates=N  Related post candidates to send to Ollama after sidebar pages. Defaults to 8.
- --no-ai         Use deterministic phrase matching instead of Ollama anchor selection.
- --limit=N       Process only the first N selected posts.
- --related=...   Related-post JSON path. Defaults to src/data/related-posts.json.`);
	process.exit(0);
}

if (!Number.isFinite(linkDensity) || linkDensity <= 0) {
	throw new Error('--link-density must be a positive number');
}

if (!Number.isFinite(candidateCount) || candidateCount < 1) {
	throw new Error('--candidates must be a positive number');
}

const allPosts = readAllPosts();
const postsByPath = new Map(allPosts.map((post) => [post.frontmatter.path, post]));
const sidebarPages = readSidebarPages();
const relatedPosts = readRelatedPosts(relatedPath);
const selectedFiles = selectFiles();
const selectedPosts = (limit > 0 ? selectedFiles.slice(0, limit) : selectedFiles).map((filePath) => readPostFile(filePath));
const results = [];

console.log(`${dryRun ? 'Dry run' : 'Writing inline links'} for ${selectedPosts.length} post(s).`);
console.log(`Anchor selection: ${useAi ? `Ollama ${anchorModel}` : 'deterministic'}`);

for (const [index, post] of selectedPosts.entries()) {
	const candidates = candidatePostsFor(post);
	const result = await linkPostBody(post, candidates);
	const label = relative(process.cwd(), post.filePath);

	console.log(`${index + 1}/${selectedPosts.length} ${label} (${result.wordCount} words, max ${result.linkLimit} link(s))`);

	if (!result.links.length) {
		console.log('  no natural inline link target found');
		results.push({ post, result });
		continue;
	}

	for (const link of result.links) {
		console.log(`  ${link.anchor} -> ${link.path} (${link.source})`);
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

function readSidebarPages() {
	const pagesDirectory = join(process.cwd(), 'src/data/pages');
	const jsonPages = readdirSync(pagesDirectory)
		.filter((fileName) => fileName.endsWith('.json'))
		.flatMap((fileName) => {
			const source = JSON.parse(readFileSync(join(pagesDirectory, fileName), 'utf8'));
			return Object.entries(source.translations ?? {}).map(([locale, translation]) => pageCandidate(source.id, locale, translation));
		});
	const toolPages = [
		pageCandidate('tools', 'de', {
			id: 'tools-de',
			path: '/de/tools/',
			title: 'Tools',
			description: 'Clientseitige Creator-Tools von Koytek Wattenberg Media.',
			blocks: [],
		}),
		pageCandidate('tools', 'en', {
			id: 'tools-en',
			path: '/en/tools/',
			title: 'Tools',
			description: 'Client-side creator tools by Koytek Wattenberg Media.',
			blocks: [],
		}),
	];

	return [...jsonPages, ...toolPages]
		.filter((page) => sidebarPageOrder.includes(pageGroup(page.pageId)))
		.sort((first, second) => sidebarPageOrder.indexOf(pageGroup(first.pageId)) - sidebarPageOrder.indexOf(pageGroup(second.pageId)));
}

function pageCandidate(pageId, locale, translation) {
	return {
		pageId,
		frontmatter: {
			path: translation.path,
			locale,
			title: translation.title,
			excerpt: pageExcerpt(translation),
			category: 'site-page',
		},
		body: '',
	};
}

function pageGroup(id) {
	return id.replace(/-(de|en)$/, '');
}

function pageExcerpt(page) {
	const parts = [
		page.description,
		...pageBlockText(page.blocks ?? []),
	];

	return parts
		.filter(Boolean)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 600);
}

function pageBlockText(blocks) {
	return blocks.flatMap((block) => {
		switch (block.type) {
			case 'hero':
			case 'cta':
				return [block.title, block.text];
			case 'services':
				return [block.eyebrow, block.title, block.intro, ...(block.items ?? []).flatMap((item) => [item.title, item.text])];
			case 'credentials':
				return block.items ?? [];
			case 'stats':
				return (block.items ?? []).flatMap((item) => [item.value, item.label]);
			case 'text':
				return [block.eyebrow, block.title, ...(block.body ?? []), ...(block.checks ?? [])];
			case 'testimonials':
				return [block.eyebrow, block.title, block.intro, ...(block.items ?? []).flatMap((item) => [item.quote, item.name, item.meta])];
			case 'faq':
				return [block.title, ...(block.items ?? []).flatMap((item) => [item.question, ...(item.answer ?? [])])];
			case 'pricing':
				return [block.eyebrow, block.title, block.note, ...(block.items ?? []).flatMap((item) => [item.name, item.summary, ...(item.features ?? [])])];
			case 'person':
				return [block.eyebrow, block.title, block.name, block.role, ...(block.credentials ?? []), ...(block.body ?? [])];
			case 'posts':
			case 'youtubePlaylist':
				return [block.title, block.eyebrow];
			case 'html':
				return [String(block.html ?? '').replace(/<[^>]+>/g, ' ')];
			default:
				return [];
		}
	});
}

function candidatePostsFor(post) {
	const relatedPaths = Array.isArray(relatedPosts[post.frontmatter.path])
		? relatedPosts[post.frontmatter.path]
		: [];
	const seen = new Set([post.frontmatter.path]);
	const candidates = sidebarPageCandidatesFor(post);

	for (const candidate of candidates) {
		seen.add(candidate.frontmatter.path);
	}

	for (const path of relatedPaths) {
		const candidate = postsByPath.get(path);
		if (
			candidate
			&& candidate.frontmatter.locale === post.frontmatter.locale
			&& compatibleLinkCategory(post, candidate)
			&& !seen.has(path)
		) {
			candidates.push(candidate);
			seen.add(path);
		}
	}

	if (!relatedPaths.length) {
		for (const candidate of allPosts) {
			const path = candidate.frontmatter.path;
			if (
				candidate.frontmatter.locale === post.frontmatter.locale
				&& compatibleLinkCategory(post, candidate)
				&& !seen.has(path)
			) {
				candidates.push(candidate);
				seen.add(path);
			}
		}
	}

	return candidates;
}

function sidebarPageCandidatesFor(post) {
	return sidebarPages
		.filter((page) => page.frontmatter.locale === post.frontmatter.locale || page.frontmatter.path === '/impressum/')
		.filter((page) => page.frontmatter.path !== post.frontmatter.path)
		.filter((page) => compatibleLinkCategory(post, page));
}

function compatibleLinkCategory(post, candidate) {
	if (candidate.frontmatter.category === 'site-page') {
		return true;
	}

	return (post.frontmatter.category === 'audacity') === (candidate.frontmatter.category === 'audacity');
}

async function linkPostBody(post, candidates) {
	let body = post.body;
	const existingPaths = linkedPostPaths(body);
	const wordCount = countBodyWords(body);
	const linkLimit = linkLimitForWordCount(wordCount);
	const links = [];
	const availablePageCandidates = candidates
		.filter((candidate) => candidate.frontmatter.category === 'site-page')
		.filter((candidate) => !existingPaths.has(candidate.frontmatter.path));
	const availablePostCandidates = candidates
		.filter((candidate) => candidate.frontmatter.category !== 'site-page')
		.filter((candidate) => !existingPaths.has(candidate.frontmatter.path))
		.slice(0, candidateCount);
	const availableCandidates = [...availablePageCandidates, ...availablePostCandidates];

	if (useAi && availableCandidates.length) {
		try {
			for (const suggestion of await suggestAiLinks(post, availableCandidates, linkLimit)) {
				if (links.length >= linkLimit) {
					break;
				}

				if (!availableCandidates.some((candidate) => candidate.frontmatter.path === suggestion.path)) {
					continue;
				}

				if (existingPaths.has(suggestion.path) || !isUsefulPhrase(suggestion.anchor, post.frontmatter.locale)) {
					continue;
				}

				const linked = insertFirstMarkdownLink(body, suggestion.anchor, suggestion.path);
				if (linked === body) {
					continue;
				}

				body = linked;
				existingPaths.add(suggestion.path);
				links.push({ anchor: suggestion.anchor, path: suggestion.path, source: 'ai' });
			}
		} catch (error) {
			console.warn(`  AI anchor selection failed: ${error.message}`);
		}
	}

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
		links.push({ anchor, path: targetPath, source: 'deterministic' });
	}

	return { body, links, linkLimit, wordCount };
}

async function suggestAiLinks(post, candidates, linkLimit) {
	const validPaths = new Set(candidates.map((candidate) => candidate.frontmatter.path));
	const prompt = `Select meaningful inline links for this kw.media post.

Return only JSON with this exact shape:
{
  "links": [
    { "anchor": "exact phrase from the current post body", "path": "/youtube-tipps-de/example/" }
  ]
}

Current post:
path: ${post.frontmatter.path}
title: ${post.frontmatter.title}
locale: ${post.frontmatter.locale}
category: ${post.frontmatter.category}

Current post body excerpt:
${plainBodyForPrompt(post.body, 5200)}

Candidate target pages and posts:
${candidates.map((candidate, index) => `${index + 1}. path: ${candidate.frontmatter.path}
title: ${candidate.frontmatter.title}
excerpt: ${candidate.frontmatter.excerpt}
category: ${candidate.frontmatter.category}`).join('\n\n')}

Rules:
- Return at most ${linkLimit} links.
- Use only candidate path values exactly as shown.
- The anchor must be an exact contiguous phrase from the current post body.
- Choose concrete topic phrases, named features, product names, platform features, or named concepts.
- Do not choose boilerplate such as "Creator News", "YouTube Updates", greetings, outros, calls to subscribe, or generic news labels.
- Do not choose figures of speech, filler phrases, vague phrases, or phrases that could apply to many posts.
- Do not choose headings.
- Do not invent text.
- Return [] if there is no strong natural inline link.`;

	const response = await ollamaJson('/api/generate', {
		model: anchorModel,
		prompt,
		stream: false,
		format: 'json',
		options: {
			temperature: 0,
			num_ctx: 8192,
		},
	});

	return uniqueAiLinks(parseAiLinkSuggestions(response.response))
		.filter((suggestion) => validPaths.has(suggestion.path))
		.filter((suggestion) => findMatchOutsideProtectedRanges(post.body, suggestion.anchor))
		.slice(0, linkLimit);
}

function linkedPostPaths(body) {
	return new Set(
		[...body.matchAll(/\]\((\/[^)#\s]+\/)(?:#[^)]+)?\)/g)]
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

function plainBodyForPrompt(body, maxLength) {
	return body
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`[^`\n]+`/g, ' ')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/<[^>\n]+>/g, ' ')
		.replace(/^#{1,6}\s+.+$/gm, ' ')
		.replace(/[`*_>#]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maxLength);
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

	if (boilerplateAnchorPatterns.some((pattern) => pattern.test(phrase.trim()))) {
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

async function ollamaJson(path, body) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${ollamaUrl}${path}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			signal: controller.signal,
			body: JSON.stringify(body),
		});

		if (!response.ok) {
			throw new Error(`Ollama ${path} failed with HTTP ${response.status}: ${await response.text()}`);
		}

		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function parseAiLinkSuggestions(text) {
	const output = String(text ?? '').trim();

	try {
		return collectAiLinkSuggestions(JSON.parse(output));
	} catch {
		const match = output.match(/\[[\s\S]*\]/);
		if (match) {
			try {
				return collectAiLinkSuggestions(JSON.parse(match[0]));
			} catch {
				return [];
			}
		}
	}

	return [];
}

function collectAiLinkSuggestions(value) {
	if (Array.isArray(value)) {
		return value
			.map((item) => ({
				anchor: typeof item?.anchor === 'string' ? cleanPhrase(item.anchor) : '',
				path: typeof item?.path === 'string' ? item.path : '',
			}))
			.filter((item) => item.anchor && item.path);
	}

	if (value && typeof value === 'object') {
		if (typeof value.anchor === 'string' && typeof value.path === 'string') {
			return collectAiLinkSuggestions([value]);
		}

		if (Array.isArray(value.links)) {
			return collectAiLinkSuggestions(value.links);
		}

		return Object.values(value).flatMap((item) => collectAiLinkSuggestions(item));
	}

	return [];
}

function uniqueAiLinks(links) {
	const seenAnchors = new Set();
	const seenPaths = new Set();
	const unique = [];

	for (const link of links) {
		const anchorKey = link.anchor.toLowerCase();
		if (seenAnchors.has(anchorKey) || seenPaths.has(link.path)) {
			continue;
		}

		seenAnchors.add(anchorKey);
		seenPaths.add(link.path);
		unique.push(link);
	}

	return unique;
}
