import { relative, resolve } from 'node:path';
import {
	allPostFiles,
	expandTranscriptPostFile,
	isTranscriptExpansionCandidate,
	markdownWordCount,
	readPostFile,
} from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const all = args.includes('--all');
const thinOnly = args.includes('--thin') || args.includes('--only-thin');
const limit = Number(argumentValue('--limit') ?? 0);
const minWords = Number(argumentValue('--min-words') ?? 900);
const targetWords = Number(argumentValue('--target-words') ?? 0);
const previewChars = Number(argumentValue('--preview-chars') ?? 900);
const model = argumentValue('--model');
const filePaths = positionalArgs().map((filePath) => resolve(filePath));

if (help || (!all && !thinOnly && !filePaths.length)) {
	console.log(`Usage:
node scripts/expand-transcripts.mjs [--dry] [--all|--thin] [--limit=10] [--min-words=900] [--target-words=1000] [--model=name] [post.md ...]

Uses local Ollama to turn thin transcript-style video posts into fuller article
bodies. Writes changes by default. Add --dry to preview generated output without
editing files.

Options:
- --dry              Preview generated article bodies without editing posts.
- --all              Expand every transcript-style video post or every passed file.
- --thin             Expand only transcript-style posts below --min-words, with very few headings, or still starting as "Transkript"/"Transcript".
- --limit=N          Process only the first N selected posts.
- --min-words=N      Thin-post word threshold for --thin. Defaults to 900.
- --target-words=N   Override the target article length sent to Ollama.
- --model=name       Override OLLAMA_TRANSCRIPT_EXPAND_MODEL.`);
	process.exit(help ? 0 : 1);
}

const files = selectFiles();
const selectedFiles = limit > 0 ? files.slice(0, limit) : files;

console.log(`${dryRun ? 'Dry run' : 'Expanding'} ${selectedFiles.length} transcript post(s).`);

const results = [];

for (const [index, filePath] of selectedFiles.entries()) {
	const label = relative(process.cwd(), filePath);
	const post = readPostFile(filePath);
	const beforeWords = markdownWordCount(post.body);

	console.log(`${index + 1}/${selectedFiles.length} ${label} (${beforeWords} words)`);

	try {
		const result = await expandTranscriptPostFile(filePath, {
			dryRun,
			model,
			...(targetWords > 0 ? { targetWords } : {}),
		});
		results.push(result);
		console.log(`  ${result.oldWords} -> ${result.newWords} words with ${result.model}`);

		if (dryRun) {
			console.log(indentPreview(result.body, previewChars));
		}
	} catch (error) {
		console.error(`  failed: ${error.message}`);
	}
}

const changed = results.filter((result) => result.changed).length;
console.log(`${dryRun ? 'Would change' : 'Changed'} ${changed} of ${selectedFiles.length} post(s).`);

function selectFiles() {
	const candidates = filePaths.length ? filePaths : allPostFiles();

	if (!thinOnly) {
		return candidates;
	}

	return candidates.filter((filePath) => isTranscriptExpansionCandidate(readPostFile(filePath), { minWords }));
}

function indentPreview(markdown, maxLength) {
	const preview = markdown.length > maxLength
		? `${markdown.slice(0, maxLength).replace(/\s+$/, '')}\n...`
		: markdown;

	return preview
		.split('\n')
		.map((line) => `  ${line}`)
		.join('\n');
}

function positionalArgs() {
	const optionNamesWithValues = new Set(['--limit', '--min-words', '--target-words', '--preview-chars', '--model']);
	const values = [];

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (argument.startsWith('--') && argument.includes('=')) {
			continue;
		}

		if (optionNamesWithValues.has(argument)) {
			index += 1;
			continue;
		}

		if (argument.startsWith('-')) {
			continue;
		}

		values.push(argument);
	}

	return values;
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
