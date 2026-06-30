import { relative } from 'node:path';
import {
	allPostFiles,
	applyPostMetadataFile,
	generateExcerptForPostFile,
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
const excerpts = commonFixes || args.includes('--excerpts');
const metadata = args.includes('--metadata') || args.includes('--all-fixes');
const translations = commonFixes || args.includes('--translations');
const limit = Number(argumentValue('--limit') ?? 0);
const model = argumentValue('--model');
const dryRun = !write;

if (help || (!deterministic && !excerpts && !metadata && !translations)) {
	console.log(`Usage:
node scripts/fix-post-issues.mjs [--write] [--all|--weak] [--common|--all-fixes]
node scripts/fix-post-issues.mjs [--write] [--deterministic] [--excerpts] [--metadata] [--translations] [post.md ...]

Default target selection is --weak when no post paths are provided.
Without --write this runs in dry-run mode.

Fix modes:
- --deterministic  Safe casing, known speech cleanup, known internal-link fixes, missing headings.
- --excerpts       Regenerate weak excerpts with local Ollama.
- --metadata       Apply local-Ollama title and excerpt suggestions.
- --translations   Retranslate posts whose content appears to be in the wrong locale.
- --common         deterministic + excerpts + translations.
- --all-fixes      deterministic + excerpts + metadata + translations.`);
	process.exit(help ? 0 : 1);
}

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

	if (deterministic) {
		const deterministicResult = fixDeterministic(post, { dryRun });
		if (deterministicResult.changed) {
			result.actions.push(...deterministicResult.actions);
			console.log(`  deterministic: ${deterministicResult.actions.join(', ')}`);
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
	const frontmatter = {
		...originalFrontmatter,
		title: fixText(originalFrontmatter.title),
		excerpt: fixText(originalFrontmatter.excerpt),
	};
	let body = fixInternalLinks(fixText(originalBody));
	const actions = [];

	if (frontmatter.title !== originalFrontmatter.title || frontmatter.excerpt !== originalFrontmatter.excerpt || body !== originalBody) {
		actions.push('text');
	}

	if (!/^##\s+/m.test(body)) {
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

function fixInternalLinks(text) {
	const knownFixes = new Map([
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
	]);

	let output = text;
	for (const [oldPath, newPath] of knownFixes) {
		output = output.split(oldPath).join(newPath);
	}

	return output;
}

function defaultHeading(post) {
	if (post.frontmatter.video) {
		return post.frontmatter.locale === 'de' ? '## Transkript' : '## Transcript';
	}

	return post.frontmatter.locale === 'de' ? '## Überblick' : '## Overview';
}

function hasSelectedFixableIssue(post) {
	return (deterministic && hasDeterministicIssue(post))
		|| (metadata && hasMetadataIssue(post))
		|| (excerpts && hasWeakExcerpt(post))
		|| (translations && likelyWrongLanguage(post));
}

function hasDeterministicIssue(post) {
	const sample = `${post.frontmatter.title}\n${post.frontmatter.excerpt}\n${post.body}`;

	return fixText(sample) !== sample
		|| fixInternalLinks(sample) !== sample
		|| !/^##\s+/m.test(post.body);
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
