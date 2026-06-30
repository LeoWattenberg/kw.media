import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readAllPosts } from './content-ai.mjs';

const ollamaUrl = process.env.OLLAMA_URL ?? process.env.OLLAMA_TRANSLATE_URL ?? 'http://172.20.208.1:11434';
const embeddingModel = process.env.OLLAMA_RELATED_EMBED_MODEL ?? 'nomic-embed-text-v2-moe:latest';
const rerankModel = process.env.OLLAMA_RELATED_RERANK_MODEL ?? 'gemma4:31b';
const relatedCount = Number(process.env.RELATED_POST_COUNT ?? 3);
const candidateCount = Number(process.env.RELATED_POST_CANDIDATES ?? 10);
const minScore = Number(process.env.RELATED_POST_MIN_SCORE ?? 0.45);
const timeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 300000);
const shouldRerank = !process.argv.includes('--no-rerank') && process.env.RELATED_POST_RERANK !== '0';
const dryRun = process.argv.includes('--dry-run');
const limit = Number(argumentValue('--limit') ?? process.env.RELATED_POST_LIMIT ?? 0);
const outputPath = join(process.cwd(), 'src/data/related-posts.json');
const cachePath = join(process.cwd(), '.cache', `related-post-embeddings-${slugify(embeddingModel)}.json`);

if (limit > 0 && !dryRun) {
	throw new Error('Use --limit only with --dry-run so the generated related-posts.json is not partial.');
}

const posts = readAllPosts();
const selectedPosts = limit > 0 ? posts.slice(0, limit) : posts;
const cache = readCache();
const embeddings = new Map();

console.log(`Embedding model: ${embeddingModel}`);
console.log(`Rerank model: ${shouldRerank ? rerankModel : 'disabled'}`);
console.log(`Posts: ${selectedPosts.length}${limit ? ` of ${posts.length}` : ''}`);

for (const post of posts) {
	embeddings.set(post.frontmatter.path, await embeddingForPost(post));
}

writeCache(cache);

const relatedPosts = {};

for (const [index, post] of selectedPosts.entries()) {
	const candidates = posts
		.filter((candidate) => candidate.frontmatter.path !== post.frontmatter.path)
		.filter((candidate) => candidate.frontmatter.locale === post.frontmatter.locale)
		.map((candidate) => ({
			post: candidate,
			score: cosine(embeddings.get(post.frontmatter.path), embeddings.get(candidate.frontmatter.path)),
		}))
		.filter((candidate) => candidate.score >= minScore)
		.sort((a, b) => b.score - a.score)
		.slice(0, candidateCount);

	let selectedPaths = shouldRerank
		? await rerankCandidates(post, candidates)
		: [];

	selectedPaths = completeSelection(selectedPaths, candidates);

	if (selectedPaths.length) {
		relatedPosts[post.frontmatter.path] = selectedPaths;
	}

	console.log(`${index + 1}/${selectedPosts.length} ${post.frontmatter.path} -> ${selectedPaths.join(', ')}`);
}

if (dryRun) {
	console.log(JSON.stringify(relatedPosts, null, '\t'));
} else {
	writeJson(outputPath, relatedPosts);
	console.log(`Wrote ${outputPath}`);
}

async function embeddingForPost(post) {
	const text = postSummary(post);
	const hash = createHash('sha256').update(`${embeddingModel}\n${text}`).digest('hex');
	const path = post.frontmatter.path;
	const cached = cache.posts[path];

	if (cached?.hash === hash && Array.isArray(cached.embedding)) {
		return cached.embedding;
	}

	const response = await ollamaJson('/api/embed', {
		model: embeddingModel,
		input: text,
		truncate: true,
	});
	const embedding = response.embeddings?.[0];

	if (!Array.isArray(embedding)) {
		throw new Error(`No embedding returned by ${embeddingModel} for ${path}`);
	}

	cache.posts[path] = { hash, embedding };
	return embedding;
}

async function rerankCandidates(post, candidates) {
	if (!candidates.length) {
		return [];
	}

	const validPaths = new Set(candidates.map((candidate) => candidate.post.frontmatter.path));
	const candidateText = candidates.map((candidate, index) => (
		`${index + 1}. path: ${candidate.post.frontmatter.path}
title: ${candidate.post.frontmatter.title}
excerpt: ${candidate.post.frontmatter.excerpt}
category: ${candidate.post.frontmatter.category}`
	)).join('\n\n');
	const prompt = `Select the ${relatedCount} most relevant KW Media posts for internal related-post links.

Current post:
path: ${post.frontmatter.path}
title: ${post.frontmatter.title}
excerpt: ${post.frontmatter.excerpt}
category: ${post.frontmatter.category}

Candidate posts:
${candidateText}

Rules:
- Return only JSON.
- The JSON must be an array of exactly ${relatedCount} path strings.
- Use only candidate path values exactly as shown.
- Prefer posts that help the reader continue the same topic or solve the next likely problem.
- Do not include the current post.
- Do not explain your choices.`;

	try {
		const response = await ollamaJson('/api/generate', {
			model: rerankModel,
			prompt,
			stream: false,
			format: 'json',
			options: {
				temperature: 0,
				num_ctx: 8192,
			},
		});

		return uniquePaths(parsePathArray(response.response))
			.filter((path) => validPaths.has(path))
			.slice(0, relatedCount);
	} catch (error) {
		console.warn(`Rerank failed for ${post.frontmatter.path}: ${error.message}`);
		return [];
	}
}

function completeSelection(selectedPaths, candidates) {
	const paths = uniquePaths(selectedPaths);

	for (const candidate of candidates) {
		if (paths.length >= relatedCount) {
			break;
		}

		if (!paths.includes(candidate.post.frontmatter.path)) {
			paths.push(candidate.post.frontmatter.path);
		}
	}

	return paths.slice(0, relatedCount);
}

function parsePathArray(text) {
	const trimmed = String(text ?? '').trim();

	try {
		return collectPathStrings(JSON.parse(trimmed));
	} catch {
		const match = trimmed.match(/\[[\s\S]*\]/);
		if (match) {
			try {
				return collectPathStrings(JSON.parse(match[0]));
			} catch {
				// Fall through to regex extraction.
			}
		}
	}

	return [...trimmed.matchAll(/\/youtube-[^"\s]+\/(?=["\s,}\]])/g)].map((match) => match[0]);
}

function collectPathStrings(value) {
	if (typeof value === 'string') {
		return value.startsWith('/youtube-') ? [value] : [];
	}

	if (Array.isArray(value)) {
		return value.flatMap((item) => collectPathStrings(item));
	}

	if (value && typeof value === 'object') {
		return Object.values(value).flatMap((item) => collectPathStrings(item));
	}

	return [];
}

async function ollamaJson(path, body) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(`${ollamaUrl}${path}`, {
			method: body ? 'POST' : 'GET',
			headers: body ? { 'content-type': 'application/json' } : undefined,
			signal: controller.signal,
			body: body ? JSON.stringify(body) : undefined,
		});

		if (!response.ok) {
			throw new Error(`Ollama ${path} failed with HTTP ${response.status}: ${await response.text()}`);
		}

		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function postSummary(post) {
	const headings = [...post.body.matchAll(/^#{2,3}\s+(.+)$/gm)].map((match) => match[1]).slice(0, 12).join('\n');
	const plainBody = post.body
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!\[[^\]]*]\([^)]+\)/g, ' ')
		.replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
		.replace(/<[^>]+>/g, ' ')
		.replace(/[`*_>#-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 1800);

	return [
		`Title: ${post.frontmatter.title}`,
		`Excerpt: ${post.frontmatter.excerpt}`,
		headings && `Headings:\n${headings}`,
		`Body: ${plainBody}`,
	].filter(Boolean).join('\n\n');
}

function cosine(a, b) {
	let dot = 0;
	let aMagnitude = 0;
	let bMagnitude = 0;

	for (let index = 0; index < a.length; index += 1) {
		dot += a[index] * b[index];
		aMagnitude += a[index] * a[index];
		bMagnitude += b[index] * b[index];
	}

	return dot / (Math.sqrt(aMagnitude) * Math.sqrt(bMagnitude));
}

function readCache() {
	if (!existsSync(cachePath)) {
		return { posts: {} };
	}

	return JSON.parse(readFileSync(cachePath, 'utf8'));
}

function writeCache(data) {
	writeJson(cachePath, data);
}

function writeJson(filePath, data) {
	mkdirSync(dirname(filePath), { recursive: true });
	writeFileSync(filePath, `${JSON.stringify(data, null, '\t')}\n`);
}

function uniquePaths(paths) {
	return [...new Set(paths)];
}

function argumentValue(name) {
	const prefix = `${name}=`;
	return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function slugify(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
