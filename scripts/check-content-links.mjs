import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { readAllPosts } from './content-ai.mjs';

const siteOrigin = 'https://kw.media';
const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const jsonOutput = args.includes('--json');
const noFail = args.includes('--no-fail');
const noExternal = args.includes('--no-external') || args.includes('--local-only');
const includeOk = args.includes('--include-ok');
const strictExternal = args.includes('--strict-external');
const concurrency = Number(argumentValue('--concurrency') ?? 8);
const timeoutMs = Number(argumentValue('--timeout') ?? 10000);
const maxIssues = Number(argumentValue('--max-issues') ?? 100);

if (help) {
	console.log(`Usage:
node scripts/check-content-links.mjs [--json] [--no-fail] [--no-external] [--include-ok]

Checks image references and links in posts and page JSON.

Options:
--no-external      Only check local assets and generated site routes.
--strict-external  Treat every external HTTP 4xx/5xx as an error, not just 404/410.
--timeout=10000    Timeout per external URL in milliseconds.
--concurrency=8    Number of external URLs to check at once.
--max-issues=100   Maximum text-report issues to print. Use 0 for no limit.
--include-ok       Include passing checks in JSON output.`);
	process.exit(0);
}

const posts = readAllPosts();
const knownRoutes = collectKnownRoutes(posts);
const references = collectReferences(posts);
const checks = [];

for (const reference of references) {
	const check = checkLocalReference(reference, knownRoutes);
	if (check) {
		checks.push(check);
	}
}

if (!noExternal) {
	const externalReferences = references.filter((reference) => classifyUrl(reference.url, reference.basePath).kind === 'external');
	checks.push(...await checkExternalReferences(externalReferences));
}

const errorCount = checks.filter((check) => check.severity === 'error').length;
const warningCount = checks.filter((check) => check.severity === 'warn').length;
const okCount = checks.filter((check) => check.severity === 'ok').length;
const report = {
	referenceCount: references.length,
	checkedReferences: checks.length,
	errorCount,
	warningCount,
	okCount,
	issues: includeOk ? checks : checks.filter((check) => check.severity !== 'ok'),
};

if (jsonOutput) {
	console.log(JSON.stringify(report, null, '\t'));
} else {
	printTextReport(report);
}

if (!noFail && errorCount > 0) {
	process.exitCode = 1;
}

function collectReferences(allPosts) {
	const postReferences = allPosts.flatMap((post) => referencesFromPost(post));
	const pageReferences = allPageJsonFiles().flatMap((filePath) => referencesFromPageJson(filePath));

	return dedupeReferences([...postReferences, ...pageReferences]);
}

function referencesFromPost(post) {
	const raw = readFileSync(post.filePath, 'utf8');
	const references = [];

	if (post.frontmatter.image) {
		references.push(reference(post.filePath, lineNumber(raw, String(post.frontmatter.image)), 'image', post.frontmatter.image, 'frontmatter image', post.frontmatter.path));
	}

	if (post.frontmatter.video?.thumbnailUrl) {
		references.push(reference(post.filePath, lineNumber(raw, String(post.frontmatter.video.thumbnailUrl)), 'image', post.frontmatter.video.thumbnailUrl, 'video thumbnailUrl', post.frontmatter.path));
	}

	if (post.frontmatter.video?.embedUrl) {
		references.push(reference(post.filePath, lineNumber(raw, String(post.frontmatter.video.embedUrl)), 'embed', post.frontmatter.video.embedUrl, 'video embedUrl', post.frontmatter.path));
	}

	for (const match of raw.matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
		references.push(reference(post.filePath, lineNumberAt(raw, match.index), 'image', match[1], 'markdown image', post.frontmatter.path));
	}

	for (const match of raw.matchAll(/(^|[^!])\[[^\]]+]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
		references.push(reference(post.filePath, lineNumberAt(raw, match.index), 'link', match[2], 'markdown link', post.frontmatter.path));
	}

	for (const match of raw.matchAll(/<([A-Za-z][A-Za-z0-9:-]*)\b[^>]*>/g)) {
		const tag = match[0];
		const tagName = match[1].toLowerCase();
		const attr = tag.match(/\b(?:src|href)=["']([^"']+)["']/i);
		if (!attr) {
			continue;
		}

		const kind = tagName === 'img' || tagName === 'source' ? 'image' : tagName === 'iframe' ? 'embed' : 'link';
		references.push(reference(post.filePath, lineNumberAt(raw, match.index), kind, attr[1], `html ${tagName}`, post.frontmatter.path));
	}

	return references;
}

function referencesFromPageJson(filePath) {
	const raw = readFileSync(filePath, 'utf8');
	const data = JSON.parse(raw);
	const references = [];

	walkJson(data, (key, value) => {
		if (typeof value !== 'string') {
			return;
		}

		if (key === 'image') {
			references.push(reference(filePath, lineNumber(raw, value), 'image', value, 'page image', '/'));
		}

		if (key === 'href' || key === 'moreHref') {
			references.push(reference(filePath, lineNumber(raw, value), 'link', value, 'page link', '/'));
		}
	});

	return references;
}

function walkJson(value, visitor, key = '') {
	if (Array.isArray(value)) {
		for (const item of value) {
			walkJson(item, visitor, key);
		}
		return;
	}

	if (value && typeof value === 'object') {
		for (const [childKey, childValue] of Object.entries(value)) {
			visitor(childKey, childValue);
			walkJson(childValue, visitor, childKey);
		}
	}
}

function collectKnownRoutes(allPosts) {
	const routes = new Set(['/']);

	for (const post of allPosts) {
		routes.add(normalizeRoute(post.frontmatter.path));
	}

	for (const filePath of allPageJsonFiles()) {
		const page = JSON.parse(readFileSync(filePath, 'utf8'));
		for (const translation of Object.values(page.translations ?? {})) {
			if (translation.path) {
				routes.add(normalizeRoute(translation.path));
			}
		}
	}

	return routes;
}

function allPageJsonFiles(directory = join(process.cwd(), 'src/data/pages')) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.map((entry) => join(directory, entry.name));
}

function checkLocalReference(referenceItem, routes) {
	const classified = classifyUrl(referenceItem.url, referenceItem.basePath);

	if (classified.kind === 'skip') {
		return ok(referenceItem, 'skipped');
	}

	if (classified.kind === 'external') {
		return undefined;
	}

	if (classified.kind === 'asset') {
		const publicPath = join(process.cwd(), 'public', decodeURIComponent(classified.path.slice(1)));
		if (existsSync(publicPath)) {
			return ok(referenceItem, 'local asset found');
		}

		return issue(referenceItem, 'error', 'missing-asset', `Missing local asset: ${classified.path}`);
	}

	if (classified.kind === 'route') {
		const route = normalizeRoute(classified.path);
		if (routes.has(route)) {
			return ok(referenceItem, 'internal route found');
		}

		return issue(referenceItem, 'error', 'missing-route', `Unknown internal route: ${classified.path}`);
	}

	return issue(referenceItem, 'warn', 'unknown-url', `Could not classify URL: ${referenceItem.url}`);
}

async function checkExternalReferences(referenceItems) {
	const byUrl = new Map();
	for (const referenceItem of referenceItems) {
		const normalized = normalizeExternalUrl(referenceItem.url);
		byUrl.set(normalized, [...(byUrl.get(normalized) ?? []), referenceItem]);
	}

	const checks = [];
	const entries = [...byUrl.entries()];
	let cursor = 0;

	async function worker() {
		while (cursor < entries.length) {
			const [url, referencesForUrl] = entries[cursor];
			cursor += 1;
			const result = await fetchExternal(url);
			for (const referenceItem of referencesForUrl) {
				checks.push(externalResult(referenceItem, result));
			}
		}
	}

	await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()));
	return checks;
}

async function fetchExternal(url) {
	const head = await fetchWithTimeout(url, { method: 'HEAD', redirect: 'follow' });

	if (head.status && ![405, 403].includes(head.status)) {
		return head;
	}

	const get = await fetchWithTimeout(url, { method: 'GET', redirect: 'follow' });
	if (get.status) {
		return get;
	}

	return head;
}

async function fetchWithTimeout(url, options) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			...options,
			signal: controller.signal,
			headers: {
				'user-agent': 'kw.media content link checker',
			},
		});

		return {
			ok: response.ok,
			status: response.status,
			statusText: response.statusText,
			finalUrl: response.url,
		};
	} catch (error) {
		return {
			ok: false,
			error: error.name === 'AbortError' ? `Timed out after ${timeoutMs}ms` : error.message,
		};
	} finally {
		clearTimeout(timeout);
	}
}

function externalResult(referenceItem, result) {
	if (result.status === 404 || result.status === 410) {
		return issue(referenceItem, 'error', 'external-404', `External URL returned ${result.status}: ${referenceItem.url}`);
	}

	if (strictExternal && result.status >= 400) {
		return issue(referenceItem, 'error', 'external-http', `External URL returned ${result.status}: ${referenceItem.url}`);
	}

	if (result.status >= 400) {
		return issue(referenceItem, 'warn', 'external-http', `External URL returned ${result.status}: ${referenceItem.url}`);
	}

	if (result.error) {
		return issue(referenceItem, 'warn', 'external-network', `External URL could not be checked: ${referenceItem.url} (${result.error})`);
	}

	return ok(referenceItem, `external URL returned ${result.status}`);
}

function classifyUrl(rawUrl, basePath = '/') {
	const cleanUrl = stripWrapping(rawUrl);

	if (!cleanUrl || /^(#|mailto:|tel:|javascript:|data:)/i.test(cleanUrl)) {
		return { kind: 'skip' };
	}

	if (/^\/\//.test(cleanUrl)) {
		return { kind: 'external', url: `https:${cleanUrl}` };
	}

	if (/^https?:\/\//i.test(cleanUrl)) {
		try {
			const parsed = new URL(cleanUrl);
			if (parsed.origin === siteOrigin) {
				return classifyInternalPath(`${parsed.pathname}${parsed.search}`, basePath);
			}
		} catch {
			return { kind: 'unknown' };
		}

		return { kind: 'external', url: cleanUrl };
	}

	return classifyInternalPath(cleanUrl, basePath);
}

function classifyInternalPath(rawUrl, basePath) {
	const parsed = new URL(rawUrl, new URL(basePath, siteOrigin));
	const path = decodeURIComponent(parsed.pathname);
	const extension = extname(path);

	if (extension || path.startsWith('/assets/') || path.startsWith('/logo/')) {
		return { kind: 'asset', path };
	}

	return { kind: 'route', path };
}

function normalizeExternalUrl(rawUrl) {
	const classified = classifyUrl(rawUrl);
	return classified.url ?? stripWrapping(rawUrl);
}

function normalizeRoute(path) {
	if (!path.startsWith('/')) {
		path = `/${path}`;
	}

	return path.endsWith('/') ? path : `${path}/`;
}

function reference(filePath, line, kind, url, context, basePath) {
	return {
		filePath,
		line,
		kind,
		url: stripWrapping(url),
		context,
		basePath,
	};
}

function dedupeReferences(referenceItems) {
	const seen = new Set();
	const deduped = [];

	for (const item of referenceItems) {
		const key = `${item.filePath}:${item.line}:${item.kind}:${item.url}`;
		if (!seen.has(key)) {
			seen.add(key);
			deduped.push(item);
		}
	}

	return deduped;
}

function issue(referenceItem, severity, code, message) {
	return {
		severity,
		code,
		filePath: relative(process.cwd(), referenceItem.filePath),
		line: referenceItem.line,
		kind: referenceItem.kind,
		context: referenceItem.context,
		url: referenceItem.url,
		message,
	};
}

function ok(referenceItem, message) {
	return issue(referenceItem, 'ok', 'ok', message);
}

function printTextReport(report) {
	const problems = report.issues.filter((item) => item.severity !== 'ok');
	const shownProblems = maxIssues > 0 ? problems.slice(0, maxIssues) : problems;

	console.log(`Checked ${report.checkedReferences} of ${report.referenceCount} content reference(s): ${report.errorCount} error(s), ${report.warningCount} warning(s).`);

	if (!problems.length) {
		console.log('No broken content references found.');
		return;
	}

	for (const item of shownProblems) {
		console.log(`${item.severity.toUpperCase()} ${item.code} ${item.filePath}:${item.line}`);
		console.log(`  ${item.message}`);
		console.log(`  ${item.context}: ${item.url}`);
	}

	if (shownProblems.length < problems.length) {
		console.log(`...and ${problems.length - shownProblems.length} more issue(s). Use --max-issues=0 or --json for the full report.`);
	}
}

function stripWrapping(value) {
	return String(value ?? '')
		.trim()
		.replace(/^<|>$/g, '')
		.replace(/&amp;/g, '&');
}

function lineNumber(raw, value) {
	const index = raw.indexOf(value);
	return index === -1 ? 1 : lineNumberAt(raw, index);
}

function lineNumberAt(raw, index = 0) {
	return raw.slice(0, Math.max(0, index)).split(/\r?\n/).length;
}

function argumentValue(name) {
	const prefix = `${name}=`;
	const index = args.indexOf(name);
	if (index !== -1) {
		return args[index + 1];
	}

	return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
