#!/usr/bin/env node

import path from 'node:path';
import process from 'node:process';
import {
	loadToolCandidates,
	fitMetaDescription,
	generatedDescriptionValue,
	readGeneratedToolMetadata,
	requestOllamaJson,
	validMetaDescription,
	writeGeneratedToolMetadata,
} from './tool-metadata.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry');
const model = optionValue('--model') || process.env.OLLAMA_TOOL_DESCRIPTION_MODEL || 'aya-expanse:8b';
const ollamaUrl = process.env.OLLAMA_URL ?? process.env.OLLAMA_TRANSLATE_URL ?? 'http://172.20.208.1:11434';
const limit = Number(optionValue('--limit') || 0);
const fileFilter = optionValue('--file');
const missingOnly = args.includes('--missing');
const allCandidates = await loadToolCandidates(root);
const existingMetadata = await readGeneratedToolMetadata(root);
const filtered = allCandidates
	.filter((candidate) => !missingOnly || !existingMetadata[candidate.path]?.description)
	.filter((candidate) => !fileFilter || candidate.filePath.includes(fileFilter) || candidate.path.includes(fileFilter) || candidate.title.toLowerCase().includes(fileFilter.toLowerCase()));
const selected = limit > 0 ? filtered.slice(0, limit) : filtered;

if (!selected.length) {
	console.log('No tool descriptions matched.');
	process.exit(0);
}

const metadata = existingMetadata;
let updated = 0;
let skipped = 0;

for (const candidate of selected) {
	const current = metadata[candidate.path]?.description || candidate.description;
	try {
		const description = await generateDescription({ ...candidate, description: current });
		console.log(`${candidate.path}${candidate.virtual ? ' (virtual)' : ''}\n  ${current}\n  → ${description}`);
		if (description === current) continue;
		metadata[candidate.path] = { ...metadata[candidate.path], description };
		updated += 1;
	} catch (error) {
		skipped += 1;
		console.warn(`${candidate.path}\n  Skipped: ${error.message}`);
	}
}

if (dryRun) {
	console.log(`\nDry run only. ${updated} update(s) proposed; ${skipped} skipped.`);
	process.exit(0);
}

await writeGeneratedToolMetadata(metadata, root);
console.log(`\nUpdated ${updated} page description(s) in ${path.relative(root, path.join(root, 'src/data/generated-tool-metadata'))}; ${skipped} skipped.`);

async function generateDescription({ title, description, locale }) {
	const language = locale === 'de' ? 'German' : 'English';
	const prompt = [
		`Write one SEO-friendly meta description in ${language} for a browser-based creator tool named “${title}”.`,
		'Target 125–145 characters. Be accurate and clear; use no call to action, quote marks, or unsupported claims.',
		`Keep client-side/local processing claims only when already stated. Existing description: ${description}`,
		'Return JSON only: {"description":"..."}',
	].join('\n');
	const parsed = await requestOllamaJson({
		ollamaUrl,
		model,
		prompt,
		validate: (value) => validMetaDescription(fitMetaDescription(generatedDescriptionValue(value), { title, locale })),
	});
	return fitMetaDescription(generatedDescriptionValue(parsed), { title, locale });
}

function optionValue(name) {
	const index = args.indexOf(name);
	if (index !== -1) return args[index + 1];
	return args.find((argument) => argument.startsWith(`${name}=`))?.slice(name.length + 1);
}
