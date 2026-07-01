import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readAllPosts, readPostFile, suggestPostMetadataFile } from './content-ai.mjs';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const noFail = args.includes('--no-fail');
const useAi = args.includes('--ai');
const summaryOnly = args.includes('--summary');
const help = args.includes('--help') || args.includes('-h');
const aiLimit = Number(argumentValue('--ai-limit') ?? 20);
const filePaths = args.filter((argument) => !argument.startsWith('-'));

if (help) {
	console.log(`Usage:
node scripts/audit-posts.mjs [--json] [--summary] [--no-fail] [--ai] [--ai-limit=20] [post.md ...]

Audits post frontmatter, language consistency, excerpts, brand casing, internal links,
and generated related-post data. Add --ai to ask Ollama for metadata suggestions for
posts with excerpt or language issues.`);
	process.exit(0);
}

const posts = filePaths.length ? filePaths.map((filePath) => readPostFile(filePath)) : readAllPosts();
const allPosts = filePaths.length ? readAllPosts() : posts;
const issues = posts.flatMap((post) => auditPost(post, allPosts));

if (!filePaths.length) {
	issues.push(...auditRelatedPosts(allPosts));
}

const aiSuggestions = [];

if (useAi) {
	const candidates = posts.filter((post) => (
		issues.some((issue) => (
			issue.filePath === post.filePath
			&& ['excerpt-quality', 'excerpt-language', 'content-language'].includes(issue.code)
		))
	));
	const selectedCandidates = aiLimit > 0 ? candidates.slice(0, aiLimit) : candidates;

	for (const post of selectedCandidates) {
		try {
			aiSuggestions.push(await suggestPostMetadataFile(post.filePath));
		} catch (error) {
			issues.push({
				severity: 'warn',
				code: 'ai-metadata',
				filePath: post.filePath,
				path: post.frontmatter.path,
				message: `AI metadata suggestion failed: ${error.message}`,
			});
		}
	}
}

const errorCount = issues.filter((issue) => issue.severity === 'error').length;
const warningCount = issues.filter((issue) => issue.severity === 'warn').length;
const report = {
	auditedPosts: posts.length,
	errorCount,
	warningCount,
	issueCount: issues.length,
	issues,
	aiSuggestions,
};

if (jsonOutput) {
	console.log(JSON.stringify(report, null, '\t'));
} else {
	printTextReport(report, summaryOnly);
}

if (!noFail && errorCount > 0) {
	process.exitCode = 1;
}

function auditPost(post, allPosts) {
	const issues = [];
	const frontmatter = post.frontmatter;
	const textSample = `${frontmatter.title}\n${frontmatter.excerpt}\n${post.body.slice(0, 2400)}`;

	for (const field of ['id', 'slug', 'path', 'title', 'excerpt', 'date', 'modified', 'locale', 'authorName', 'sourceUrl']) {
		if (frontmatter[field] === undefined || frontmatter[field] === '') {
			addIssue(issues, post, 'error', 'frontmatter-required', `Missing required frontmatter field: ${field}`);
		}
	}

	if (!['de', 'en'].includes(frontmatter.locale)) {
		addIssue(issues, post, 'error', 'locale', `Unsupported locale: ${frontmatter.locale}`);
	}

	const expectedPathPrefixes = frontmatter.category === 'audacity'
		? frontmatter.locale === 'en'
			? ['/en/audacity/']
			: ['/audacity/']
		: frontmatter.locale === 'de'
			? ['/youtube-tipps-de/']
			: ['/youtube-tips-en/', '/blog/'];
	if (frontmatter.path && frontmatter.locale && !expectedPathPrefixes.some((prefix) => frontmatter.path.startsWith(prefix))) {
		addIssue(issues, post, 'error', 'path-locale', `Path does not match locale. Expected one of: ${expectedPathPrefixes.join(', ')}`);
	}

	if (frontmatter.slug && frontmatter.path && !frontmatter.path.includes(`/${frontmatter.slug}/`)) {
		addIssue(issues, post, 'warn', 'path-slug', 'Path does not contain the frontmatter slug.');
	}

	if (frontmatter.title?.length > 100) {
		addIssue(issues, post, 'warn', 'title-length', `Title is long (${frontmatter.title.length} characters).`);
	}

	if (looksAllCaps(frontmatter.title)) {
		addIssue(issues, post, 'warn', 'title-caps', 'Title appears to be all caps.');
	}

	auditExcerpt(post, issues);
	auditLanguage(post, textSample, issues);
	auditBrandTerms(post, textSample, issues);
	auditBody(post, issues);
	auditInternalLinks(post, allPosts, issues);
	auditVideoMetadata(post, issues);

	return issues;
}

function auditExcerpt(post, issues) {
	const excerpt = String(post.frontmatter.excerpt ?? '');

	if (!excerpt.trim()) {
		addIssue(issues, post, 'error', 'excerpt-quality', 'Excerpt is empty.');
		return;
	}

	if (excerpt.length < 70 || excerpt.length > 220 || excerpt.endsWith('...')) {
		addIssue(issues, post, 'warn', 'excerpt-quality', `Excerpt looks weak (${excerpt.length} characters).`);
	}

	if (/\n|^\s*["“]|translated text|return only|for KW Media|as an ai|```/i.test(excerpt)) {
		addIssue(issues, post, 'error', 'excerpt-quality', 'Excerpt contains a quote, newline, prompt leak, or AI note.');
	}

	if (post.frontmatter.locale === 'en' && likelyGermanText(excerpt)) {
		addIssue(issues, post, 'error', 'excerpt-language', 'English excerpt appears to be German.');
	}

	if (post.frontmatter.locale === 'de' && likelyEnglishText(excerpt)) {
		addIssue(issues, post, 'error', 'excerpt-language', 'German excerpt appears to be English.');
	}
}

function auditLanguage(post, textSample, issues) {
	const score = languageScore(textSample);

	if (post.frontmatter.locale === 'en' && score.german > score.english * 1.5 && score.german > 10) {
		addIssue(issues, post, 'error', 'content-language', `English post appears to contain German content (${score.german}/${score.english}).`);
	}

	if (post.frontmatter.locale === 'de' && score.english > score.german * 1.8 && score.english > 12) {
		addIssue(issues, post, 'error', 'content-language', `German post appears to contain English content (${score.english}/${score.german}).`);
	}
}

function auditBrandTerms(post, textSample, issues) {
	const checks = [
		{ pattern: /\bYoutube\b/g, code: 'brand-case', message: 'Use "YouTube" casing.' },
		{ pattern: /\bobs\b/g, code: 'brand-case', message: 'Use "OBS" casing.' },
		{ pattern: /\baudacity\b/g, code: 'brand-case', message: 'Use "Audacity" casing.' },
		{ pattern: /\bSuperchat\b/g, code: 'brand-case', message: 'Use "Super Chat" unless quoting a UI label.' },
		{ pattern: /\bFusionsimpressionen\b/gi, code: 'speech-cleanup', message: 'Possible speech-to-text error: "Fusionsimpressionen".' },
		{ pattern: /\bubs-einstellungen\b/gi, code: 'speech-cleanup', message: 'Possible speech-to-text error: "ubs-einstellungen".' },
		{ pattern: /\b(Schopfer|Schöpfer|Kreativkraft)\b/gi, code: 'terminology', message: 'German content should usually keep "Creator".' },
	];

	for (const check of checks) {
		if (check.pattern.test(textSample)) {
			addIssue(issues, post, 'warn', check.code, check.message);
		}
	}
}

function auditBody(post, issues) {
	const words = post.body.split(/\s+/).filter(Boolean).length;

	if (words < 35) {
		addIssue(issues, post, 'warn', 'body-length', `Body is very short (${words} words).`);
	}

	if (!/^##\s+/m.test(post.body)) {
		addIssue(issues, post, 'warn', 'body-structure', 'Body has no level-2 heading.');
	}
}

function auditInternalLinks(post, allPosts, issues) {
	const knownPaths = new Set(allPosts.map((candidate) => candidate.frontmatter.path));

	for (const match of post.body.matchAll(/\]\((\/youtube-(?:tipps|tips)-[^)#\s]+)(?:#[^)]+)?\)/g)) {
		const path = match[1].endsWith('/') ? match[1] : `${match[1]}/`;
		if (!knownPaths.has(path)) {
			addIssue(issues, post, 'error', 'internal-link', `Broken internal post link: ${match[1]}`);
		}
	}
}

function auditVideoMetadata(post, issues) {
	const video = post.frontmatter.video;
	if (!video) {
		return;
	}

	if (!post.frontmatter.sourceUrl?.includes(video.youtubeId)) {
		addIssue(issues, post, 'warn', 'video-metadata', 'sourceUrl does not include video.youtubeId.');
	}

	if (!video.embedUrl?.includes(video.youtubeId) || !video.watchUrl?.includes(video.youtubeId)) {
		addIssue(issues, post, 'error', 'video-metadata', 'Video URLs do not include video.youtubeId.');
	}
}

function auditRelatedPosts(posts) {
	const relatedPath = join(process.cwd(), 'src/data/related-posts.json');
	if (!existsSync(relatedPath)) {
		return [];
	}

	const related = JSON.parse(readFileSync(relatedPath, 'utf8'));
	const knownPaths = new Set(posts.map((post) => post.frontmatter.path));
	const issues = [];

	for (const [path, links] of Object.entries(related)) {
		if (!knownPaths.has(path)) {
			issues.push(globalIssue('error', 'related-posts', `Related-post entry has unknown source path: ${path}`));
		}

		if (!Array.isArray(links)) {
			issues.push(globalIssue('error', 'related-posts', `Related-post entry is not an array: ${path}`));
			continue;
		}

		for (const link of links) {
			if (!knownPaths.has(link)) {
				issues.push(globalIssue('error', 'related-posts', `Related-post entry points to unknown path: ${path} -> ${link}`));
			}
		}
	}

	return issues;
}

function addIssue(issues, post, severity, code, message) {
	issues.push({
		severity,
		code,
		filePath: post.filePath,
		path: post.frontmatter.path,
		message,
	});
}

function globalIssue(severity, code, message) {
	return {
		severity,
		code,
		filePath: 'src/data/related-posts.json',
		path: undefined,
		message,
	};
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

function printTextReport(report, summaryOnly = false) {
	console.log(`Audited ${report.auditedPosts} post(s): ${report.errorCount} error(s), ${report.warningCount} warning(s).`);

	if (!report.issues.length) {
		return;
	}

	if (summaryOnly) {
		const counts = new Map();
		for (const issue of report.issues) {
			counts.set(issue.code, (counts.get(issue.code) ?? 0) + 1);
		}

		for (const [code, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
			console.log(`- ${code}: ${count}`);
		}
		return;
	}

	const grouped = new Map();
	for (const issue of report.issues) {
		const key = issue.filePath;
		grouped.set(key, [...(grouped.get(key) ?? []), issue]);
	}

	for (const [filePath, fileIssues] of grouped) {
		console.log(`\n${relative(process.cwd(), filePath)}`);
		for (const issue of fileIssues) {
			console.log(`- ${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`);
		}
	}

	if (report.aiSuggestions.length) {
		console.log(`\nAI metadata suggestions: ${report.aiSuggestions.length}`);
		for (const suggestion of report.aiSuggestions) {
			console.log(`- ${relative(process.cwd(), suggestion.filePath)}: ${suggestion.suggestion.excerpt}`);
		}
	}
}

function argumentValue(name) {
	const prefix = `${name}=`;
	return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
