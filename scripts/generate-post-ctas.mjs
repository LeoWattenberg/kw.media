import { relative, resolve } from 'node:path';
import { allPostFiles, generatePostCtaFile, readPostFile } from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const all = args.includes('--all');
const missingOnly = args.includes('--missing') || args.includes('--only-missing') || !all;
const limit = Number(argumentValue('--limit') ?? 0);
const model = argumentValue('--model');

if (help) {
	console.log(`Usage:
node scripts/generate-post-ctas.mjs [--dry] [--all|--missing] [--limit=20] [--model=name] [post.md ...]

Uses local Ollama to generate understated post CTA paragraphs with a relevant
site-page link. Writes postCta frontmatter by default. Add --dry to preview.`);
	process.exit(0);
}

const files = selectFiles();
const selectedFiles = limit > 0 ? files.slice(0, limit) : files;

console.log(`${dryRun ? 'Dry run' : 'Writing CTAs'} for ${selectedFiles.length} post(s).`);

const results = [];

for (const [index, filePath] of selectedFiles.entries()) {
	const label = relative(process.cwd(), filePath);
	console.log(`${index + 1}/${selectedFiles.length} ${label}`);

	const result = await generatePostCtaFile(filePath, { dryRun, model });
	console.log(`  ${result.postCta.text.replace('{page}', result.postCta.pageTitle)} -> ${result.postCta.pagePath}`);
	results.push(result);
}

const changed = results.filter((result) => result.changed).length;
console.log(`${dryRun ? 'Would change' : 'Changed'} ${changed} of ${selectedFiles.length} post(s).`);

function selectFiles() {
	const passedFiles = positionalArgs().map((filePath) => resolve(filePath));
	const candidates = passedFiles.length ? passedFiles : allPostFiles();

	if (!missingOnly) {
		return candidates;
	}

	return candidates.filter((filePath) => !hasPostCta(readPostFile(filePath)));
}

function hasPostCta(post) {
	return Boolean(
		post.frontmatter.postCta?.text
			&& post.frontmatter.postCta?.pagePath
			&& post.frontmatter.postCta?.pageTitle,
	);
}

function positionalArgs() {
	return args.filter((argument) => !argument.startsWith('-'));
}

function argumentValue(name) {
	const prefix = `${name}=`;
	const inline = args.find((argument) => argument.startsWith(prefix));
	if (inline) {
		return inline.slice(prefix.length);
	}

	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
}
