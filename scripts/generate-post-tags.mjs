import { relative, resolve } from 'node:path';
import {
	allPostFiles,
	buildTagVocabulary,
	generatePostTagsFile,
	readPostFile,
	writeTagRegistry,
} from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const all = args.includes('--all');
const missingOnly = args.includes('--missing') || args.includes('--only-missing') || !all;
const limit = Number(argumentValue('--limit') ?? 0);
const model = argumentValue('--model');
const updateRegistry = !args.includes('--no-registry');

if (help) {
	console.log(`Usage:
node scripts/generate-post-tags.mjs [--dry] [--all|--missing] [--limit=20] [--model=name] [--no-registry] [post.md ...]

Uses local Ollama to add 3 to 10 discoverability tags to each post. Tags are
stored in post frontmatter; the global tag list is kept in src/data/tags.json.
Prefers existing tags when they closely match and only creates new tags when no
existing tag fits. Writes tags to frontmatter and refreshes src/data/tags.json
by default. Add --dry to preview. Add --no-registry to skip the global list.

Options:
- --dry          Preview proposed tags without editing files or the registry.
- --all          Tag every post, including ones that already have tags.
- --missing      Only tag posts with no tags. This is the default.
- --limit=N      Process only the first N selected posts.
- --model=name   Override the Ollama model (defaults to OLLAMA_POST_TAG_MODEL).
- --no-registry  Do not refresh src/data/tags.json after tagging.`);
	process.exit(0);
}

const files = selectFiles();
const selectedFiles = limit > 0 ? files.slice(0, limit) : files;

console.log(`${dryRun ? 'Dry run' : 'Writing tags'} for ${selectedFiles.length} post(s).`);

const vocabulary = buildTagVocabulary();
const results = [];

for (const [index, filePath] of selectedFiles.entries()) {
	const label = relative(process.cwd(), filePath);
	console.log(`${index + 1}/${selectedFiles.length} ${label}`);

	try {
		const result = await generatePostTagsFile(filePath, { dryRun, model, vocabulary });
		console.log(`  ${result.tags.length ? result.tags.join(', ') : '(no tags returned)'}`);
		results.push(result);
	} catch (error) {
		console.error(`  failed: ${error.message}`);
	}
}

const changed = results.filter((result) => result.changed).length;
console.log(`${dryRun ? 'Would change' : 'Changed'} ${changed} of ${selectedFiles.length} post(s).`);

if (!dryRun && updateRegistry && selectedFiles.length) {
	const tags = writeTagRegistry();
	console.log(`Refreshed src/data/tags.json (${tags.length} tag(s)).`);
}

function selectFiles() {
	const passedFiles = positionalArgs().map((filePath) => resolve(filePath));
	const candidates = passedFiles.length ? passedFiles : allPostFiles();

	if (!missingOnly) {
		return candidates;
	}

	return candidates.filter((filePath) => !hasTags(readPostFile(filePath)));
}

function hasTags(post) {
	return Array.isArray(post.frontmatter.tags) && post.frontmatter.tags.length > 0;
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
