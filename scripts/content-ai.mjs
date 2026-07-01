import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const postsDir = join(process.cwd(), 'src/data/posts');

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

export async function translatePostFile(filePath, options = {}) {
	const source = readPostFile(filePath);
	if (source.frontmatter.category === 'audacity') {
		return {
			sourcePath: filePath,
			skipped: true,
			reason: 'audacity posts are not translated into the YouTube tips archive',
		};
	}

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
	const targetKind = source.frontmatter.video ? 'video' : 'blog';
	const targetPath = `${routePrefixes[targetLocale]}/${translatedSlug}/`;
	const targetFilePath = join(postDirectories[targetKind][targetLocale], `${translatedSlug}.md`);
	const nextId = maxPostId(allPosts) + 1;

	const targetFrontmatter = {
		...source.frontmatter,
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

function parseFrontmatter(raw) {
	const data = {};
	let section;

	for (const line of raw.split(/\r?\n/)) {
		if (!line.trim()) {
			continue;
		}

		const nestedMatch = line.match(/^  ([A-Za-z0-9_]+):\s*(.*)$/);
		if (nestedMatch && section) {
			data[section][nestedMatch[1]] = parseValue(nestedMatch[2]);
			continue;
		}

		const sectionMatch = line.match(/^([A-Za-z0-9_]+):\s*$/);
		if (sectionMatch) {
			section = sectionMatch[1];
			data[section] = {};
			continue;
		}

		const match = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
		if (match) {
			section = undefined;
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
			.map((item) => Number(item));
	}

	if (/^\d+$/.test(value)) {
		return Number(value);
	}

	return value;
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

	lines.push('---');
	return lines.join('\n');
}

function quote(value) {
	return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
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
	const prompt = `Translate this ${label} from ${languageName(sourceLocale)} to ${languageName(targetLocale)} for KW Media.

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
	const prompt = `Write a concise metadata excerpt for this KW Media post.

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
	const prompt = `Create metadata suggestions for this KW Media post.

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

function cleanupPrompt(markdown, frontmatter, index, total) {
	const language = languageName(frontmatter.locale);
	const contentKind = frontmatter.category === 'blog' ? 'article' : 'transcript';
	const chunkNote = total > 1 ? `\nThis is chunk ${index} of ${total}; clean only this chunk.` : '';

	return `Clean up this ${language} ${contentKind} markdown for publication on KW Media.${chunkNote}

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

function translateMarkdownPrompt(markdown, frontmatter, targetLocale, index, total) {
	const sourceLocale = frontmatter.locale;
	const chunkNote = total > 1 ? `\nThis is chunk ${index} of ${total}; translate only this chunk.` : '';

	return `Translate this markdown from ${languageName(sourceLocale)} to ${languageName(targetLocale)} for KW Media.${chunkNote}

Rules:
- Return only the translated markdown.
- Preserve Markdown structure, headings, links, lists, HTML tags, embedded URLs, and code exactly where possible.
- Preserve product/platform names such as YouTube, YouTube Studio, YouTube Live, Shorts, Twitch, OBS, Audacity, Community Posts, Fan Communities, Creator Support, Super Chat, and A/B testing.
- Preserve creator names, company names, and acronyms.
- Use creator-industry wording. In German, keep "Creator" as "Creator"; do not translate it as "Schöpfer" or "Kreativkraft".
- Keep the tone natural for a KW Media ${frontmatter.category === 'blog' ? 'article' : 'video transcript'}.
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
	const prompt = `Shorten this ${languageName(locale)} metadata excerpt for KW Media.

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

	if (/\n|```|^\s*["“]|["”]\s*$|translated text|return only|for KW Media|as an ai/i.test(excerpt)) {
		throw new Error(`Generated excerpt contains notes, quotes, or prompt leakage: ${excerpt}`);
	}

	if (locale === 'en' && likelyGermanText(excerpt)) {
		throw new Error(`Generated English excerpt looks German: ${excerpt}`);
	}

	if (locale === 'de' && likelyEnglishText(excerpt)) {
		throw new Error(`Generated German excerpt looks English: ${excerpt}`);
	}
}

function postPlainText(post, maxLength = 4000) {
	const text = post.body
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/^#+\s+.*$/gm, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/[`*_>#-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();

	return text.slice(0, maxLength);
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
