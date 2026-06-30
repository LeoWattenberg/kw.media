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
};

const routePrefixes = {
	de: '/youtube-tipps-de',
	en: '/youtube-tips-en',
};

const categoryIdsByLocale = {
	de: [17],
	en: [18],
};

const cleanupModels = {
	fast: process.env.OLLAMA_CLEANUP_FAST_MODEL ?? process.env.OLLAMA_CLEANUP_MODEL ?? 'aya-expanse:32b',
	deep: process.env.OLLAMA_CLEANUP_DEEP_MODEL ?? process.env.OLLAMA_CLEANUP_MODEL ?? 'gemma4:31b',
};

const ollamaUrl = process.env.OLLAMA_URL ?? process.env.OLLAMA_TRANSLATE_URL ?? 'http://172.20.208.1:11434';
const translateModel = process.env.OLLAMA_TRANSLATE_MODEL ?? 'aya-expanse:32b';
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
	frontmatter.postType = getPostType(frontmatter);

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

export function getPostType(frontmatter) {
	if (frontmatter.postType) {
		return frontmatter.postType;
	}

	if (!frontmatter.video) {
		return 'blog';
	}

	if (frontmatter.video.watchUrl?.includes('/shorts/')) {
		return 'short-tutorial';
	}

	return 'video-tutorial';
}

export function cleanupModelForPostType(postType) {
	return postType === 'short-tutorial' || postType === 'news-video'
		? cleanupModels.fast
		: cleanupModels.deep;
}

export async function cleanupPostFile(filePath, options = {}) {
	const post = readPostFile(filePath);
	const model = options.model ?? cleanupModelForPostType(post.frontmatter.postType);
	const cleanedBody = await cleanupMarkdown(post.body, post.frontmatter, model);
	const frontmatter = {
		...post.frontmatter,
		excerpt: excerptFromBody(cleanedBody, post.frontmatter.locale),
	};

	writePostFile(filePath, frontmatter, cleanedBody);

	return {
		filePath,
		model,
		postType: post.frontmatter.postType,
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
		categoryIds: categoryIdsByLocale[targetLocale],
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

	lines.push(`categoryIds: [${data.categoryIds.join(', ')}]`);

	if (data.postType && data.postType !== 'blog') {
		lines.push(`postType: ${quote(data.postType)}`);
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

function cleanupPrompt(markdown, frontmatter, index, total) {
	const language = languageName(frontmatter.locale);
	const contentKind = frontmatter.postType === 'blog' ? 'article' : 'transcript';
	const chunkNote = total > 1 ? `\nThis is chunk ${index} of ${total}; clean only this chunk.` : '';

	return `Clean up this ${language} ${contentKind} markdown for publication on KW Media.${chunkNote}

Rules:
- Keep the original language.
- Do not translate, summarize, expand, or add facts.
- Preserve Markdown structure, headings, links, lists, HTML, and embedded URLs.
- Fix punctuation, capitalization, paragraph flow, obvious speech-to-text errors, duplicated words, and grammar.
- Preserve the speaker's casual creator-news voice for transcripts.
- Preserve product/platform names such as YouTube, YouTube Studio, YouTube Live, Shorts, Twitch, Community Posts, Fan Communities, Creator Support, Super Chat, and A/B testing.
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
- Preserve product/platform names such as YouTube, YouTube Studio, YouTube Live, Shorts, Twitch, Community Posts, Fan Communities, Creator Support, Super Chat, and A/B testing.
- Preserve creator names, company names, and acronyms.
- Use creator-industry wording. In German, keep "Creator" as "Creator"; do not translate it as "Schöpfer" or "Kreativkraft".
- Keep the tone natural for a KW Media ${frontmatter.postType === 'blog' ? 'article' : 'video transcript'}.
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

function excerptFromBody(body, locale) {
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
