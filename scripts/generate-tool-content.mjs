#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
	loadToolCandidates,
	normalizeGeneratedText,
	readGeneratedToolMetadata,
	requestOllamaJson,
	writeGeneratedToolMetadata,
} from './tool-metadata.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const replaceExisting = args.includes('--all');
const model = optionValue('--model') || process.env.OLLAMA_TOOL_CONTENT_MODEL || process.env.OLLAMA_TOOL_DESCRIPTION_MODEL || 'aya-expanse:8b';
const ollamaUrl = process.env.OLLAMA_URL ?? process.env.OLLAMA_TRANSLATE_URL ?? 'http://172.20.208.1:11434';
const limit = Number(optionValue('--limit') || 0);
const fileFilter = optionValue('--file');
const metadata = await readGeneratedToolMetadata(root);
const candidates = (await loadToolCandidates(root)).filter((candidate) => {
	if (!replaceExisting && metadata[candidate.path]?.content?.length) return false;
	return !fileFilter || candidate.filePath.includes(fileFilter) || candidate.path.includes(fileFilter) || candidate.title.toLowerCase().includes(fileFilter.toLowerCase());
});
const selected = limit > 0 ? candidates.slice(0, limit) : candidates;

if (!selected.length) {
	console.log('No tool pages need expanded content.');
	process.exit(0);
}

let updated = 0;
let skipped = 0;

for (const candidate of selected) {
	const description = metadata[candidate.path]?.description || candidate.description;
	try {
		const content = await generateContent({ ...candidate, description });
		console.log(`${candidate.path}${candidate.virtual ? ' (virtual)' : ''}`);
		for (const paragraph of content) console.log(`  ${paragraph}`);
		metadata[candidate.path] = { ...metadata[candidate.path], content };
		updated += 1;
	} catch (error) {
		skipped += 1;
		console.warn(`${candidate.path}\n  Skipped: ${error.message}`);
	}
}

if (dryRun) {
	console.log(`\nDry run only. ${updated} expansion(s) proposed; ${skipped} skipped.`);
	process.exit(0);
}

await writeGeneratedToolMetadata(metadata, root);
console.log(`\nUpdated long-form content for ${updated} page(s) in ${path.relative(root, path.join(root, 'src/data/generated-tool-metadata'))}; ${skipped} skipped.`);

async function generateContent({ title, description, locale, path: pagePath }) {
	const language = locale === 'de' ? 'German' : 'English';
	const prompt = [
		`Write the explanatory copy shown below a browser-based creator tool named “${title}” in ${language}.`,
		'Write 3 or 4 distinct paragraphs of 45–90 words each, with no headings, bullets, Markdown, calls to action, or quotation marks.',
		'Paragraph 1 explains the purpose. Paragraph 2 explains the browser workflow. Paragraph 3 names only formats or media types supported by the supplied facts. The final paragraph highlights local processing and privacy without promising more than the facts support.',
		'Do not invent formats, limits, AI models, libraries, quality guarantees, or features. Make this page-specific; use its exact target format when the title names one.',
		`Page path: ${pagePath}`,
		`Title: ${title}`,
		`Verified description: ${description}`,
		'Return JSON only: {"paragraphs":["...","...","..."]}',
	].join('\n');
	const parsed = await requestOllamaJson({
		ollamaUrl,
		model,
		prompt,
		validate: (value) => validContent(value.paragraphs, locale),
	});
	return parsed.paragraphs.map(normalizeGeneratedText);
}

function validContent(paragraphs, locale) {
	if (!Array.isArray(paragraphs) || paragraphs.length < 3 || paragraphs.length > 4) return false;
	const normalized = paragraphs.map(normalizeGeneratedText);
	if (normalized.some((paragraph) => paragraph.length < 180 || paragraph.length > 750 || /[<>\r\n]/.test(paragraph))) return false;
	const joined = normalized.join(' ');
	return locale === 'de'
		? /\b(Browser|lokal|lokale|lokalen|privat|Privatsphäre|hochgeladen|Upload)\b/i.test(joined)
		: /\b(browser|local|locally|private|privacy|upload|uploaded)\b/i.test(joined);
}

function optionValue(name) {
	const index = args.indexOf(name);
	if (index !== -1) return args[index + 1];
	return args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}
