import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const GENERATED_TOOL_METADATA_PATH = 'src/data/generated-tool-metadata.json';

export async function loadToolCandidates(root = process.cwd()) {
	const toolsDirectory = path.join(root, 'src/data/tools');
	const files = await listAstroFiles(toolsDirectory);
	const candidates = [];

	for (const filePath of files) {
		const source = await readFile(filePath, 'utf8');
		candidates.push(...parseAstroToolCandidates(source, filePath));
	}

	const virtualModuleUrl = pathToFileURL(path.join(root, 'src/data/virtual-converters.ts'));
	virtualModuleUrl.searchParams.set('cache', String(Date.now()));
	const { virtualConverterPages } = await import(virtualModuleUrl.href);
	for (const page of virtualConverterPages) {
		candidates.push({
			path: page.path,
			title: page.title,
			description: page.description,
			locale: page.locale,
			filePath: path.join(root, 'src/data/virtual-converters.ts'),
			virtual: true,
		});
	}

	return [...new Map(candidates.map((candidate) => [candidate.path, candidate])).values()]
		.sort((left, right) => left.path.localeCompare(right.path));
}

export function parseAstroToolCandidates(source, filePath = '') {
	const candidates = [];

	for (const match of source.matchAll(/description:\s*(['"])([^'"\n]+)\1/g)) {
		const before = source.slice(Math.max(0, (match.index ?? 0) - 1200), match.index);
		const pathMatches = [...before.matchAll(/path:\s*(['"])(\/[^'"\n]+)\1/g)];
		const titleMatches = [...before.matchAll(/title:\s*(['"])([^'"\n]+)\1/g)];
		const pagePath = pathMatches.at(-1)?.[2];
		const title = titleMatches.at(-1)?.[2];
		if (!pagePath || !title || !/^\/(de|en)\//.test(pagePath)) continue;
		candidates.push({
			path: pagePath,
			title,
			description: match[2],
			locale: pagePath.startsWith('/de/') ? 'de' : 'en',
			filePath,
			virtual: false,
		});
	}

	return candidates;
}

export async function readGeneratedToolMetadata(root = process.cwd()) {
	const filePath = path.join(root, GENERATED_TOOL_METADATA_PATH);
	try {
		return JSON.parse(await readFile(filePath, 'utf8'));
	} catch (error) {
		if (error?.code === 'ENOENT') return {};
		throw error;
	}
}

export async function writeGeneratedToolMetadata(metadata, root = process.cwd()) {
	const sorted = Object.fromEntries(Object.entries(metadata).sort(([left], [right]) => left.localeCompare(right)));
	await writeFile(path.join(root, GENERATED_TOOL_METADATA_PATH), `${JSON.stringify(sorted, null, '\t')}\n`);
}

export function normalizeGeneratedText(value) {
	return String(value || '').replace(/\s+/g, ' ').trim();
}

export function validMetaDescription(value) {
	const text = normalizeGeneratedText(value);
	return text.length >= 110 && text.length <= 155 && !/[\r\n<>]/.test(text);
}

export function generatedDescriptionValue(value) {
	if (!value || typeof value !== 'object') return '';
	return normalizeGeneratedText(value.description ?? value.metaDescription ?? value.meta_description);
}

export function fitMetaDescription(value, { title = '', locale = 'en' } = {}) {
	let text = normalizeGeneratedText(value)
		.replace(/^(?:meta\s+description|description|beschreibung)\s*:\s*/i, '')
		.replace(/^["“”']+|["“”']+$/g, '')
		.trim();

	if (text.length < 110 && title && !text.toLocaleLowerCase(locale).includes(title.toLocaleLowerCase(locale))) {
		text = `${title}: ${text}`;
	}

	if (text.length < 110) {
		const suffix = locale === 'de'
			? ' – ein praktischer Browser-Workflow für Creator.'
			: ' — a practical browser workflow for creators.';
		text = `${text.replace(/[.!?]+$/, '')}${suffix}`;
	}

	if (text.length < 110) {
		const suffix = locale === 'de'
			? ' Mit einer klaren, übersichtlichen Oberfläche.'
			: ' With a clear, focused interface.';
		text = `${text}${suffix}`;
	}

	if (text.length > 155) {
		const truncated = text.slice(0, 155);
		const lastSpace = truncated.lastIndexOf(' ');
		text = (lastSpace >= 110 ? truncated.slice(0, lastSpace) : truncated)
			.replace(/[,:;.!?–—-]+$/, '')
			.trimEnd();
	}

	return text;
}

export function parseJsonResponse(value) {
	const source = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
	try {
		return JSON.parse(source);
	} catch {
		const object = source.match(/\{[\s\S]*\}/)?.[0];
		if (!object) throw new Error('Ollama returned invalid JSON.');
		return JSON.parse(object);
	}
}

export async function requestOllamaJson({ ollamaUrl, model, prompt, attempts = 3, validate = () => true }) {
	let feedback = '';
	let lastError;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			const response = await fetch(`${ollamaUrl}/api/generate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					model,
					prompt: `${prompt}${feedback}`,
					stream: false,
					format: 'json',
					options: { temperature: attempt === 1 ? 0.2 : 0.1 },
				}),
			});
			if (!response.ok) throw new Error(`Ollama request failed (${response.status} ${response.statusText}).`);
			const payload = await response.json();
			const parsed = parseJsonResponse(payload.response);
			if (validate(parsed)) return parsed;
			lastError = new Error('Ollama returned JSON that failed validation.');
			feedback = '\nYour previous response failed validation. Check every requested field and character limit exactly, then return corrected JSON only.';
		} catch (error) {
			lastError = error;
			feedback = '\nThe previous response was invalid. Return one complete, valid JSON object only.';
		}
	}

	throw lastError || new Error('Ollama did not return valid JSON.');
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
