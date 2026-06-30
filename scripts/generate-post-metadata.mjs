import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative } from 'node:path';
import { allPostFiles, readPostFile, suggestPostMetadataFile } from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const all = args.includes('--all');
const weakOnly = args.includes('--weak') || args.includes('--only-weak');
const outputPath = argumentValue('--output');
const model = argumentValue('--model');
const filePaths = args.filter((argument) => !argument.startsWith('-'));

if (help || (!all && !weakOnly && !filePaths.length)) {
	console.log(`Usage:
node scripts/generate-post-metadata.mjs [--all|--weak] [--output=.cache/post-metadata-suggestions.json] [--model=name] [post.md ...]

Uses local Ollama to propose title, excerpt, summary, search keywords, topics,
audience intent, and quality notes. This script does not edit posts.`);
	process.exit(help ? 0 : 1);
}

const selectedFiles = selectFiles();
const suggestions = [];

for (const [index, filePath] of selectedFiles.entries()) {
	console.error(`${index + 1}/${selectedFiles.length} ${relative(process.cwd(), filePath)}`);
	suggestions.push(await suggestPostMetadataFile(filePath, { model }));
}

const report = {
	generatedAt: new Date().toISOString(),
	count: suggestions.length,
	suggestions,
};

if (outputPath) {
	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, `${JSON.stringify(report, null, '\t')}\n`);
	console.log(`Wrote ${outputPath}`);
} else {
	console.log(JSON.stringify(report, null, '\t'));
}

function selectFiles() {
	const files = filePaths.length ? filePaths : allPostFiles();

	if (!weakOnly) {
		return files;
	}

	return files.filter((filePath) => isWeakMetadata(readPostFile(filePath)));
}

function isWeakMetadata(post) {
	const excerpt = String(post.frontmatter.excerpt ?? '');

	return !excerpt
		|| excerpt.length < 70
		|| excerpt.length > 220
		|| excerpt.endsWith('...')
		|| /\n|^\s*["“]|translated text|return only|for KW Media|as an ai|```/i.test(excerpt)
		|| (post.frontmatter.locale === 'en' && likelyGermanText(excerpt))
		|| (post.frontmatter.locale === 'de' && likelyEnglishText(excerpt));
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

function argumentValue(name) {
	const prefix = `${name}=`;
	return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}
