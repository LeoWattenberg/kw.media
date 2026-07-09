import { execFileSync } from 'node:child_process';
import { relative, resolve, join } from 'node:path';
import { allPostFiles, importSourcesFromDescriptionFile, readPostFile } from './content-ai.mjs';

const args = process.argv.slice(2);
const help = args.includes('--help') || args.includes('-h');
const dryRun = args.includes('--dry') || args.includes('--dry-run');
const all = args.includes('--all');
const missingOnly = args.includes('--missing') || args.includes('--only-missing') || !all;
const limit = Number(argumentValue('--limit') ?? 0);
const localYtDlp = join(process.cwd(), 'scripts/yt-dlp');
const ytDlpCommand = (process.env.YT_DLP_COMMAND ?? localYtDlp).split(/\s+/).filter(Boolean);

if (help) {
	console.log(`Usage:
node scripts/import-missing-sources.mjs [--dry] [--all|--missing] [--limit=20] [post.md ...]

Fetches YouTube descriptions for video posts, extracts external links, and writes
them to sources frontmatter. By default, only posts without sources are changed.`);
	process.exit(0);
}

const files = selectFiles();
const selectedFiles = limit > 0 ? files.slice(0, limit) : files;
const descriptions = new Map();
const results = [];

console.log(`${dryRun ? 'Dry run' : 'Importing'} sources for ${selectedFiles.length} post(s).`);

for (const [index, filePath] of selectedFiles.entries()) {
	const post = readPostFile(filePath);
	const label = relative(process.cwd(), filePath);
	console.log(`${index + 1}/${selectedFiles.length} ${label}`);

	const description = getCachedDescription(post, descriptions);
	const result = importSourcesFromDescriptionFile(filePath, description, { dryRun });
	const sourceCount = result.sources.length;
	console.log(`  ${sourceCount ? `${sourceCount} source link(s)` : 'no source links found'}`);
	results.push(result);
}

const changed = results.filter((result) => result.changed).length;
console.log(`${dryRun ? 'Would change' : 'Changed'} ${changed} of ${selectedFiles.length} post(s).`);

function selectFiles() {
	const passedFiles = positionalArgs().map((filePath) => resolve(filePath));
	const candidates = (passedFiles.length ? passedFiles : allPostFiles())
		.filter((filePath) => {
			const post = readPostFile(filePath);
			return Boolean(post.frontmatter.video?.youtubeId || post.frontmatter.sourceUrl?.includes('youtube.com'));
		});

	if (!missingOnly) {
		return candidates;
	}

	return candidates.filter((filePath) => !hasSources(readPostFile(filePath)));
}

function hasSources(post) {
	return Array.isArray(post.frontmatter.sources) && post.frontmatter.sources.some((source) => source?.url);
}

function getCachedDescription(post, cache) {
	const key = post.frontmatter.video?.youtubeId ?? post.frontmatter.sourceUrl;
	if (cache.has(key)) {
		return cache.get(key);
	}

	const description = videoDescription(post);
	cache.set(key, description);
	return description;
}

function videoDescription(post) {
	const url = post.frontmatter.sourceUrl ?? `https://www.youtube.com/watch?v=${post.frontmatter.video.youtubeId}`;
	const output = execFileSync(ytDlpCommand[0], [
		...ytDlpCommand.slice(1),
		'--skip-download',
		'--no-warnings',
		'--print',
		'%(description)j',
		url,
	], {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024 * 16,
		stdio: ['ignore', 'pipe', 'inherit'],
	}).trim();

	try {
		return JSON.parse(output);
	} catch {
		return output;
	}
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
