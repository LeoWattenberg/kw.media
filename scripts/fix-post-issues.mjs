import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import {
	allPostFiles,
	applyPostMetadataFile,
	generateExcerptForPostFile,
	readAllPosts,
	readPostFile,
	repairTranslationPostFile,
	writePostFile,
} from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const write = args.includes('--write');
const all = args.includes('--all');
const weakOnly = args.includes('--weak') || args.includes('--only-weak') || (!all && !positionalArgs().length);
const commonFixes = args.includes('--common') || args.includes('--all-fixes');
const deterministic = commonFixes || args.includes('--deterministic');
const routeFixes = deterministic || args.includes('--links') || args.includes('--routes');
const excerpts = commonFixes || args.includes('--excerpts');
const metadata = args.includes('--metadata') || args.includes('--all-fixes');
const translations = commonFixes || args.includes('--translations');
const limit = Number(argumentValue('--limit') ?? 0);
const model = argumentValue('--model');
const dryRun = !write;
const siteOrigin = 'https://kw.media';
const manualInternalRouteFixes = new Map([
	[
		'/youtube-tips-de/der-audio-guide-zum-glück-oder-wie-man-seine-streams-und-videos-gut-klingen-lässt/',
		'/youtube-tipps-de/der-audio-guide-zum-glucklichsein-oder-wie-du-deine-streams-und-videos-gut-klingen-lasst/',
	],
	[
		'/youtube-tips-de/der-fuck-copyright-guide-wie-man-dinge-in-seinen-videos-legal-verwendet-die-andere-gemacht-haben/',
		'/youtube-tipps-de/wie-du-musik-und-videos-legal-verwendest/',
	],
	[
		'/youtube-tipps-de/lasst-uns-über-geld-auf-youtube-und-sponsoring-für-youtube-kanäle-reden/',
		'/youtube-tipps-de/lass-uns-uber-geld-und-sponsorships-reden/',
	],
	[
		'/youtube-tipps/wie-man-seine-youtube-miniaturansichten-nicht-ruiniert/',
		'/youtube-tipps-de/wie-man-seine-miniaturansichten-auf-youtube-nicht-vermasselt-ein-tutorial/',
	],
	[
		'/youtube-tipps/wie-du-mehr-klicks-auf-dein-youtube-vorschau-bild-bekommst-das-aida-modell/',
		'/youtube-tipps-de/wie-man-klicks-auf-youtube-miniaturansichten-bekommt-das-aida-modell/',
	],
]);

if (help || (!deterministic && !routeFixes && !excerpts && !metadata && !translations)) {
	console.log(`Usage:
node scripts/fix-post-issues.mjs [--write] [--all|--weak] [--common|--all-fixes]
node scripts/fix-post-issues.mjs [--write] [--deterministic] [--links] [--excerpts] [--metadata] [--translations] [post.md ...]

Default target selection is --weak when no post paths are provided.
Without --write this runs in dry-run mode.

Fix modes:
- --deterministic  Safe casing, known speech cleanup, known internal-link fixes, missing headings.
- --links          Fix broken internal links/routes that match known site routes.
- --excerpts       Regenerate weak excerpts with local Ollama.
- --metadata       Apply local-Ollama title and excerpt suggestions.
- --translations   Retranslate posts whose content appears to be in the wrong locale.
- --common         deterministic + excerpts + translations.
- --all-fixes      deterministic + excerpts + metadata + translations.`);
	process.exit(help ? 0 : 1);
}

const routeIndex = buildRouteIndex();
const files = selectFiles();
const selectedFiles = limit > 0 ? files.slice(0, limit) : files;

console.log(`${dryRun ? 'Dry run' : 'Writing fixes'} for ${selectedFiles.length} post(s).`);

const results = [];

for (const [index, filePath] of selectedFiles.entries()) {
	const label = relative(process.cwd(), filePath);
	const post = readPostFile(filePath);
	const result = {
		filePath,
		actions: [],
	};

	console.log(`${index + 1}/${selectedFiles.length} ${label}`);

	if (deterministic || routeFixes) {
		const deterministicResult = fixDeterministic(post, {
			dryRun,
			text: deterministic,
			headings: deterministic,
			routes: routeFixes,
		});
		if (deterministicResult.changed) {
			result.actions.push(...deterministicResult.actions);
			console.log(`  ${deterministic ? 'deterministic' : 'links'}: ${deterministicResult.actions.join(', ')}`);
		}
	}

	const latestPost = readPostFile(filePath);
	const shouldRepairTranslation = translations && likelyWrongLanguage(latestPost);
	if (shouldRepairTranslation) {
		const translationResult = await repairTranslationPostFile(filePath, { dryRun });
		result.actions.push('translation');
		console.log(`  translation: ${relative(process.cwd(), translationResult.sourcePath)} -> ${label}`);
	}

	if (!shouldRepairTranslation && metadata && hasMetadataIssue(readPostFile(filePath))) {
		const metadataResult = await applyPostMetadataFile(filePath, { dryRun, model });
		if (metadataResult.changed) {
			result.actions.push('metadata');
			console.log(`  title: ${metadataResult.oldTitle} -> ${metadataResult.title}`);
			console.log(`  excerpt: ${metadataResult.oldExcerpt} -> ${metadataResult.excerpt}`);
		}
	}

	if (!shouldRepairTranslation && !metadata && excerpts && hasWeakExcerpt(readPostFile(filePath))) {
		const excerptResult = await generateExcerptForPostFile(filePath, { dryRun, model });
		if (excerptResult.changed) {
			result.actions.push('excerpt');
			console.log(`  excerpt: ${excerptResult.oldExcerpt} -> ${excerptResult.excerpt}`);
		}
	}

	if (!result.actions.length) {
		console.log('  no fixable issue selected');
	}

	results.push(result);
}

const changed = results.filter((result) => result.actions.length).length;
console.log(`${dryRun ? 'Would change' : 'Changed'} ${changed} of ${selectedFiles.length} post(s).`);

function selectFiles() {
	const passedFiles = positionalArgs();
	const candidates = passedFiles.length ? passedFiles : allPostFiles();

	if (!weakOnly) {
		return candidates;
	}

	return candidates.filter((filePath) => hasSelectedFixableIssue(readPostFile(filePath)));
}

function positionalArgs() {
	return args.filter((argument) => !argument.startsWith('-'));
}

function fixDeterministic(post, options = {}) {
	const originalBody = post.body;
	const originalFrontmatter = post.frontmatter;
	const frontmatter = { ...originalFrontmatter };
	let body = originalBody;
	const actions = [];

	if (options.text) {
		frontmatter.title = fixText(originalFrontmatter.title);
		frontmatter.excerpt = fixText(originalFrontmatter.excerpt);
		body = fixText(body);
	}

	if (options.routes) {
		const routeResult = fixInternalLinks(body, post);
		body = routeResult.body;
		if (routeResult.changed) {
			actions.push('internal links');
			for (const fix of routeResult.fixes) {
				console.log(`  link: ${fix.from} -> ${fix.to}`);
			}
		}
	}

	if (options.text && (frontmatter.title !== originalFrontmatter.title || frontmatter.excerpt !== originalFrontmatter.excerpt || body !== originalBody)) {
		actions.push('text');
	}

	if (options.headings && !/^##\s+/m.test(body)) {
		body = `${defaultHeading(post)}\n\n${body.trim()}`;
		actions.push('heading');
	}

	const changed = frontmatter.title !== originalFrontmatter.title
		|| frontmatter.excerpt !== originalFrontmatter.excerpt
		|| body !== originalBody;

	if (changed && !options.dryRun) {
		writePostFile(post.filePath, frontmatter, body);
	}

	return { changed, actions: [...new Set(actions)] };
}

function fixText(text) {
	return String(text ?? '')
		.replace(/\bYoutube\b/g, 'YouTube')
		.replace(/\bobs\b/g, 'OBS')
		.replace(/\bSuperchat\b/g, 'Super Chat')
		.replace(/\bFusionsimpressionen\b/gi, 'Impressionen')
		.replace(/\bubs-einstellungen\b/gi, 'OBS-Einstellungen')
		.replace(/\b(Schopfer|Schöpfer|Kreativkraft)\b/gi, 'Creator');
}

function fixInternalLinks(text, post) {
	const fixes = [];
	let output = text;

	for (const rawUrl of extractInternalRouteUrls(text)) {
		const fixedUrl = suggestedInternalUrl(rawUrl, post);
		if (!fixedUrl || fixedUrl === rawUrl) {
			continue;
		}

		output = output.split(rawUrl).join(fixedUrl);
		fixes.push({ from: rawUrl, to: fixedUrl });
	}

	return {
		body: output,
		changed: output !== text,
		fixes,
	};
}

function extractInternalRouteUrls(text) {
	const urls = [];

	for (const match of String(text ?? '').matchAll(/!?\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g)) {
		urls.push(match[1]);
	}

	for (const match of String(text ?? '').matchAll(/<([A-Za-z][A-Za-z0-9:-]*)\b[^>]*>/g)) {
		const attr = match[0].match(/\b(?:src|href)=["']([^"']+)["']/i);
		if (attr) {
			urls.push(attr[1]);
		}
	}

	return [...new Set(urls.filter((url) => parseInternalRouteUrl(url)))];
}

function suggestedInternalUrl(rawUrl, post) {
	const parsed = parseInternalRouteUrl(rawUrl, post.frontmatter.path);
	if (!parsed) {
		return undefined;
	}

	const currentRoute = normalizeRoute(parsed.path);
	if (routeIndex.routes.has(currentRoute)) {
		return undefined;
	}

	const fixedPath = suggestedInternalPath(parsed.path, post);
	if (!fixedPath || normalizeRoute(fixedPath) === currentRoute) {
		return undefined;
	}

	return formatInternalUrl(rawUrl, parsed, fixedPath);
}

function suggestedInternalPath(path, post) {
	const normalizedPath = normalizeRoute(path);
	const manualFix = manualInternalRouteFixes.get(normalizedPath);
	if (manualFix && routeIndex.routes.has(normalizeRoute(manualFix))) {
		return manualFix;
	}

	const locale = localeForPath(path) ?? post.frontmatter.locale;
	const rootSlug = path.match(/^\/([^/]+)\/?$/)?.[1];
	if (rootSlug) {
		const localePage = `/${locale}/${rootSlug}/`;
		if (routeIndex.routes.has(localePage)) {
			return localePage;
		}
	}

	const prefixedPath = localePrefixedPath(path, locale);
	if (prefixedPath && routeIndex.routes.has(normalizeRoute(prefixedPath))) {
		return prefixedPath;
	}

	const comparableRoute = routeIndex.byComparablePath.get(comparablePath(prefixedPath ?? path));
	if (comparableRoute) {
		return comparableRoute.path;
	}

	const bestRoute = bestSlugRoute(prefixedPath ?? path, locale);
	return bestRoute?.path;
}

function localePrefixedPath(path, locale) {
	if (path.startsWith('/youtube-tipps/')) {
		return `/youtube-tipps-de/${path.slice('/youtube-tipps/'.length)}`;
	}

	if (path.startsWith('/youtube-tips/')) {
		return `/youtube-tips-en/${path.slice('/youtube-tips/'.length)}`;
	}

	if (locale === 'de' && path.startsWith('/youtube-tips-de/')) {
		return `/youtube-tipps-de/${path.slice('/youtube-tips-de/'.length)}`;
	}

	return undefined;
}

function bestSlugRoute(path, locale) {
	const slug = slugFromPath(path);
	if (!slug) {
		return undefined;
	}

	const normalizedSlug = comparableSlug(slug);
	const candidates = routeIndex.routeList.filter((route) => !locale || route.locale === locale);
	const scored = candidates
		.map((route) => ({
			route,
			score: routeMatchScore(normalizedSlug, route.comparableSlug),
		}))
		.sort((a, b) => b.score - a.score);

	const [best, second] = scored;
	if (!best || best.score < 0.82 || (second && best.score - second.score < 0.08)) {
		return undefined;
	}

	return best.route;
}

function routeMatchScore(a, b) {
	const editScore = 1 - (levenshtein(a, b) / Math.max(a.length, b.length, 1));
	const aTokens = new Set(a.split('-').filter(Boolean));
	const bTokens = new Set(b.split('-').filter(Boolean));
	const sharedTokens = [...aTokens].filter((token) => bTokens.has(token)).length;
	const tokenScore = sharedTokens / Math.max(new Set([...aTokens, ...bTokens]).size, 1);

	return Math.max(editScore, tokenScore);
}

function parseInternalRouteUrl(rawUrl, basePath = '/') {
	const cleanUrl = stripWrapping(rawUrl);
	if (!cleanUrl || /^(#|mailto:|tel:|javascript:|data:)/i.test(cleanUrl)) {
		return undefined;
	}

	if (/^\/\//.test(cleanUrl)) {
		return undefined;
	}

	let parsed;
	try {
		parsed = new URL(cleanUrl, new URL(basePath ?? '/', siteOrigin));
	} catch {
		return undefined;
	}

	if (/^https?:\/\//i.test(cleanUrl) && parsed.origin !== siteOrigin) {
		return undefined;
	}

	const path = decodeURIComponent(parsed.pathname);
	if (extname(path) || path.startsWith('/assets/') || path.startsWith('/logo/')) {
		return undefined;
	}

	return {
		path,
		suffix: `${parsed.search}${parsed.hash}`,
		absolute: /^https?:\/\//i.test(cleanUrl),
		origin: parsed.origin,
	};
}

function formatInternalUrl(rawUrl, parsed, fixedPath) {
	const cleanUrl = stripWrapping(rawUrl);
	const suffix = parsed.suffix ?? '';
	const fixedUrl = `${normalizeRoute(fixedPath)}${suffix}`;

	if (parsed.absolute || /^https?:\/\//i.test(cleanUrl)) {
		return `${parsed.origin}${fixedUrl}`;
	}

	return fixedUrl;
}

function buildRouteIndex() {
	const routeList = [];

	for (const post of readAllPosts()) {
		if (post.frontmatter.path) {
			routeList.push(routeRecord(post.frontmatter.path, post.frontmatter.locale));
		}
	}

	for (const filePath of allPageJsonFiles()) {
		const page = JSON.parse(readFileSync(filePath, 'utf8'));
		for (const [locale, translation] of Object.entries(page.translations ?? {})) {
			if (translation.path) {
				routeList.push(routeRecord(translation.path, locale));
			}
		}
	}

	const routes = new Set(routeList.map((route) => route.path));
	const byComparablePath = new Map();

	for (const route of routeList) {
		const comparable = comparablePath(route.path);
		if (!byComparablePath.has(comparable)) {
			byComparablePath.set(comparable, route);
		}
	}

	return { routes, routeList, byComparablePath };
}

function routeRecord(path, locale) {
	const routePath = normalizeRoute(path);

	return {
		path: routePath,
		locale,
		slug: slugFromPath(routePath),
		comparableSlug: comparableSlug(slugFromPath(routePath)),
	};
}

function allPageJsonFiles(directory = join(process.cwd(), 'src/data/pages')) {
	return readdirSync(directory, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.map((entry) => join(directory, entry.name));
}

function localeForPath(path) {
	if (path.startsWith('/youtube-tipps') || path.startsWith('/de/')) {
		return 'de';
	}

	if (path.startsWith('/youtube-tips') || path.startsWith('/blog/') || path.startsWith('/en/')) {
		return 'en';
	}

	return undefined;
}

function slugFromPath(path) {
	return normalizeRoute(path).replace(/\/$/, '').split('/').pop() ?? '';
}

function normalizeRoute(path) {
	if (!path.startsWith('/')) {
		path = `/${path}`;
	}

	return path.endsWith('/') ? path : `${path}/`;
}

function comparablePath(path) {
	return normalizeRoute(path)
		.split('/')
		.map((part) => comparableSlug(part))
		.join('/');
}

function comparableSlug(slug = '') {
	return String(slug)
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ä/g, 'a')
		.replace(/ö/g, 'o')
		.replace(/ü/g, 'u')
		.replace(/ß/g, 'ss')
		.replace(/fuer/g, 'fur')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

function levenshtein(a, b) {
	const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

	for (let i = 1; i <= a.length; i += 1) {
		let diagonal = previous[0];
		previous[0] = i;

		for (let j = 1; j <= b.length; j += 1) {
			const oldDiagonal = previous[j];
			previous[j] = Math.min(
				previous[j] + 1,
				previous[j - 1] + 1,
				diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			diagonal = oldDiagonal;
		}
	}

	return previous[b.length];
}

function stripWrapping(value) {
	return String(value ?? '')
		.trim()
		.replace(/^<|>$/g, '')
		.replace(/&amp;/g, '&');
}

function defaultHeading(post) {
	if (post.frontmatter.video) {
		return post.frontmatter.locale === 'de' ? '## Transkript' : '## Transcript';
	}

	return post.frontmatter.locale === 'de' ? '## Überblick' : '## Overview';
}

function hasSelectedFixableIssue(post) {
	return (deterministic && hasDeterministicIssue(post))
		|| (routeFixes && hasRouteLinkIssue(post))
		|| (metadata && hasMetadataIssue(post))
		|| (excerpts && hasWeakExcerpt(post))
		|| (translations && likelyWrongLanguage(post));
}

function hasDeterministicIssue(post) {
	const sample = `${post.frontmatter.title}\n${post.frontmatter.excerpt}\n${post.body}`;

	return fixText(sample) !== sample
		|| hasRouteLinkIssue(post)
		|| !/^##\s+/m.test(post.body);
}

function hasRouteLinkIssue(post) {
	return fixInternalLinks(post.body, post).changed;
}

function hasMetadataIssue(post) {
	const title = String(post.frontmatter.title ?? '');

	return hasWeakExcerpt(post)
		|| title.length > 100
		|| looksAllCaps(title);
}

function hasWeakExcerpt(post) {
	const excerpt = String(post.frontmatter.excerpt ?? '');

	return !excerpt
		|| excerpt.length < 70
		|| excerpt.length > 220
		|| excerpt.endsWith('...')
		|| /\n|^\s*["“]|translated text|return only|for KW Media|as an ai|```/i.test(excerpt)
		|| (post.frontmatter.locale === 'en' && likelyGermanText(excerpt))
		|| (post.frontmatter.locale === 'de' && likelyEnglishText(excerpt));
}

function likelyWrongLanguage(post) {
	const sample = `${post.frontmatter.title}\n${post.frontmatter.excerpt}\n${post.body.slice(0, 2400)}`;
	const score = languageScore(sample);

	return (post.frontmatter.locale === 'en' && score.german > score.english * 1.5 && score.german > 10)
		|| (post.frontmatter.locale === 'de' && score.english > score.german * 1.8 && score.english > 12);
}

function looksAllCaps(title = '') {
	const letters = title.replace(/[^A-Za-zÄÖÜäöüß]/g, '');
	return letters.length > 8 && letters === letters.toLocaleUpperCase('de-DE');
}

function likelyGermanText(text) {
	const score = languageScore(text);
	return score.german >= 3 && score.german > score.english * 1.5;
}

function likelyEnglishText(text) {
	const score = languageScore(text);
	return score.english >= 5 && score.english > score.german * 2;
}

function languageScore(text) {
	return {
		german: countMatches(text, /\b(und|oder|nicht|dass|dein|deine|deinen|euer|eure|fur|für|uber|über|mit|ist|sind|wird|werden|kann|konnen|können|zuschauer|untertitel)\b|[äöüß]/gi),
		english: countMatches(text, /\b(the|and|with|your|you|this|that|for|from|can|will|should|viewers|subtitles|watch|learn)\b/gi),
	};
}

function countMatches(text, pattern) {
	return (String(text ?? '').match(pattern) ?? []).length;
}

function argumentValue(name) {
	const prefix = `${name}=`;
	return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
