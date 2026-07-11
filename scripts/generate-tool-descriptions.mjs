#!/usr/bin/env node

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const toolsDirectory = path.join(root, 'src/data/tools');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const model = optionValue('--model') || process.env.OLLAMA_TOOL_DESCRIPTION_MODEL || 'aya-expanse:8b';
const ollamaUrl = process.env.OLLAMA_URL ?? process.env.OLLAMA_TRANSLATE_URL ?? 'http://172.20.208.1:11434';
const limit = Number(optionValue('--limit') || 0);
const fileFilter = optionValue('--file');

const files = await listAstroFiles(toolsDirectory);
const candidates = [];

for (const filePath of files) {
	if (fileFilter && !filePath.includes(fileFilter)) continue;
	const source = await readFile(filePath, 'utf8');
	for (const match of source.matchAll(/(description:\s*)(['"])([^'"\n]+)\2/g)) {
		const [full, prefix, quote, description] = match;
		const start = match.index ?? 0;
		const before = source.slice(Math.max(0, start - 900), start);
		const titleMatches = [...before.matchAll(/title:\s*(['"])([^'"\n]+)\1/g)];
		const title = titleMatches.at(-1)?.[2] || path.basename(filePath, '.astro');
		const locale = /(?:^|[-_])de(?:['",])/.test(before.slice(-240)) || /\/de\//.test(before.slice(-240)) ? 'de' : 'en';

		candidates.push({
			filePath,
			start,
			end: start + full.length,
			prefix,
			quote,
			description,
			title,
			locale,
		});
	}
}

const selected = limit > 0 ? candidates.slice(0, limit) : candidates;
if (!selected.length) {
	console.log('No editable tool descriptions found.');
	process.exit(0);
}

const replacementsByFile = new Map();
for (const candidate of selected) {
	const description = await generateDescription(candidate);
	console.log(`${relative(candidate.filePath)}\n  ${candidate.description}\n  → ${description}`);
	if (description === candidate.description) continue;
	const replacement = `${candidate.prefix}${candidate.quote}${escapeForQuote(description, candidate.quote)}${candidate.quote}`;
	const replacements = replacementsByFile.get(candidate.filePath) || [];
	replacements.push({ start: candidate.start, end: candidate.end, replacement });
	replacementsByFile.set(candidate.filePath, replacements);
}

if (dryRun) {
	console.log('\nDry run only. Re-run without --dry to update the descriptions.');
	process.exit(0);
}

for (const [filePath, replacements] of replacementsByFile) {
	let source = await readFile(filePath, 'utf8');
	for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
		source = `${source.slice(0, replacement.start)}${replacement.replacement}${source.slice(replacement.end)}`;
	}
	await writeFile(filePath, source);
}

console.log(`\nUpdated ${replacementsByFile.size} file(s). Review the diff before committing.`);

async function generateDescription({ title, description, locale }) {
	const language = locale === 'de' ? 'German' : 'English';
	const prompt = [
		`Write one SEO-friendly meta description in ${language} for a browser-based creator tool named “${title}”.`,
		`It must be 110–155 characters, accurate, clear, have no call to action, no quote marks, and no unsupported claims.`,
		`Keep client-side/local processing claims only when already stated. Existing description: ${description}`,
		'Return JSON only: {"description":"..."}',
	].join('\n');
	const response = await fetch(`${ollamaUrl}/api/generate`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { temperature: 0.2 } }),
	});

	if (!response.ok) {
		throw new Error(`Ollama request failed (${response.status} ${response.statusText}).`);
	}

	const payload = await response.json();
	let parsed;
	try {
		parsed = JSON.parse(payload.response);
	} catch {
		throw new Error('Ollama returned invalid JSON.');
	}
	const result = String(parsed.description || '').replace(/\s+/g, ' ').trim();
	if (result.length < 110 || result.length > 155 || /[\r\n<>]/.test(result)) {
		throw new Error(`Ollama returned an invalid description for ${title}.`);
	}
	return result;
}

async function listAstroFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(entries.map(async (entry) => {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) return listAstroFiles(entryPath);
		return entry.isFile() && entry.name.endsWith('.astro') ? [entryPath] : [];
	}));
	return nested.flat();
}

function optionValue(name) {
	const index = args.indexOf(name);
	if (index !== -1) return args[index + 1];
	return args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}

function escapeForQuote(value, quote) {
	return value.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`);
}

function relative(filePath) {
	return path.relative(root, filePath);
}
