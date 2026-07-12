import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { assertTextLocale } from './language-utils.mjs';

export const postsDir = join(process.cwd(), 'src/data/posts');

export const tagsRegistryPath = join(process.cwd(), 'src/data/tags.json');

export const contentPartMarkers = {
	articleStart: '<!-- kwm:article:start -->',
	articleEnd: '<!-- kwm:article:end -->',
	transcriptStart: '<!-- kwm:transcript:start -->',
	transcriptEnd: '<!-- kwm:transcript:end -->',
};

const postDirectories = {
	blog: {
		de: join(postsDir, 'blog/de'),
		en: join(postsDir, 'blog/en'),
	},
	video: {
		de: join(postsDir, 'video/de'),
		en: join(postsDir, 'video/en'),
	},
	audacity: {
		de: join(postsDir, 'audacity'),
		en: join(postsDir, 'audacity'),
	},
};

const routePrefixes = {
	de: '/youtube-tipps-de',
	en: '/youtube-tips-en',
};

const cleanupModels = {
	fast: process.env.OLLAMA_CLEANUP_FAST_MODEL ?? process.env.OLLAMA_CLEANUP_MODEL ?? 'aya-expanse:32b',
	deep: process.env.OLLAMA_CLEANUP_DEEP_MODEL ?? process.env.OLLAMA_CLEANUP_MODEL ?? 'gemma4:31b',
};

const ollamaUrl = process.env.OLLAMA_URL ?? process.env.OLLAMA_TRANSLATE_URL ?? 'http://172.20.208.1:11434';
const translateModel = process.env.OLLAMA_TRANSLATE_MODEL ?? 'aya-expanse:32b';
const metadataModel = process.env.OLLAMA_METADATA_MODEL ?? process.env.OLLAMA_EXCERPT_MODEL ?? translateModel;
const postCtaModel = process.env.OLLAMA_POST_CTA_MODEL ?? metadataModel;
const tagModel = process.env.OLLAMA_POST_TAG_MODEL ?? metadataModel;
const transcriptExpansionModel = process.env.OLLAMA_TRANSCRIPT_EXPAND_MODEL ?? process.env.OLLAMA_EXPAND_MODEL ?? cleanupModels.deep;
const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 300000);
const chunkSize = Number(process.env.OLLAMA_CHUNK_SIZE ?? 5200);

export function allPostFiles(directory = postsDir) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			return allPostFiles(entryPath);
		}

		return entry.isFile() && entry.name.endsWith('.md') ? [entryPath] : [];
	});
}

export function readAllPosts() {
	return allPostFiles().map((filePath) => readPostFile(filePath));
}

export function readPostFile(filePath) {
	const raw = readFileSync(filePath, 'utf8');
	const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);

	if (!match) {
		throw new Error(`Post is missing frontmatter: ${filePath}`);
	}

	const frontmatter = parseFrontmatter(match[1]);
	frontmatter.category = getCategory(frontmatter);

	return {
		filePath,
		frontmatter,
		body: match[2].replace(/\s+$/, ''),
	};
}

export function writePostFile(filePath, frontmatter, body) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${frontmatterString(frontmatter)}\n\n${body.trim()}\n`);
}

export function getCategory(frontmatter) {
	if (frontmatter.category) {
		return frontmatter.category;
	}

	if (!frontmatter.video) {
		return 'blog';
	}

	if (frontmatter.video.watchUrl?.includes('/shorts/')) {
		return 'short-tutorial';
	}

	return 'video-tutorial';
}

export function cleanupModelForCategory(category) {
	return category === 'short-tutorial' || category === 'news-video'
		? cleanupModels.fast
		: cleanupModels.deep;
}

export async function cleanupPostFile(filePath, options = {}) {
	const post = readPostFile(filePath);
	const model = options.model ?? cleanupModelForCategory(post.frontmatter.category);
	const cleanedBody = await cleanupMarkdown(post.body, post.frontmatter, model);
	assertTextLocale(cleanedBody, post.frontmatter.locale, `Cleaned post ${post.frontmatter.path}`);
	const frontmatter = {
		...post.frontmatter,
		excerpt: excerptFromBody(cleanedBody, post.frontmatter.locale),
	};

	writePostFile(filePath, frontmatter, cleanedBody);

	return {
		filePath,
		model,
		category: post.frontmatter.category,
	};
}

export async function translateTranscriptMarkdown(markdown, sourceLocale, targetLocale, category = 'video-tutorial') {
	if (sourceLocale === targetLocale) {
		return markdown;
	}

	const translated = await translateMarkdown(markdown, { locale: sourceLocale, category }, targetLocale);
	assertTextLocale(translated, targetLocale, 'Translated transcript');
	return translated;
}

export async function expandTranscriptPostFile(filePath, options = {}) {
	const post = readPostFile(filePath);
	const model = options.model ?? transcriptExpansionModel;
	const existingParts = splitPostBodyParts(post.body);
	const transcriptBody = existingParts.transcript ?? post.body;
	const transcriptPost = { ...post, body: transcriptBody };
	const expandedArticle = await expandTranscriptMarkdown(transcriptPost, model, options);
	const expandedBody = composeArticleWithTranscript(expandedArticle, transcriptBody);
	const oldWords = markdownWordCount(post.body);
	const newWords = markdownWordCount(expandedBody);
	const articleWords = markdownWordCount(expandedArticle);
	const transcriptWords = markdownWordCount(transcriptBody);

	if (!options.dryRun) {
		writePostFile(filePath, post.frontmatter, expandedBody);
	}

	return {
		filePath,
		model,
		oldWords,
		newWords,
		articleWords,
		transcriptWords,
		changed: post.body.trim() !== expandedBody.trim(),
		body: expandedBody,
	};
}

export async function translatePostFile(filePath, options = {}) {
	const source = readPostFile(filePath);
	const targetLocale = options.targetLocale ?? otherLocale(source.frontmatter.locale);
	const allPosts = readAllPosts();
	const translationKey = source.frontmatter.translationKey ?? translationKeyFor(source.frontmatter);

	if (hasKnownTranslation(source.frontmatter.path, source.frontmatter.locale, targetLocale)) {
		return {
			sourcePath: filePath,
			skipped: true,
			reason: 'known translation path already exists',
		};
	}

	const existingTranslation = allPosts.find((post) => {
		if (post.frontmatter.locale !== targetLocale) {
			return false;
		}

		if (translationKey && post.frontmatter.translationKey === translationKey) {
			return true;
		}

		return source.frontmatter.video?.youtubeId
			&& post.frontmatter.video?.youtubeId === source.frontmatter.video.youtubeId;
	});

	if (existingTranslation) {
		return {
			sourcePath: filePath,
			targetPath: existingTranslation.filePath,
			skipped: true,
			reason: 'target locale post already exists',
		};
	}

	const translatedTitle = await translatePlainText(source.frontmatter.title, source.frontmatter.locale, targetLocale, 'post title');
	const translatedBody = await translateMarkdown(source.body, source.frontmatter, targetLocale);
	const translatedExcerpt = await translatePlainText(
		source.frontmatter.excerpt || excerptFromBody(source.body, source.frontmatter.locale),
		source.frontmatter.locale,
		targetLocale,
		'post excerpt',
	);
	const translatedSlug = uniqueSlug(slugify(translatedTitle, targetLocale), existingSlugs(allPosts));
	const targetKind = postDirectoryKind(source.frontmatter);
	const targetPath = routePathForPost(source.frontmatter, targetLocale, translatedSlug);
	const targetFilePath = join(postDirectories[targetKind][targetLocale], `${translatedSlug}.md`);
	const nextId = maxPostId(allPosts) + 1;

	const sourceFrontmatterForTranslation = { ...source.frontmatter };
	delete sourceFrontmatterForTranslation.postCta;
	const targetFrontmatter = {
		...sourceFrontmatterForTranslation,
		id: nextId,
		slug: translatedSlug,
		path: targetPath,
		title: translatedTitle,
		excerpt: translatedExcerpt,
		locale: targetLocale,
		translationKey,
	};

	writePostFile(targetFilePath, targetFrontmatter, translatedBody);

	if (!source.frontmatter.translationKey && translationKey) {
		writePostFile(filePath, { ...source.frontmatter, translationKey }, source.body);
	}

	return {
		sourcePath: filePath,
		targetPath: targetFilePath,
		model: translateModel,
		skipped: false,
	};
}

function postDirectoryKind(frontmatter) {
	if (frontmatter.category === 'audacity') {
		return 'audacity';
	}

	return frontmatter.video ? 'video' : 'blog';
}

function routePathForPost(frontmatter, targetLocale, slug) {
	if (frontmatter.category === 'audacity') {
		return targetLocale === 'en' ? `/en/audacity/${slug}/` : `/audacity/${slug}/`;
	}

	return `${routePrefixes[targetLocale]}/${slug}/`;
}

export async function cleanupLastCommitPosts() {
	const changedFiles = execFileSync('git', ['show', '--name-only', '--format=', 'HEAD'], {
		encoding: 'utf8',
	})
		.split(/\r?\n/)
		.map((file) => file.trim())
		.filter((file) => file.startsWith('src/data/posts/') && file.endsWith('.md'));
	const results = [];

	for (const relativePath of changedFiles) {
		const filePath = join(process.cwd(), relativePath);
		if (!existsSync(filePath)) {
			continue;
		}

		results.push(await cleanupPostFile(filePath));
	}

	return results;
}

export async function translateAllMissingPosts() {
	const snapshot = readAllPosts();
	const results = [];

	for (const post of snapshot) {
		const result = await translatePostFile(post.filePath);
		results.push(result);
	}

	return results;
}

export async function generateExcerptForPostFile(filePath, options = {}) {
	const post = readPostFile(filePath);
	const model = options.model ?? metadataModel;
	const excerpt = await generateExcerptForPost(post, model);

	if (!options.dryRun) {
		writePostFile(filePath, { ...post.frontmatter, excerpt }, post.body);
	}

	return {
		filePath,
		model,
		oldExcerpt: post.frontmatter.excerpt,
		excerpt,
		changed: post.frontmatter.excerpt !== excerpt,
	};
}

export async function suggestPostMetadataFile(filePath, options = {}) {
	const post = readPostFile(filePath);
	const model = options.model ?? metadataModel;
	const suggestion = await suggestPostMetadata(post, model);

	return {
		filePath,
		path: post.frontmatter.path,
		locale: post.frontmatter.locale,
		category: post.frontmatter.category,
		model,
		current: {
			title: post.frontmatter.title,
			excerpt: post.frontmatter.excerpt,
		},
		suggestion,
	};
}

export async function generatePostCtaFile(filePath, options = {}) {
	const post = readPostFile(filePath);
	const model = options.model ?? postCtaModel;
	const pageCandidates = options.pageCandidates ?? readPostCtaPageCandidates(post.frontmatter.locale);
	const postCta = await generatePostCta(post, pageCandidates, model);

	if (!options.dryRun) {
		writePostFile(filePath, { ...post.frontmatter, postCta }, post.body);
	}

	return {
		filePath,
		path: post.frontmatter.path,
		locale: post.frontmatter.locale,
		category: post.frontmatter.category,
		model,
		oldPostCta: post.frontmatter.postCta,
		postCta,
		changed: JSON.stringify(post.frontmatter.postCta ?? null) !== JSON.stringify(postCta),
	};
}

export function importSourcesFromDescriptionFile(filePath, description, options = {}) {
	const post = readPostFile(filePath);
	const sources = extractSourceLinksFromDescription(description, {
		sourceUrl: post.frontmatter.sourceUrl,
		videoId: post.frontmatter.video?.youtubeId,
	});
	const changed = sources.length > 0 && JSON.stringify(post.frontmatter.sources ?? []) !== JSON.stringify(sources);

	if (!options.dryRun && changed) {
		writePostFile(filePath, { ...post.frontmatter, sources }, post.body);
	}

	return {
		filePath,
		path: post.frontmatter.path,
		locale: post.frontmatter.locale,
		category: post.frontmatter.category,
		oldSources: Array.isArray(post.frontmatter.sources) ? post.frontmatter.sources : [],
		sources,
		changed,
	};
}

export function extractSourceLinksFromDescription(description, options = {}) {
	const text = String(description ?? '').replace(/\r\n/g, '\n');
	const lines = text.split('\n');
	const sources = [];
	const seen = new Set();

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (isSupportOrCommunityLine(line)) {
			continue;
		}

		const urls = extractUrls(line);

		for (const url of urls) {
			if (!isSourceUrl(url, options)) {
				continue;
			}

			const key = sourceUrlKey(url);
			if (seen.has(key)) {
				continue;
			}

			seen.add(key);
			sources.push({
				title: sourceTitle(url, line, lines[index - 1]),
				url,
			});
		}
	}

	return sources.slice(0, 20);
}

export async function applyPostMetadataFile(filePath, options = {}) {
	const post = readPostFile(filePath);
	const model = options.model ?? metadataModel;
	const suggestion = await suggestPostMetadata(post, model);
	const frontmatter = {
		...post.frontmatter,
		title: options.title === false ? post.frontmatter.title : suggestion.title,
		excerpt: options.excerpt === false ? post.frontmatter.excerpt : suggestion.excerpt,
	};

	if (!options.dryRun) {
		writePostFile(filePath, frontmatter, post.body);
	}

	return {
		filePath,
		model,
		oldTitle: post.frontmatter.title,
		oldExcerpt: post.frontmatter.excerpt,
		title: frontmatter.title,
		excerpt: frontmatter.excerpt,
		changed: post.frontmatter.title !== frontmatter.title || post.frontmatter.excerpt !== frontmatter.excerpt,
		suggestion,
	};
}

export async function repairTranslationPostFile(filePath, options = {}) {
	const target = readPostFile(filePath);
	const sourceLocale = options.sourceLocale ?? otherLocale(target.frontmatter.locale);
	const targetLocale = target.frontmatter.locale;
	const groupKey = translationGroupKey(target.frontmatter);
	const source = readAllPosts().find((post) => (
		post.filePath !== target.filePath
		&& post.frontmatter.locale === sourceLocale
		&& translationGroupKey(post.frontmatter) === groupKey
	));

	if (!source) {
		throw new Error(`No ${sourceLocale} source post found for ${target.frontmatter.path}`);
	}

	const translatedTitle = await translatePlainText(source.frontmatter.title, sourceLocale, targetLocale, 'post title');
	const translatedBody = await translateMarkdown(source.body, source.frontmatter, targetLocale);
	const translatedExcerpt = await translatePlainText(
		source.frontmatter.excerpt || excerptFromBody(source.body, sourceLocale),
		sourceLocale,
		targetLocale,
		'post excerpt',
	);
	const frontmatter = {
		...target.frontmatter,
		title: translatedTitle,
		excerpt: translatedExcerpt,
		translationKey: target.frontmatter.translationKey ?? source.frontmatter.translationKey ?? groupKey,
	};

	if (!options.dryRun) {
		writePostFile(filePath, frontmatter, translatedBody);
	}

	return {
		filePath,
		sourcePath: source.filePath,
		model: translateModel,
		oldTitle: target.frontmatter.title,
		oldExcerpt: target.frontmatter.excerpt,
		title: translatedTitle,
		excerpt: translatedExcerpt,
		changed: target.frontmatter.title !== translatedTitle
			|| target.frontmatter.excerpt !== translatedExcerpt
			|| target.body !== translatedBody,
	};
}

export async function generatePostTagsFile(filePath, options = {}) {
	const post = readPostFile(filePath);
	const model = options.model ?? tagModel;
	const vocabulary = options.vocabulary ?? buildTagVocabulary();
	const locale = post.frontmatter.locale;
	const suggestion = await suggestPostTags(post, vocabulary.localeTags(locale), model);
	const resolved = resolveTags(suggestion, locale, vocabulary).slice(0, 10);
	const tags = enforceTagBounds(resolved, locale);

	if (!options.dryRun) {
		writePostFile(filePath, { ...post.frontmatter, tags }, post.body);
	}

	return {
		filePath,
		path: post.frontmatter.path,
		locale,
		category: post.frontmatter.category,
		model,
		oldTags: Array.isArray(post.frontmatter.tags) ? post.frontmatter.tags : [],
		tags,
		changed: !sameTags(post.frontmatter.tags, tags),
	};
}

export function buildTagVocabulary() {
	const registry = readTagRegistry();
	const bySlug = new Map();
	const byLocale = new Map();

	for (const { slug, name } of registry.tags) {
		bySlug.set(slug, name);
	}

	for (const post of readAllPosts()) {
		const tags = post.frontmatter.tags;
		if (!Array.isArray(tags)) {
			continue;
		}

		for (const tag of tags) {
			registerTag(tag, post.frontmatter.locale);
		}
	}

	function registerTag(name, locale) {
		const slug = tagSlug(name);
		if (!slug) {
			return;
		}

		if (!bySlug.has(slug)) {
			bySlug.set(slug, normalizeTag(name));
		}

		if (locale) {
			if (!byLocale.has(locale)) {
				byLocale.set(locale, new Set());
			}
			byLocale.get(locale).add(bySlug.get(slug));
		}
	}

	return {
		localeTags(locale) {
			return [...(byLocale.get(locale) ?? [])].sort((a, b) => a.localeCompare(b));
		},
		canonicalNameForSlug(slug) {
			return bySlug.get(slug);
		},
		hasSlug(slug) {
			return bySlug.has(slug);
		},
		add(name, locale) {
			registerTag(name, locale);
		},
	};
}

export function isTranscriptExpansionCandidate(post, options = {}) {
	if (!isTranscriptLikePost(post)) {
		return false;
	}

	const parts = splitPostBodyParts(post.body);
	const bodyForQuality = parts.article ?? post.body;
	const minWords = Number(options.minWords ?? 900);
	const words = markdownWordCount(bodyForQuality);
	const headingCount = countMatches(bodyForQuality, /^##\s+/gm);
	const startsAsTranscript = /^\s*##\s+(transkript|transcript)\b/im.test(bodyForQuality);

	return words < minWords || headingCount <= 2 || startsAsTranscript;
}

export function markdownWordCount(markdown) {
	return plainTextFromMarkdown(markdown).split(/\s+/).filter(Boolean).length;
}

export function splitPostBodyParts(body) {
	const article = extractMarkedPart(body, contentPartMarkers.articleStart, contentPartMarkers.articleEnd);
	const transcript = extractMarkedPart(body, contentPartMarkers.transcriptStart, contentPartMarkers.transcriptEnd);

	return {
		article,
		transcript,
		hasStructuredParts: Boolean(article || transcript),
	};
}

export function composeArticleWithTranscript(article, transcript) {
	return [
		contentPartMarkers.articleStart,
		article.trim(),
		contentPartMarkers.articleEnd,
		'',
		contentPartMarkers.transcriptStart,
		transcript.trim(),
		contentPartMarkers.transcriptEnd,
	].join('\n');
}

export function writeTagRegistry() {
	const existing = readTagRegistry();
	const canonical = new Map(existing.tags.map((tag) => [tag.slug, tag.name]));
	const counts = new Map();

	for (const post of readAllPosts()) {
		const tags = post.frontmatter.tags;
		if (!Array.isArray(tags)) {
			continue;
		}

		for (const tag of tags) {
			const slug = tagSlug(tag);
			if (!slug) {
				continue;
			}

			counts.set(slug, (counts.get(slug) ?? 0) + 1);
			if (!canonical.has(slug)) {
				canonical.set(slug, normalizeTag(tag));
			}
		}
	}

	const tags = [...canonical.entries()]
		.map(([slug, name]) => ({ slug, name, count: counts.get(slug) ?? 0 }))
		.sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug));

	mkdirSync(dirname(tagsRegistryPath), { recursive: true });
	writeFileSync(tagsRegistryPath, `${JSON.stringify({ tags }, null, '\t')}\n`);

	return tags;
}

async function suggestPostTags(post, localeTags, model) {
	const locale = post.frontmatter.locale;
	const vocabularyBlock = localeTags.length
		? `Existing tags already in use (reuse these whenever they fit well):\n${localeTags.map((tag) => `- ${tag}`).join('\n')}`
		: 'No existing tags yet; you are creating the first tags for this locale.';
	const prompt = `Choose discoverability tags for this kw.media post.

Return only JSON with this exact shape:
{
  "tags": ["short tag", "another tag"]
}

Rules:
- Return between 3 and 10 tags.
- Use ${languageName(locale)}.
- Strongly prefer reusing an existing tag from the list when it fits the post closely.
- Only create a new tag when no existing tag is a good fit.
- Each tag is 1 to 3 words, short, and concrete: a topic, tool, platform, technique, format, or audience.
- Preserve platform and product names such as YouTube, YouTube Studio, Shorts, Twitch, OBS, Audacity, Super Chat.
- Use natural Title Case for any new tag (for example "Audio Editing", "Live Streaming").
- Do not use generic words on their own such as Video, Update, News, Guide, Channel, or Tutorial unless part of a specific phrase.
- Do not return the post title, duplicates, quotes, markdown, or notes.

Post:
title: ${post.frontmatter.title}
excerpt: ${post.frontmatter.excerpt}
locale: ${locale}
category: ${post.frontmatter.category}

${vocabularyBlock}

Content:
${postPlainText(post, 5200)}`;

	const suggestion = await ollamaGenerateJson(model, prompt);

	return stringArrayField(suggestion?.tags)
		.flatMap((tag) => tag.split(','))
		.map((tag) => normalizeTag(tag))
		.filter((tag) => tag.length >= 2);
}

function resolveTags(suggested, locale, vocabulary) {
	const resolved = [];
	const seenSlugs = new Set();

	for (const tag of suggested) {
		const clean = normalizeTag(tag);
		if (!clean) {
			continue;
		}

		const slug = tagSlug(clean);
		if (!slug || seenSlugs.has(slug)) {
			continue;
		}

		if (vocabulary.hasSlug(slug)) {
			seenSlugs.add(slug);
			resolved.push(vocabulary.canonicalNameForSlug(slug));
			continue;
		}

		const localeTags = vocabulary.localeTags(locale);
		const match = localeTags.find((existing) => tagsAreSimilar(clean, existing));
		if (match) {
			const matchSlug = tagSlug(match);
			if (!seenSlugs.has(matchSlug)) {
				seenSlugs.add(matchSlug);
				resolved.push(vocabulary.canonicalNameForSlug(matchSlug) ?? match);
			}
			continue;
		}

		seenSlugs.add(slug);
		resolved.push(clean);
		vocabulary.add(clean, locale);
	}

	return resolved;
}

function enforceTagBounds(tags, locale) {
	if (tags.length >= 3) {
		return tags;
	}

	if (tags.length === 0) {
		return [];
	}

	console.warn(`  only ${tags.length} tag(s) resolved for ${locale}; keeping them.`);
	return tags;
}

function readTagRegistry() {
	if (!existsSync(tagsRegistryPath)) {
		return { tags: [] };
	}

	try {
		const data = JSON.parse(readFileSync(tagsRegistryPath, 'utf8'));
		const tags = Array.isArray(data?.tags) ? data.tags : [];
		return {
			tags: tags
				.map((tag) => ({ slug: tagSlug(tag.name), name: normalizeTag(tag.name) }))
				.filter((tag) => tag.slug && tag.name),
		};
	} catch (error) {
		console.warn(`Could not read tag registry at ${tagsRegistryPath}: ${error.message}`);
		return { tags: [] };
	}
}

function normalizeTag(tag) {
	return normalizeAiOutput(String(tag ?? ''))
		.replace(/^["'“”\[]+\s*|\s*["'“”\]]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 40);
}

function tagSlug(tag) {
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

function tagsAreSimilar(a, b) {
	const x = a.toLowerCase();
	const y = b.toLowerCase();

	if (x === y) {
		return true;
	}

	if (pluralVariant(x, y)) {
		return true;
	}

	if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) {
		if (Math.min(x.length, y.length) / Math.max(x.length, y.length) >= 0.8) {
			return true;
		}
	}

	return similarityRatio(x, y) >= 0.86;
}

function pluralVariant(a, b) {
	return a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a;
}

function similarityRatio(a, b) {
	if (!a && !b) {
		return 1;
	}

	if (!a || !b) {
		return 0;
	}

	return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

function levenshtein(a, b) {
	const m = a.length;
	const n = b.length;

	if (!m) {
		return n;
	}

	if (!n) {
		return m;
	}

	let previous = new Array(n + 1);
	const current = new Array(n + 1);

	for (let j = 0; j <= n; j += 1) {
		previous[j] = j;
	}

	for (let i = 1; i <= m; i += 1) {
		current[0] = i;
		for (let j = 1; j <= n; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
		}
		previous = [...current];
	}

	return previous[n];
}

function sameTags(a, b) {
	const x = Array.isArray(a) ? a : [];
	const y = Array.isArray(b) ? b : [];

	if (x.length !== y.length) {
		return false;
	}

	const sa = x.map((tag) => tagSlug(tag)).sort();
	const sb = y.map((tag) => tagSlug(tag)).sort();

	return sa.every((slug, index) => slug === sb[index]);
}

function parseFrontmatter(raw) {
	const data = {};
	let section;
	let currentArrayItem;

	for (const line of raw.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}

		const arrayItemMatch = line.match(/^  - ([A-Za-z0-9_]+):\s*(.*)$/);
		if (arrayItemMatch && section) {
			if (!Array.isArray(data[section])) {
				data[section] = [];
			}
			currentArrayItem = {};
			currentArrayItem[arrayItemMatch[1]] = parseValue(arrayItemMatch[2]);
			data[section].push(currentArrayItem);
			continue;
		}

		const arrayNestedMatch = line.match(/^    ([A-Za-z0-9_]+):\s*(.*)$/);
		if (arrayNestedMatch && currentArrayItem) {
			currentArrayItem[arrayNestedMatch[1]] = parseValue(arrayNestedMatch[2]);
			continue;
		}

		const nestedMatch = line.match(/^  ([A-Za-z0-9_]+):\s*(.*)$/);
		if (nestedMatch && section) {
			currentArrayItem = undefined;
			data[section][nestedMatch[1]] = parseValue(nestedMatch[2]);
			continue;
		}

		const sectionMatch = line.match(/^([A-Za-z0-9_]+):\s*$/);
		if (sectionMatch) {
			section = sectionMatch[1];
			data[section] = {};
			currentArrayItem = undefined;
			continue;
		}

		const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
		if (match) {
			section = undefined;
			currentArrayItem = undefined;
			data[match[1]] = parseValue(match[2]);
		}
	}

	return data;
}

function parseValue(value) {
	if (/^".*"$/.test(value)) {
		return JSON.parse(value);
	}

	if (/^\[[^\]]*\]$/.test(value)) {
		return value
			.slice(1, -1)
			.split(',')
			.map((item) => item.trim())
			.filter(Boolean)
			.map(parseArrayItem);
	}

	if (/^\d+$/.test(value)) {
		return Number(value);
	}

	return value;
}

function parseArrayItem(item) {
	if (/^".*"$/.test(item)) {
		try {
			return JSON.parse(item);
		} catch {
			return item.slice(1, -1);
		}
	}

	return item;
}

function frontmatterString(data) {
	const lines = [
		'---',
		`id: ${data.id}`,
		`slug: ${quote(data.slug)}`,
		`path: ${quote(data.path)}`,
		`title: ${quote(data.title)}`,
		`excerpt: ${quote(data.excerpt)}`,
		`date: ${quote(data.date)}`,
		`modified: ${quote(data.modified)}`,
		`locale: ${quote(data.locale)}`,
	];

	if (data.translationKey) {
		lines.push(`translationKey: ${quote(data.translationKey)}`);
	}

	if (data.category) {
		lines.push(`category: ${quote(data.category)}`);
	}

	if (Array.isArray(data.tags) && data.tags.length) {
		lines.push(`tags: [${data.tags.map((tag) => quote(String(tag))).join(', ')}]`);
	}

	if (Array.isArray(data.relatedPosts) && data.relatedPosts.length) {
		lines.push(`relatedPosts: [${data.relatedPosts.map((postPath) => quote(String(postPath))).join(', ')}]`);
	}

	if (data.image) {
		lines.push(`image: ${quote(data.image)}`);
	}

	lines.push(
		`authorName: ${quote(data.authorName)}`,
		`sourceUrl: ${quote(data.sourceUrl)}`,
	);

	if (data.video) {
		lines.push(
			'video:',
			`  youtubeId: ${quote(data.video.youtubeId)}`,
			`  embedUrl: ${quote(data.video.embedUrl)}`,
			`  watchUrl: ${quote(data.video.watchUrl)}`,
			`  thumbnailUrl: ${quote(data.video.thumbnailUrl)}`,
		);
	}

	if (Array.isArray(data.sources) && data.sources.length) {
		lines.push('sources:');
		for (const source of normalizeSources(data.sources)) {
			lines.push(
				`  - title: ${quote(source.title)}`,
				`    url: ${quote(source.url)}`,
			);
		}
	}

	if (data.postCta) {
		lines.push(
			'postCta:',
			`  text: ${quote(data.postCta.text)}`,
			`  pagePath: ${quote(data.postCta.pagePath)}`,
			`  pageTitle: ${quote(data.postCta.pageTitle)}`,
		);
	}

	lines.push('---');
	return lines.join('\n');
}

function quote(value) {
	return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function normalizeSources(sources) {
	const normalized = [];
	const seen = new Set();

	for (const source of sources) {
		const url = cleanUrl(source?.url);
		if (!url || seen.has(sourceUrlKey(url))) {
			continue;
		}

		seen.add(sourceUrlKey(url));
		normalized.push({
			title: normalizeSourceTitle(source?.title, url),
			url,
		});
	}

	return normalized;
}

function extractUrls(text) {
	return [...String(text ?? '').matchAll(/https?:\/\/[^\s<>"'()[\]{}]+/gi)]
		.map((match) => cleanUrl(match[0]))
		.filter(Boolean);
}

function cleanUrl(value) {
	const withoutTrailingPunctuation = String(value ?? '')
		.trim()
		.replace(/[.,;:!?]+$/g, '');

	try {
		const url = new URL(withoutTrailingPunctuation);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return '';
		}

		return url.toString();
	} catch {
		return '';
	}
}

function isSourceUrl(url, options = {}) {
	const parsed = new URL(url);
	const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
	const path = parsed.pathname.replace(/\/+$/, '');
	const videoId = String(options.videoId ?? '');
	const sourceUrl = cleanUrl(options.sourceUrl);

	if (sourceUrl && sourceUrlKey(url) === sourceUrlKey(sourceUrl)) {
		return false;
	}

	if (videoId && ((path === '/watch' && parsed.searchParams.get('v') === videoId) || path === `/shorts/${videoId}`)) {
		return false;
	}

	if (host === 'youtu.be' && path === `/${videoId}`) {
		return false;
	}

	const blockedHosts = new Set([
		'kw.media',
		'koytek-wattenberg.media',
		'instagram.com',
		'tiktok.com',
		'threads.net',
		'twitter.com',
		'x.com',
		'facebook.com',
		'linkedin.com',
		'discord.gg',
		'discord.com',
		'patreon.com',
		'paypal.me',
		'ko-fi.com',
		'bsky.app',
	]);

	if (blockedHosts.has(host)) {
		return false;
	}

	if (host === 'youtube.com' && (/^\/(?:@|channel\/|c\/|user\/|playlist\b)/.test(parsed.pathname) || parsed.searchParams.has('sub_confirmation'))) {
		return false;
	}

	return true;
}

function isSupportOrCommunityLine(line) {
	const text = String(line ?? '').toLowerCase();
	return /\b(ask|post|send|drop)\b.{0,40}\b(questions?|feedback|comments?)\b/.test(text)
		|| /\b(questions?|feedback|comments?)\b.{0,40}\b(forum|discord|community|comments?)\b/.test(text)
		|| /\b(join|follow|subscribe|contact|support)\b.{0,50}\b(discord|forum|community|newsletter|socials?|channel)\b/.test(text)
		|| /\bdiscord\.gg\b|\bdiscord\.com\b/.test(text);
}

function sourceUrlKey(url) {
	const parsed = new URL(url);
	parsed.hash = '';
	parsed.hostname = parsed.hostname.replace(/^www\./, '').toLowerCase();
	if (parsed.pathname !== '/') {
		parsed.pathname = parsed.pathname.replace(/\/+$/, '');
	}

	return parsed.toString();
}

function sourceTitle(url, line, previousLine) {
	const urlsRemoved = String(line ?? '')
		.replace(/https?:\/\/[^\s<>"'()[\]{}]+/gi, ' ')
		.replace(/^[\s\-*:|]+|[\s\-*:|]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const previous = String(previousLine ?? '')
		.replace(/^[\s\-*:|]+|[\s\-*:|]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	const contextualTitle = [urlsRemoved, previous].find((candidate) => (
		candidate
		&& candidate.length <= 90
		&& !/^sources?|quellen?|links?$/i.test(candidate)
		&& !/https?:\/\//i.test(candidate)
	));

	return normalizeSourceTitle(contextualTitle, url);
}

function normalizeSourceTitle(title, url) {
	const cleanTitle = String(title ?? '')
		.replace(/^source\s*:?\s*/i, '')
		.replace(/^quelle\s*:?\s*/i, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (cleanTitle) {
		return cleanTitle.slice(0, 100);
	}

	const parsed = new URL(url);
	return parsed.hostname.replace(/^www\./, '');
}

async function cleanupMarkdown(markdown, frontmatter, model) {
	const chunks = chunkMarkdown(markdown);
	const results = [];

	for (let index = 0; index < chunks.length; index += 1) {
		const prompt = cleanupPrompt(chunks[index], frontmatter, index + 1, chunks.length);
		results.push(await ollamaGenerate(model, prompt));
	}

	return results.join('\n\n').trim();
}

async function expandTranscriptMarkdown(post, model, options = {}) {
	const targetWords = Number(options.targetWords ?? transcriptExpansionTargetWords(post));
	const prompt = transcriptExpansionPrompt(post, targetWords);
	const expanded = removeDisallowedMarkdownLinks(normalizeAiOutput(await ollamaGenerate(model, prompt)), post);

	validateExpandedTranscript(expanded, post, { targetWords });

	return expanded;
}

async function translateMarkdown(markdown, frontmatter, targetLocale) {
	const chunks = chunkMarkdown(markdown);
	const results = [];

	for (let index = 0; index < chunks.length; index += 1) {
		const prompt = translateMarkdownPrompt(chunks[index], frontmatter, targetLocale, index + 1, chunks.length);
		results.push(await ollamaGenerate(translateModel, prompt));
	}

	return results.join('\n\n').trim();
}

async function translatePlainText(text, sourceLocale, targetLocale, label) {
	const prompt = `Translate this ${label} from ${languageName(sourceLocale)} to ${languageName(targetLocale)} for kw.media.

Rules:
- Return only the translated text.
- Preserve product names, platform names, creator names, and acronyms.
- Use creator-industry wording. In German, keep "Creator" as "Creator".
- Do not add quotes, notes, or alternatives.

Text:
${text}`;

	return ollamaGenerate(translateModel, prompt);
}

async function generateExcerptForPost(post, model) {
	const locale = post.frontmatter.locale;
	const maxLength = post.frontmatter.category === 'short-tutorial' ? 150 : 170;
	const prompt = `Write a concise metadata excerpt for this kw.media post.

Rules:
- Return only the excerpt text.
- Use ${languageName(locale)}.
- Write one natural sentence if possible.
- Keep it between 90 and ${maxLength} characters.
- Summarize what the reader or viewer learns.
- Preserve platform and product names such as YouTube, YouTube Studio, Shorts, Twitch, OBS, Audacity, Super Chat, and A/B testing.
- In German, keep "Creator" as "Creator" and use natural "du" wording if the post speaks directly to viewers.
- Do not add facts, quotes, markdown, labels, alternatives, or notes.

Post:
title: ${post.frontmatter.title}
category: ${post.frontmatter.category}
current excerpt: ${post.frontmatter.excerpt}

Content:
${postPlainText(post, 3600)}`;
	const excerpt = normalizeAiOutput(await ollamaGenerate(model, prompt))
		.replace(/^excerpt:\s*/i, '')
		.trim();

	return ensureValidExcerpt(excerpt, { locale, maxLength, model });
}

async function suggestPostMetadata(post, model) {
	const prompt = `Create metadata suggestions for this kw.media post.

Return only JSON with this exact shape:
{
  "title": "recommended title",
  "excerpt": "recommended meta excerpt",
  "summary": "one sentence editorial summary",
  "searchKeywords": ["keyword"],
  "topics": ["topic"],
  "audienceIntent": "what the reader wants to solve or understand",
  "qualityNotes": ["metadata or content issue to review"]
}

Rules:
- Use ${languageName(post.frontmatter.locale)} for title, excerpt, summary, audienceIntent, and qualityNotes.
- Keep the excerpt between 90 and 170 characters.
- Keep the title close to the existing title unless it is clearly broken.
- Preserve platform and product names such as YouTube, YouTube Studio, Shorts, Twitch, OBS, Audacity, Super Chat, and A/B testing.
- In German, keep "Creator" as "Creator".
- Do not invent facts or external context.
- Use 5 to 8 searchKeywords and 3 to 6 topics.

Current metadata:
title: ${post.frontmatter.title}
excerpt: ${post.frontmatter.excerpt}
locale: ${post.frontmatter.locale}
category: ${post.frontmatter.category}
path: ${post.frontmatter.path}

Content:
${postPlainText(post, 5200)}`;
	const suggestion = await ollamaGenerateJson(model, prompt);

	return normalizeMetadataSuggestion(suggestion, post, model);
}

async function generatePostCta(post, pageCandidates, model) {
	if (!pageCandidates.length) {
		throw new Error(`No CTA page candidates found for ${post.frontmatter.locale}`);
	}

	const candidateList = pageCandidates
		.map((candidate, index) => `${index + 1}. path: ${candidate.path}
title: ${candidate.title}
description: ${candidate.description}`)
		.join('\n\n');
	const prompt = `Create an understated end-of-post CTA paragraph for this kw.media post.

Return only JSON with this exact shape:
{
  "subject": "short post subject",
  "pagePath": "one candidate path",
  "text": "single paragraph with exactly one {page} placeholder"
}

Rules:
- Use ${languageName(post.frontmatter.locale)}.
- Select exactly one pagePath from the candidate pages.
- The text must read like a normal article paragraph, not an ad block.
- The text must include exactly one {page} placeholder where the relevant page link belongs.
- The text should follow this meaning: confused about the post subject, kw.media can help, check {page} for more info, or contact the expert below.
- Keep the whole text between 95 and 230 characters.
- Do not use Markdown, HTML, labels, quotes, bullets, emojis, or external facts.
- Preserve platform and product names such as YouTube, YouTube Studio, Shorts, Twitch, OBS, Audacity, Super Chat, and A/B testing.
- In German, keep "Creator" as "Creator" and use natural "du" wording.

Post:
title: ${post.frontmatter.title}
excerpt: ${post.frontmatter.excerpt}
locale: ${post.frontmatter.locale}
category: ${post.frontmatter.category}

Candidate pages:
${candidateList}

Content:
${postPlainText(post, 4200)}`;
	const suggestion = await ollamaGenerateJson(model, prompt);

	return normalizePostCtaSuggestion(suggestion, post, pageCandidates);
}

function normalizePostCtaSuggestion(value, post, pageCandidates) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`CTA suggestion for ${post.frontmatter.path} is not a JSON object`);
	}

	const selectedPath = stringField(value.pagePath, '');
	const selectedPage = pageCandidates.find((candidate) => candidate.path === selectedPath);
	if (!selectedPage) {
		throw new Error(`CTA suggestion for ${post.frontmatter.path} selected unknown pagePath: ${selectedPath}`);
	}

	const rawText = stringField(value.text, '');
	const text = normalizePostCtaText(rawText, post);

	return {
		text,
		pagePath: selectedPage.path,
		pageTitle: selectedPage.title,
	};
}

function normalizePostCtaText(text, post) {
	const locale = post.frontmatter.locale;
	let output = normalizeAiOutput(text)
		.replace(/\{(?:page|link|seite|relevant page|relevante seite)\}/gi, '{page}')
		.replace(/\[(?:page|link|seite|relevant page|relevante seite)\]/gi, '{page}')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();

	let placeholderCount = countMatches(output, /\{page\}/g);
	if (placeholderCount === 0) {
		output = locale === 'de'
			? `${output} Mehr Infos findest du auf {page}, oder kontaktiere unten unseren Experten.`
			: `${output} Check {page} for more info, or contact our expert below.`;
		placeholderCount = 1;
	}

	if (placeholderCount > 1) {
		let seenPlaceholder = false;
		output = output.replace(/\{page\}/g, () => {
			if (seenPlaceholder) {
				return locale === 'de' ? 'dieser Seite' : 'this page';
			}

			seenPlaceholder = true;
			return '{page}';
		});
	}

	if (!postCtaHasContactCue(output, locale)) {
		output = `${output.replace(/[.!?]+$/, '')}${locale === 'de' ? ', oder kontaktiere unten unseren Experten.' : ', or contact our expert below.'}`;
	}

	if (output.length > 260) {
		output = compactPostCtaText(output, post);
	}

	if (postCtaLooksWrongLanguage(output, locale)) {
		output = fallbackPostCtaText(post);
	}

	validatePostCtaText(output, locale);
	return output;
}

function compactPostCtaText(text, post) {
	const locale = post.frontmatter.locale;
	const subject = shortPostCtaSubject(post);
	const sentences = text.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
	const linkedSentence = sentences.find((sentence) => sentence.includes('{page}'));
	const questionSentence = sentences.find((sentence) => /\?$/.test(sentence) && !sentence.includes('{page}'));
	const sentenceCandidate = [questionSentence, linkedSentence]
		.filter(Boolean)
		.join(' ')
		.trim();

	if (
		sentenceCandidate
		&& sentenceCandidate.length >= 70
		&& sentenceCandidate.length <= 260
		&& postCtaHasContactCue(sentenceCandidate, locale)
	) {
		return sentenceCandidate;
	}

	return fallbackPostCtaText(post);
}

function fallbackPostCtaText(post) {
	const locale = post.frontmatter.locale;
	const subject = shortPostCtaSubject(post);

	return locale === 'de'
		? `Unsicher bei ${subject}? Wir helfen dir weiter: Mehr Infos findest du auf {page}, oder kontaktiere unten unseren Experten.`
		: `Confused about ${subject}? We can help. Check {page} for more info, or contact our expert below.`;
}

function postCtaHasContactCue(text, locale) {
	return locale === 'de'
		? /\b(kontaktier|kontaktiere|kontakt|experte|experten|ansprechpartner)\b/i.test(text)
		: /\b(contact|get in touch|expert|specialist)\b/i.test(text);
}

function postCtaLooksWrongLanguage(text, locale) {
	const textWithoutPlaceholder = text.replace('{page}', '');
	return locale === 'de' ? likelyEnglishText(textWithoutPlaceholder) : likelyGermanText(textWithoutPlaceholder);
}

function shortPostCtaSubject(post) {
	const title = String(post.frontmatter.title ?? '').replace(/\s+/g, ' ').trim();
	const withoutBrackets = title.replace(/\s*[\[(].*?[\])]\s*/g, ' ').replace(/\s+/g, ' ').trim();
	const subject = withoutBrackets || post.frontmatter.category || (post.frontmatter.locale === 'de' ? 'diesem Thema' : 'this topic');
	const maxLength = 72;

	if (subject.length <= maxLength) {
		return subject;
	}

	const truncated = subject.slice(0, maxLength).replace(/\s+\S*$/, '').replace(/[,:;.!?]+$/, '').trim();
	return truncated || subject.slice(0, maxLength).trim();
}

function validatePostCtaText(text, locale) {
	const placeholderCount = countMatches(text, /\{page\}/g);
	if (placeholderCount !== 1) {
		throw new Error(`Generated CTA must contain exactly one {page} placeholder: ${text}`);
	}

	if (text.length < 70 || text.length > 260) {
		throw new Error(`Generated CTA has invalid length (${text.length}): ${text}`);
	}

	if (/\n|```|^\s*["“]|["”]\s*$|return only|for kw.media|as an ai|<[^>]+>|\[[^\]]+]\([^)]+\)/i.test(text)) {
		throw new Error(`Generated CTA contains notes, quotes, markdown, HTML, or prompt leakage: ${text}`);
	}

	if (locale === 'en' && likelyGermanText(text.replace('{page}', ''))) {
		throw new Error(`Generated English CTA looks German: ${text}`);
	}

	if (locale === 'de' && likelyEnglishText(text.replace('{page}', ''))) {
		throw new Error(`Generated German CTA looks English: ${text}`);
	}
}

function readPostCtaPageCandidates(locale) {
	const pageDirectory = join(process.cwd(), 'src/data/pages');
	const preferredPages = [
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
	];
	const preferredPageSet = new Set(preferredPages);
	const candidates = readdirSync(pageDirectory)
		.filter((fileName) => fileName.endsWith('.json'))
		.flatMap((fileName) => {
			const source = JSON.parse(readFileSync(join(pageDirectory, fileName), 'utf8'));
			if (!preferredPageSet.has(source.id)) {
				return [];
			}

			const translation = source.translations?.[locale];
			if (!translation?.path || !translation?.title) {
				return [];
			}

			return [{
				id: source.id,
				path: translation.path,
				title: translation.title,
				description: pageDescription(translation),
			}];
		});

	if (locale === 'de') {
		candidates.push({
			id: 'tools',
			path: '/de/tools/',
			title: 'Tools',
			description: 'Clientseitige Creator-Tools von Koytek Wattenberg Media.',
		});
	} else {
		candidates.push({
			id: 'tools',
			path: '/en/tools/',
			title: 'Tools',
			description: 'Client-side creator tools by Koytek Wattenberg Media.',
		});
	}

	return candidates
		.filter((candidate, index, all) => all.findIndex((item) => item.path === candidate.path) === index)
		.sort((first, second) => preferredPages.indexOf(first.id) - preferredPages.indexOf(second.id));
}

function pageDescription(page) {
	const parts = [
		page.description,
		...pageBlockText(page.blocks ?? []),
	];

	return parts
		.filter(Boolean)
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 700);
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

function cleanupPrompt(markdown, frontmatter, index, total) {
	const language = languageName(frontmatter.locale);
	const contentKind = frontmatter.category === 'blog' ? 'article' : 'transcript';
	const chunkNote = total > 1 ? `\nThis is chunk ${index} of ${total}; clean only this chunk.` : '';

	return `Clean up this ${language} ${contentKind} markdown for publication on kw.media.${chunkNote}

Rules:
- Keep the original language.
- Do not translate, summarize, expand, or add facts.
- Preserve Markdown structure, headings, links, lists, HTML, and embedded URLs.
- Fix punctuation, capitalization, paragraph flow, obvious speech-to-text errors, duplicated words, and grammar.
- Preserve the speaker's casual creator-news voice for transcripts.
- Preserve product/platform names such as YouTube, YouTube Studio, YouTube Live, Shorts, Twitch, OBS, Audacity, Community Posts, Fan Communities, Creator Support, Super Chat, and A/B testing.
- In German, keep "Creator" as "Creator"; do not replace it with "Schöpfer" or "Kreativkraft".
- Return only the cleaned markdown, no notes.

Markdown:
${markdown}`;
}

function transcriptExpansionPrompt(post, targetWords) {
	const locale = post.frontmatter.locale;
	const sourceList = transcriptSourceList(post);
	const temporalRule = post.frontmatter.category === 'news-video'
		? '- This is creator-news content. Treat dated rollout/status details as true for the publication date, not necessarily current today.'
		: '- If the transcript contains dated rollout/status details, phrase them as tied to the original publication context instead of timeless facts.';

	return `Turn this transcript-style Markdown into a fuller editorial article body for kw.media.

Return only Markdown for the article body. Do not include frontmatter or an H1.

Post context:
title: ${post.frontmatter.title}
excerpt: ${post.frontmatter.excerpt}
date: ${post.frontmatter.date}
locale: ${locale}
category: ${post.frontmatter.category}
tags: ${Array.isArray(post.frontmatter.tags) ? post.frontmatter.tags.join(', ') : ''}

Allowed source material:
${sourceList}

Rules:
- Use ${languageName(locale)}.
- Keep the article grounded in the transcript and allowed source material only.
- Do not invent dates, statistics, feature availability, policy details, named sources, quotes, or examples that are not clearly supported.
${temporalRule}
- Expand by adding useful context, definitions, consequences, caveats, practical steps, and reader-oriented explanations that are directly implied by the transcript.
- Preserve the existing Markdown links and their targets when the linked topic remains relevant.
- Do not add new links, new external sources, videos, images, embeds, tables, or footnotes.
- Do not keep a separate raw "Transkript" or "Transcript" section; this output replaces the transcript with a readable article.
- Start with a level-2 heading. Use level-2 and level-3 headings to make the article scannable.
- For German, keep "Creator" as "Creator" and use natural "du" wording when addressing the reader.
- Preserve product/platform names such as YouTube, YouTube Studio, YouTube Live, Shorts, Twitch, OBS, Audacity, Community Posts, Fan Communities, Creator Support, Super Chat, and A/B testing.
- Aim for roughly ${targetWords} words, but do not pad or repeat yourself.
- Return only the finished Markdown, no notes.

Transcript Markdown:
${post.body}`;
}

function transcriptSourceList(post) {
	const sources = [
		post.frontmatter.sourceUrl ? { title: 'Original video', url: post.frontmatter.sourceUrl } : undefined,
		...(Array.isArray(post.frontmatter.sources) ? post.frontmatter.sources : []),
	].filter(Boolean);

	if (!sources.length) {
		return '- No external sources are listed. Use only the transcript text.';
	}

	return sources
		.map((source) => `- ${source.title}: ${source.url}`)
		.join('\n');
}

function translateMarkdownPrompt(markdown, frontmatter, targetLocale, index, total) {
	const sourceLocale = frontmatter.locale;
	const chunkNote = total > 1 ? `\nThis is chunk ${index} of ${total}; translate only this chunk.` : '';

	return `Translate this markdown from ${languageName(sourceLocale)} to ${languageName(targetLocale)} for kw.media.${chunkNote}

Rules:
- Return only the translated markdown.
- Preserve Markdown structure, headings, links, lists, HTML tags, embedded URLs, and code exactly where possible.
- Preserve product/platform names such as YouTube, YouTube Studio, YouTube Live, Shorts, Twitch, OBS, Audacity, Community Posts, Fan Communities, Creator Support, Super Chat, and A/B testing.
- Preserve creator names, company names, and acronyms.
- Use creator-industry wording. In German, keep "Creator" as "Creator"; do not translate it as "Schöpfer" or "Kreativkraft".
- Keep the tone natural for a kw.media ${frontmatter.category === 'blog' ? 'article' : 'video transcript'}.
- Do not summarize, add facts, or add translator notes.

Markdown:
${markdown}`;
}

async function ollamaGenerate(model, prompt) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${ollamaUrl}/api/generate`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			signal: controller.signal,
			body: JSON.stringify({
				model,
				prompt,
				stream: false,
				options: {
					temperature: 0.1,
					num_ctx: 8192,
				},
			}),
		});

		if (!response.ok) {
			throw new Error(`Ollama ${model} request failed: HTTP ${response.status}`);
		}

		const data = await response.json();
		if (!data.response) {
			throw new Error(`Ollama ${model} returned no response`);
		}

		return normalizeAiOutput(data.response);
	} finally {
		clearTimeout(timeout);
	}
}

async function ollamaGenerateJson(model, prompt) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${ollamaUrl}/api/generate`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			signal: controller.signal,
			body: JSON.stringify({
				model,
				prompt,
				stream: false,
				format: 'json',
				options: {
					temperature: 0.1,
					num_ctx: 8192,
				},
			}),
		});

		if (!response.ok) {
			throw new Error(`Ollama ${model} JSON request failed: HTTP ${response.status}`);
		}

		const data = await response.json();
		if (!data.response) {
			throw new Error(`Ollama ${model} returned no JSON response`);
		}

		return parseJsonResponse(data.response);
	} finally {
		clearTimeout(timeout);
	}
}

function normalizeAiOutput(text) {
	let output = text.trim();
	const fence = output.match(/^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i);
	if (fence) {
		output = fence[1].trim();
	}

	if ((output.startsWith('"') && output.endsWith('"')) || (output.startsWith('“') && output.endsWith('”'))) {
		output = output.slice(1, -1).trim();
	}

	return output.replace(/\r\n/g, '\n').trim();
}

function parseJsonResponse(text) {
	const output = normalizeAiOutput(String(text ?? ''));

	try {
		return JSON.parse(output);
	} catch {
		const match = output.match(/\{[\s\S]*\}/);
		if (match) {
			return JSON.parse(match[0]);
		}
	}

	throw new Error('Ollama returned invalid JSON');
}

async function normalizeMetadataSuggestion(value, post, model) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error(`Metadata suggestion for ${post.frontmatter.path} is not a JSON object`);
	}

	const title = stringField(value.title, post.frontmatter.title);
	const rawExcerpt = stringField(value.excerpt, excerptFromBody(post.body, post.frontmatter.locale));
	const excerpt = await ensureValidExcerpt(rawExcerpt, {
		locale: post.frontmatter.locale,
		maxLength: 170,
		model,
	});
	const summary = stringField(value.summary, '');
	const audienceIntent = stringField(value.audienceIntent, '');
	const searchKeywords = stringArrayField(value.searchKeywords).slice(0, 8);
	const topics = stringArrayField(value.topics).slice(0, 6);
	const qualityNotes = stringArrayField(value.qualityNotes).slice(0, 8);

	return {
		title,
		excerpt,
		summary,
		searchKeywords,
		topics,
		audienceIntent,
		qualityNotes,
	};
}

function stringField(value, fallback) {
	return typeof value === 'string' && value.trim() ? normalizeAiOutput(value) : fallback;
}

function stringArrayField(value) {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.map((item) => (typeof item === 'string' ? normalizeAiOutput(item) : ''))
		.filter(Boolean);
}

async function ensureValidExcerpt(excerpt, { locale, maxLength, model, attempts = 2 }) {
	let current = normalizeAiOutput(excerpt)
		.replace(/^excerpt:\s*/i, '')
		.trim();

	for (let attempt = 0; attempt <= attempts; attempt += 1) {
		try {
			validateGeneratedExcerpt(current, locale, maxLength);
			return current;
		} catch (error) {
			if (!isTooLongExcerptError(error)) {
				throw error;
			}

			if (attempt === attempts) {
				current = trimExcerptToMaxLength(current, maxLength);
				validateGeneratedExcerpt(current, locale, maxLength);
				return current;
			}

			current = await shortenExcerpt(current, { locale, maxLength, model });
		}
	}

	return current;
}

async function shortenExcerpt(excerpt, { locale, maxLength, model }) {
	const targetLength = Math.max(45, maxLength - 15);
	const prompt = `Shorten this ${languageName(locale)} metadata excerpt for kw.media.

Rules:
- Return only the shortened excerpt text.
- Aim for ${targetLength} characters or fewer, and never exceed ${maxLength} characters.
- The current excerpt is ${excerpt.length} characters long.
- Keep the meaning and do not add facts.
- Preserve product names, platform names, creator names, and acronyms.
- No markdown, labels, alternatives, quotes, or notes.

Excerpt:
${excerpt}`;

	return normalizeAiOutput(await ollamaGenerate(model, prompt))
		.replace(/^excerpt:\s*/i, '')
		.trim();
}

function trimExcerptToMaxLength(excerpt, maxLength) {
	if (excerpt.length <= maxLength) {
		return excerpt;
	}

	const withoutFinalPunctuation = excerpt.replace(/[.!?]+$/, '').trimEnd();
	if (withoutFinalPunctuation.length <= maxLength) {
		return withoutFinalPunctuation;
	}

	const sentencePrefix = excerpt
		.match(/[^.!?]+[.!?]?/g)
		?.map((sentence) => sentence.trim())
		.filter(Boolean)
		.reduce((best, sentence) => {
			const candidate = best ? `${best} ${sentence}` : sentence;
			return candidate.length <= maxLength ? candidate : best;
		}, '');

	if (sentencePrefix && sentencePrefix.length >= 45) {
		return sentencePrefix.replace(/[.!?]+$/, '').trimEnd();
	}

	const truncated = excerpt.slice(0, maxLength).trimEnd();
	const lastSpace = truncated.lastIndexOf(' ');
	let shortened = lastSpace > 45 ? truncated.slice(0, lastSpace) : truncated;
	shortened = shortened.replace(
		/\s+(a|an|and|as|at|bei|das|der|die|for|für|in|mit|of|oder|on|the|to|um|und|von|with|zu)$/i,
		'',
	);

	return shortened.replace(/[,:;.!?]+$/, '').trimEnd();
}

function isTooLongExcerptError(error) {
	return error instanceof Error && /^Generated excerpt is too long/.test(error.message);
}

function validateGeneratedExcerpt(excerpt, locale, maxLength) {
	if (!excerpt || excerpt.length < 45) {
		throw new Error(`Generated excerpt is too short: ${excerpt}`);
	}

	if (excerpt.length > maxLength) {
		throw new Error(`Generated excerpt is too long (${excerpt.length}/${maxLength}): ${excerpt}`);
	}

	if (/\n|```|^\s*["“]|["”]\s*$|translated text|return only|for kw.media|as an ai/i.test(excerpt)) {
		throw new Error(`Generated excerpt contains notes, quotes, or prompt leakage: ${excerpt}`);
	}

	if (locale === 'en' && likelyGermanText(excerpt)) {
		throw new Error(`Generated English excerpt looks German: ${excerpt}`);
	}

	if (locale === 'de' && likelyEnglishText(excerpt)) {
		throw new Error(`Generated German excerpt looks English: ${excerpt}`);
	}
}

function validateExpandedTranscript(markdown, post, { targetWords }) {
	const output = normalizeAiOutput(markdown);
	const words = markdownWordCount(output);
	const originalWords = markdownWordCount(post.body);
	const minimumWords = Math.max(
		180,
		Math.round(originalWords * 0.85),
		originalWords < targetWords ? Math.round(Math.min(targetWords * 0.65, originalWords + 180)) : 0,
	);

	if (!output || output.length < 200) {
		throw new Error(`Expanded transcript is too short for ${post.frontmatter.path}`);
	}

	if (words < minimumWords) {
		throw new Error(`Expanded transcript is too short (${words}/${minimumWords} words) for ${post.frontmatter.path}`);
	}

	if (/^---\s*$/m.test(output) || /^#\s+/m.test(output)) {
		throw new Error(`Expanded transcript contains frontmatter or an H1 for ${post.frontmatter.path}`);
	}

	if (!/^##\s+\S+/m.test(output)) {
		throw new Error(`Expanded transcript has no level-2 heading for ${post.frontmatter.path}`);
	}

	if (/```|as an ai|als ki|return only|allowed source material|transcript markdown|finished markdown/i.test(output)) {
		throw new Error(`Expanded transcript contains prompt leakage for ${post.frontmatter.path}`);
	}

	if (post.frontmatter.locale === 'en' && likelyGermanText(output)) {
		throw new Error(`Expanded English transcript looks German for ${post.frontmatter.path}`);
	}

	if (post.frontmatter.locale === 'de' && likelyEnglishText(output)) {
		throw new Error(`Expanded German transcript looks English for ${post.frontmatter.path}`);
	}

	const allowedTargets = allowedMarkdownLinkTargets(post);
	const newTargets = markdownLinkTargets(output).filter((target) => !allowedTargets.has(target));

	if (newTargets.length) {
		throw new Error(`Expanded transcript added new link targets for ${post.frontmatter.path}: ${newTargets.join(', ')}`);
	}
}

function isTranscriptLikePost(post) {
	return Boolean(post.frontmatter.video)
		|| ['video-tutorial', 'news-video', 'short-tutorial'].includes(post.frontmatter.category)
		|| /^\s*##\s+(transkript|transcript)\b/im.test(post.body);
}

function transcriptExpansionTargetWords(post) {
	const words = markdownWordCount(post.body);

	if (post.frontmatter.category === 'short-tutorial') {
		return Math.min(750, Math.max(450, Math.round(words * 2.2)));
	}

	if (post.frontmatter.category === 'news-video') {
		return Math.min(1400, Math.max(850, Math.round(words * 1.7)));
	}

	return Math.min(1300, Math.max(800, Math.round(words * 1.8)));
}

function markdownLinkTargets(markdown) {
	return [...String(markdown ?? '').matchAll(/!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)]
		.map((match) => match[1])
		.filter(Boolean);
}

function allowedMarkdownLinkTargets(post) {
	return new Set([
		...markdownLinkTargets(post.body),
		post.frontmatter.sourceUrl,
		...(Array.isArray(post.frontmatter.sources) ? post.frontmatter.sources.map((source) => source.url) : []),
	].filter(Boolean));
}

function removeDisallowedMarkdownLinks(markdown, post) {
	const allowedTargets = allowedMarkdownLinkTargets(post);

	return String(markdown ?? '').replace(/(!?)\[([^\]]+)]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g, (match, imagePrefix, label, target) => {
		if (allowedTargets.has(target)) {
			return match;
		}

		return imagePrefix ? label : label;
	});
}

function extractMarkedPart(markdown, startMarker, endMarker) {
	const source = String(markdown ?? '');
	const start = source.indexOf(startMarker);
	const end = source.indexOf(endMarker);

	if (start < 0 || end < 0 || end <= start) {
		return undefined;
	}

	return source.slice(start + startMarker.length, end).trim();
}

function postPlainText(post, maxLength = 4000) {
	return plainTextFromMarkdown(post.body).slice(0, maxLength);
}

function plainTextFromMarkdown(markdown) {
	return String(markdown ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/^#+\s+.*$/gm, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/[`*_>#-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function likelyGermanText(text) {
	const germanHits = countMatches(text, /\b(und|oder|nicht|dass|dein|deine|deinen|euer|eure|fur|für|uber|über|mit|ist|sind|wird|werden|kann|konnen|können|zuschauer|untertitel)\b|[äöüß]/gi);
	const englishHits = countMatches(text, /\b(the|and|with|your|you|this|that|for|from|can|will|should|viewers|subtitles)\b/gi);
	return germanHits >= 3 && germanHits > englishHits * 1.5;
}

function likelyEnglishText(text) {
	const germanHits = countMatches(text, /\b(und|oder|nicht|dass|dein|deine|deinen|euer|eure|fur|für|uber|über|mit|ist|sind|wird|werden|kann|konnen|können|zuschauer|untertitel)\b|[äöüß]/gi);
	const englishHits = countMatches(text, /\b(the|and|with|your|you|this|that|for|from|can|will|should|viewers|subtitles)\b/gi);
	return englishHits >= 5 && englishHits > germanHits * 2;
}

function countMatches(text, pattern) {
	return (String(text ?? '').match(pattern) ?? []).length;
}

function chunkMarkdown(markdown) {
	if (markdown.length <= chunkSize) {
		return [markdown.trim()];
	}

	const blocks = markdown.split(/\n{2,}/);
	const chunks = [];
	let current = '';

	for (const block of blocks) {
		if (!current) {
			current = block;
			continue;
		}

		if (`${current}\n\n${block}`.length > chunkSize) {
			chunks.push(current.trim());
			current = block;
		} else {
			current = `${current}\n\n${block}`;
		}
	}

	if (current.trim()) {
		chunks.push(current.trim());
	}

	return chunks;
}

export function excerptFromBody(body, locale) {
	const text = body
		.replace(/^#+\s+.*$/gm, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/[`*_>#-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
	const summary = sentences.slice(0, 2).join(' ') || text;

	if (summary.length <= 220) {
		return summary;
	}

	const suffix = locale === 'de' ? '...' : '...';
	return `${summary.slice(0, 217).replace(/\s+\S*$/, '')}${suffix}`;
}

function otherLocale(locale) {
	if (locale === 'de') {
		return 'en';
	}

	if (locale === 'en') {
		return 'de';
	}

	throw new Error(`Unsupported locale: ${locale}`);
}

function languageName(locale) {
	return locale === 'de' ? 'German' : 'English';
}

function slugify(input, locale) {
	const ampersand = locale === 'de' ? ' und ' : ' and ';

	return input
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ß/g, 'ss')
		.replace(/&/g, ampersand)
		.replace(/['’]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
}

function uniqueSlug(baseSlug, slugs) {
	let slug = baseSlug || 'translated-post';
	let counter = 2;

	while (slugs.has(slug) || postFileExists(slug)) {
		slug = `${baseSlug}-${counter}`;
		counter += 1;
	}

	slugs.add(slug);
	return slug;
}

function existingSlugs(posts) {
	return new Set(posts.map((post) => post.frontmatter.slug ?? basename(post.filePath, '.md')));
}

function postFileExists(slug) {
	return Object.values(postDirectories).some((directories) => (
		Object.values(directories).some((directory) => existsSync(join(directory, `${slug}.md`)))
	));
}

function maxPostId(posts) {
	return Math.max(0, ...posts.map((post) => Number(post.frontmatter.id ?? 0)));
}

function translationGroupKey(frontmatter) {
	return frontmatter.translationKey
		?? (frontmatter.video?.youtubeId ? `video:${frontmatter.video.youtubeId}` : undefined)
		?? `post:${frontmatter.id}`;
}

function translationKeyFor(frontmatter) {
	if (frontmatter.translationKey) {
		return frontmatter.translationKey;
	}

	if (frontmatter.video?.youtubeId) {
		return `video:${frontmatter.video.youtubeId}`;
	}

	return `post:${frontmatter.id}`;
}

function hasKnownTranslation(path, sourceLocale, targetLocale) {
	const sourceContentPath = join(process.cwd(), 'src/lib/source-content.ts');
	if (!existsSync(sourceContentPath)) {
		return false;
	}

	const source = readFileSync(sourceContentPath, 'utf8');
	for (const match of source.matchAll(/\{([\s\S]*?)\}/g)) {
		const block = match[1];
		const de = block.match(/de:\s*'([^']+)'/)?.[1];
		const en = block.match(/en:\s*'([^']+)'/)?.[1];

		if (!de || !en) {
			continue;
		}

		if ((sourceLocale === 'de' ? de : en) === path && (targetLocale === 'de' ? de : en)) {
			return true;
		}
	}

	return false;
}
