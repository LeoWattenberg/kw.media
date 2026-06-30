import { relative } from 'node:path';
import { allPostFiles, generateExcerptForPostFile, readPostFile } from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const all = args.includes('--all');
const weakOnly = args.includes('--weak') || args.includes('--only-weak');
const dryRun = args.includes('--dry-run');
const model = argumentValue('--model');
const filePaths = args.filter((argument) => !argument.startsWith('-'));

if (help || (!all && !weakOnly && !filePaths.length)) {
	console.log(`Usage:
node scripts/generate-excerpts.mjs [--dry-run] [--all|--weak] [--model=name] [post.md ...]

Uses local Ollama to generate validated frontmatter excerpts. Without --dry-run,
the script updates only the excerpt field and preserves the post body.`);
	process.exit(help ? 0 : 1);
}

const selectedFiles = selectFiles();
const results = [];

for (const [index, filePath] of selectedFiles.entries()) {
	console.log(`${index + 1}/${selectedFiles.length} ${relative(process.cwd(), filePath)}`);
	const result = await generateExcerptForPostFile(filePath, { dryRun, model });
	results.push(result);

	if (dryRun || result.changed) {
		console.log(`  old: ${result.oldExcerpt}`);
		console.log(`  new: ${result.excerpt}`);
	}
}

const changed = results.filter((result) => result.changed).length;
console.log(`${dryRun ? 'Would update' : 'Updated'} ${changed} of ${results.length} excerpt(s).`);

function selectFiles() {
	const files = filePaths.length ? filePaths : allPostFiles();

	if (!weakOnly) {
		return files;
	}

	return files.filter((filePath) => isWeakExcerpt(readPostFile(filePath)));
}

function isWeakExcerpt(post) {
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
