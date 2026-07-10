#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'public', 'games', 'mp3guesser');
const HISTORY_PATH = path.join(OUTPUT_ROOT, 'history.json');
const GAME_DATE = process.env.MP3_GUESSER_DATE || new Date().toISOString().slice(0, 10);
const WORK_ROOT = path.join(tmpdir(), `kwm-mp3-guesser-${GAME_DATE}-${process.pid}`);
const MIN_DURATION_SECONDS = Number(process.env.MP3_GUESSER_MIN_SECONDS || 5);
const MAX_DURATION_SECONDS = Number(process.env.MP3_GUESSER_MAX_SECONDS || 30);
const MAX_SOURCE_BYTES = Number(process.env.MP3_GUESSER_MAX_SOURCE_BYTES || 250 * 1024 * 1024);
const KEEP_DAYS = Number(process.env.MP3_GUESSER_KEEP_DAYS || 1);
const HISTORY_DAYS = Number(process.env.MP3_GUESSER_HISTORY_DAYS || 180);
const USER_AGENT = process.env.MP3_GUESSER_USER_AGENT || 'kw.media MP3 Guesser generator/1.0 (https://kw.media)';
const FREESOUND_API_TOKEN = process.env.FREESOUND_API_TOKEN || '';
const FREESOUND_OAUTH_TOKEN = process.env.FREESOUND_OAUTH_TOKEN || '';
const LEVELS = [
	{ id: 'v9', label: 'LAME V9 VBR (~65 kbps)', lameQuality: 9 },
	{ id: 'v7', label: 'LAME V7 VBR (~100 kbps)', lameQuality: 7 },
	{ id: 'v5', label: 'LAME V5 VBR (~130 kbps)', lameQuality: 5 },
	{ id: 'v3', label: 'LAME V3 VBR (~175 kbps)', lameQuality: 3 },
	{ id: 'v0', label: 'LAME V0 VBR (~245 kbps)', lameQuality: 0 },
];
const ACCEPTED_EXTENSIONS = new Set(['.flac', '.wav']);
const LINEAR_PCM_CODECS = new Set([
	'pcm_s8',
	'pcm_s16be',
	'pcm_s16le',
	'pcm_s24be',
	'pcm_s24le',
	'pcm_s32be',
	'pcm_s32le',
	'pcm_s64be',
	'pcm_s64le',
	'pcm_u8',
	'pcm_u16be',
	'pcm_u16le',
	'pcm_u24be',
	'pcm_u24le',
	'pcm_u32be',
	'pcm_u32le',
	'pcm_f32be',
	'pcm_f32le',
	'pcm_f64be',
	'pcm_f64le',
]);

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});

async function main() {
	await ensureCommand('ffmpeg');
	await ensureCommand('ffprobe');
	await mkdir(WORK_ROOT, { recursive: true });
	await mkdir(OUTPUT_ROOT, { recursive: true });

	try {
		const providerFactories = [
			['Wikimedia Commons', getWikimediaCommonsCandidates],
			['Freesound', getFreesoundCandidates],
			['Internet Archive', getInternetArchiveCandidates],
		];
		const attempts = [];
		let sourceHistory = pruneSourceHistory(await loadSourceHistory());
		const usedSourceUrls = new Set(sourceHistory.map((entry) => normalizeHistoryUrl(entry.url)).filter(Boolean));

		for (const [providerName, factory] of providerFactories) {
			console.log(`Collecting candidates from ${providerName}...`);
			let candidates = [];

			try {
				candidates = await factory();
			} catch (error) {
				attempts.push(`${providerName}: candidate lookup failed: ${error.message}`);
				console.warn(`${providerName}: candidate lookup failed: ${error.message}`);
				continue;
			}

			const candidateCount = candidates.length;
			candidates = candidates.filter((candidate) => !usedSourceUrls.has(candidateHistoryKey(candidate)));
			const skippedCount = candidateCount - candidates.length;
			console.log(`${providerName}: ${candidates.length} candidate(s)${skippedCount ? `, skipped ${skippedCount} recently used` : ''}`);

			for (const candidate of candidates) {
				try {
					const manifest = await buildGameFromCandidate(candidate);
					await publishGame(manifest);
					sourceHistory = await updateSourceHistory(sourceHistory, manifest);
					await cleanupOldGames();
					console.log(`Generated MP3 Guesser for ${GAME_DATE} from ${candidate.provider}: ${candidate.title}`);
					return;
				} catch (error) {
					attempts.push(`${candidate.provider} / ${candidate.title}: ${error.message}`);
					console.warn(`Skipping candidate: ${candidate.provider} / ${candidate.title}: ${error.message}`);
				}
			}
		}

		throw new Error(`No usable lossless source found.\n${attempts.map((attempt) => `- ${attempt}`).join('\n')}`);
	} finally {
		await rm(WORK_ROOT, { recursive: true, force: true });
	}
}

async function buildGameFromCandidate(candidate) {
	const extension = getCandidateExtension(candidate);
	const sourcePath = path.join(WORK_ROOT, `source${extension}`);
	const encodedRoot = path.join(WORK_ROOT, 'encoded');
	const originalPath = path.join(encodedRoot, 'original.wav');

	await mkdir(encodedRoot, { recursive: true });
	await downloadCandidate(candidate, sourcePath);

	const sourceProbe = await probeAudio(sourcePath);
	validateSourceProbe(sourceProbe, extension);

	const duration = Math.min(sourceProbe.duration, MAX_DURATION_SECONDS);

	await run('ffmpeg', [
		'-hide_banner',
		'-loglevel',
		'error',
		'-y',
		'-i',
		sourcePath,
		'-map',
		'0:a:0',
		'-vn',
		'-t',
		String(MAX_DURATION_SECONDS),
		'-codec:a',
		'pcm_s16le',
		originalPath,
	]);

	const originalProbe = await probeAudio(originalPath);
	const manifest = {
		version: 1,
		date: GAME_DATE,
		generatedAt: new Date().toISOString(),
		duration: Math.min(originalProbe.duration, duration),
		source: {
			provider: candidate.provider,
			title: candidate.title,
			creator: candidate.creator || '',
			license: candidate.license || '',
			licenseUrl: candidate.licenseUrl || '',
			sourceUrl: candidate.sourceUrl || '',
			downloadUrl: candidate.publicDownloadUrl || candidate.downloadUrl || '',
			duration: sourceProbe.duration,
			format: extension.slice(1).toUpperCase(),
		},
		levels: [],
	};

	for (const level of LEVELS) {
		const options = [
			{
				id: `${level.id}-original`,
				kind: 'original',
				url: `/games/mp3guesser/${GAME_DATE}/original.wav`,
			},
		];

		for (let copyIndex = 1; copyIndex <= 2; copyIndex += 1) {
			const filename = `${level.id}-${copyIndex}.mp3`;
			const outputPath = path.join(encodedRoot, filename);

			await run('ffmpeg', [
				'-hide_banner',
				'-loglevel',
				'error',
				'-y',
				'-i',
				originalPath,
				'-map',
				'0:a:0',
				'-vn',
				'-codec:a',
				'libmp3lame',
				'-q:a',
				String(level.lameQuality),
				'-map_metadata',
				'-1',
				outputPath,
			]);

			options.push({
				id: `${level.id}-encode-${copyIndex}`,
				kind: 'encode',
				url: `/games/mp3guesser/${GAME_DATE}/${filename}`,
			});
		}

		manifest.levels.push({
			id: level.id,
			label: level.label,
			lameQuality: level.lameQuality,
			options: shuffle(options, hashString(`${GAME_DATE}:${level.id}`)),
		});
	}

	const dayOutput = path.join(WORK_ROOT, 'day-output');
	await rm(dayOutput, { recursive: true, force: true });
	await cp(encodedRoot, dayOutput, { recursive: true });
	await writeFile(path.join(dayOutput, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
	manifest.__dayOutput = dayOutput;

	return manifest;
}

async function publishGame(manifest) {
	const dayOutput = manifest.__dayOutput;
	const publicManifest = { ...manifest };
	delete publicManifest.__dayOutput;

	const dayDir = path.join(OUTPUT_ROOT, GAME_DATE);
	await rm(dayDir, { recursive: true, force: true });
	await cp(dayOutput, dayDir, { recursive: true });
	await writeFile(path.join(dayDir, 'manifest.json'), `${JSON.stringify(publicManifest, null, 2)}\n`);
	await writeFile(path.join(OUTPUT_ROOT, 'daily.json'), `${JSON.stringify(publicManifest, null, 2)}\n`);
}

async function cleanupOldGames() {
	if (!Number.isFinite(KEEP_DAYS) || KEEP_DAYS <= 0) {
		return;
	}

	const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true });
	const datedDirectories = entries
		.filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
		.map((entry) => entry.name)
		.sort()
		.reverse();
	const keep =
		KEEP_DAYS === 1 ? new Set([GAME_DATE]) : new Set([...datedDirectories.slice(0, KEEP_DAYS), GAME_DATE]);

	for (const directory of datedDirectories) {
		if (!keep.has(directory)) {
			await rm(path.join(OUTPUT_ROOT, directory), { recursive: true, force: true });
		}
	}
}

async function loadSourceHistory() {
	try {
		const data = JSON.parse(await readFile(HISTORY_PATH, 'utf8'));
		return Array.isArray(data) ? data : [];
	} catch (error) {
		if (error.code === 'ENOENT') {
			return [];
		}

		throw error;
	}
}

async function updateSourceHistory(history, manifest) {
	const entry = sourceHistoryEntry(manifest);

	if (!entry) {
		return history;
	}

	const entryUrl = normalizeHistoryUrl(entry.url);
	const nextHistory = pruneSourceHistory(history)
		.filter((historyEntry) => normalizeHistoryUrl(historyEntry.url) !== entryUrl)
		.concat(entry);

	await writeFile(HISTORY_PATH, `${JSON.stringify(nextHistory, null, 2)}\n`);
	return nextHistory;
}

function pruneSourceHistory(history) {
	const entries = Array.isArray(history) ? history : [];

	if (!Number.isFinite(HISTORY_DAYS) || HISTORY_DAYS <= 0) {
		return entries;
	}

	const cutoff = Date.parse(`${GAME_DATE}T00:00:00.000Z`) - HISTORY_DAYS * 24 * 60 * 60 * 1000;

	return entries.filter((entry) => {
		const timestamp = Date.parse(`${entry.date}T00:00:00.000Z`);
		return Number.isFinite(timestamp) && timestamp >= cutoff;
	});
}

function sourceHistoryEntry(manifest) {
	const source = manifest.source || {};
	const url = source.sourceUrl || source.downloadUrl;

	if (!url) {
		return null;
	}

	return {
		date: manifest.date || GAME_DATE,
		provider: source.provider || '',
		title: source.title || '',
		url,
		downloadUrl: source.downloadUrl || '',
	};
}

function candidateHistoryKey(candidate) {
	return normalizeHistoryUrl(candidate.sourceUrl || candidate.publicDownloadUrl || candidate.downloadUrl);
}

async function getWikimediaCommonsCandidates() {
	const commonsApi = 'https://commons.wikimedia.org/w/api.php';
	const formatTitles = new Set([
		...(await getCommonsCategoryFileTitles('Category:FLAC files', 1500)),
		...(await getCommonsCategoryFileTitles('Category:WAV files', 1500)),
	]);
	const titles = [...formatTitles].filter((title) => ACCEPTED_EXTENSIONS.has(path.extname(title).toLowerCase()));
	const shuffledTitles = shuffle(titles, hashString(`${GAME_DATE}:commons`)).slice(0, 80);
	const candidates = [];

	for (const batch of chunk(shuffledTitles, 25)) {
		const url = new URL(commonsApi);
		url.searchParams.set('action', 'query');
		url.searchParams.set('format', 'json');
		url.searchParams.set('formatversion', '2');
		url.searchParams.set('prop', 'imageinfo');
		url.searchParams.set('titles', batch.join('|'));
		url.searchParams.set('iiprop', 'url|mime|size|extmetadata');
		url.searchParams.set('iiextmetadatafilter', 'Artist|Credit|LicenseShortName|LicenseUrl|ObjectName|ImageDescription');

		const data = await fetchJson(url);
		const pages = data.query?.pages || [];

		for (const page of pages) {
			const info = page.imageinfo?.[0];

			if (!info?.url) {
				continue;
			}

			const extension = path.extname(page.title).toLowerCase();

			if (!ACCEPTED_EXTENSIONS.has(extension) || Number(info.size || 0) > MAX_SOURCE_BYTES) {
				continue;
			}

			candidates.push({
				provider: 'Wikimedia Commons',
				title: cleanText(readCommonsMetadata(info.extmetadata, 'ObjectName')) || page.title.replace(/^File:/, ''),
				creator:
					cleanText(readCommonsMetadata(info.extmetadata, 'Artist')) ||
					cleanText(readCommonsMetadata(info.extmetadata, 'Credit')),
				license: cleanText(readCommonsMetadata(info.extmetadata, 'LicenseShortName')),
				licenseUrl: cleanText(readCommonsMetadata(info.extmetadata, 'LicenseUrl')),
				sourceUrl: commonsFileUrl(page.title),
				downloadUrl: info.url,
				publicDownloadUrl: info.descriptionurl || info.url,
				bytes: Number(info.size || 0),
				type: extension.slice(1),
			});
		}
	}

	return candidates;
}

async function getCommonsCategoryFileTitles(category, limit) {
	const titles = [];
	let cmcontinue;

	while (titles.length < limit) {
		const url = new URL('https://commons.wikimedia.org/w/api.php');
		url.searchParams.set('action', 'query');
		url.searchParams.set('format', 'json');
		url.searchParams.set('formatversion', '2');
		url.searchParams.set('list', 'categorymembers');
		url.searchParams.set('cmtitle', category);
		url.searchParams.set('cmtype', 'file');
		url.searchParams.set('cmlimit', '500');
		url.searchParams.set('cmprop', 'title');

		if (cmcontinue) {
			url.searchParams.set('cmcontinue', cmcontinue);
		}

		const data = await fetchJson(url);
		const members = data.query?.categorymembers || [];
		titles.push(...members.map((member) => member.title));
		cmcontinue = data.continue?.cmcontinue;

		if (!cmcontinue || members.length === 0) {
			break;
		}
	}

	return titles.slice(0, limit);
}

async function getFreesoundCandidates() {
	if (!FREESOUND_API_TOKEN && !FREESOUND_OAUTH_TOKEN) {
		console.log('Freesound: FREESOUND_API_TOKEN or FREESOUND_OAUTH_TOKEN not set, skipping.');
		return [];
	}

	const headers = freesoundHeaders(false);
	const candidates = [];

	for (let page = 1; page <= 3; page += 1) {
		const url = new URL('https://freesound.org/apiv2/search/');
		url.searchParams.set('query', '');
		url.searchParams.set('filter', `duration:[${MIN_DURATION_SECONDS} TO *] type:(wav OR flac)`);
		url.searchParams.set('sort', 'downloads_desc');
		url.searchParams.set('group_by_pack', '1');
		url.searchParams.set('page_size', '50');
		url.searchParams.set('page', String(page));
		url.searchParams.set(
			'fields',
			'id,name,username,license,duration,type,filesize,download,url,num_downloads,avg_rating',
		);

		const data = await fetchJson(url, { headers });

		for (const result of data.results || []) {
			const type = String(result.type || '').toLowerCase();

			if (!['wav', 'flac'].includes(type) || Number(result.duration || 0) < MIN_DURATION_SECONDS) {
				continue;
			}

			if (Number(result.filesize || 0) > MAX_SOURCE_BYTES) {
				continue;
			}

			candidates.push({
				provider: 'Freesound',
				title: cleanText(result.name) || `Freesound ${result.id}`,
				creator: cleanText(result.username),
				license: cleanText(result.license),
				licenseUrl: freesoundLicenseUrl(result.license),
				sourceUrl: result.url || `https://freesound.org/s/${result.id}/`,
				downloadUrl: result.download,
				publicDownloadUrl: result.url || `https://freesound.org/s/${result.id}/`,
				bytes: Number(result.filesize || 0),
				duration: Number(result.duration || 0),
				type,
				headers: freesoundHeaders(true),
			});
		}
	}

	return shuffle(candidates, hashString(`${GAME_DATE}:freesound`)).slice(0, 80);
}

async function getInternetArchiveCandidates() {
	const documents = [];

	for (let page = 1; page <= 4; page += 1) {
		const url = new URL('https://archive.org/advancedsearch.php');
		url.searchParams.set('q', 'mediatype:audio AND format:FLAC');
		url.searchParams.append('fl[]', 'identifier');
		url.searchParams.append('fl[]', 'title');
		url.searchParams.append('fl[]', 'creator');
		url.searchParams.append('fl[]', 'licenseurl');
		url.searchParams.append('fl[]', 'downloads');
		url.searchParams.append('sort[]', 'downloads desc');
		url.searchParams.set('rows', '50');
		url.searchParams.set('page', String(page));
		url.searchParams.set('output', 'json');

		const data = await fetchJson(url);
		documents.push(...(data.response?.docs || []));
	}

	const candidates = [];
	const shuffledDocuments = shuffle(documents, hashString(`${GAME_DATE}:internet-archive`)).slice(0, 100);

	for (const document of shuffledDocuments) {
		if (!document.identifier) {
			continue;
		}

		try {
			const metadata = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(document.identifier)}`);
			const files = metadata.files || [];
			const flacFiles = files
				.filter((file) => path.extname(file.name || '').toLowerCase() === '.flac')
				.filter((file) => Number(file.size || 0) > 0 && Number(file.size || 0) <= MAX_SOURCE_BYTES)
				.sort((first, second) => Number(first.size || 0) - Number(second.size || 0));
			const file = flacFiles[0];

			if (!file) {
				continue;
			}

			const title = cleanText(metadata.metadata?.title || document.title || document.identifier);
			const creator = cleanText(firstValue(metadata.metadata?.creator || document.creator));
			const licenseUrl = cleanText(firstValue(metadata.metadata?.licenseurl || document.licenseurl));

			candidates.push({
				provider: 'Internet Archive',
				title,
				creator,
				license: licenseUrl ? licenseNameFromUrl(licenseUrl) : '',
				licenseUrl,
				sourceUrl: `https://archive.org/details/${encodeURIComponent(document.identifier)}`,
				downloadUrl: `https://archive.org/download/${encodeURIComponent(document.identifier)}/${encodeArchivePath(file.name)}`,
				publicDownloadUrl: `https://archive.org/details/${encodeURIComponent(document.identifier)}`,
				bytes: Number(file.size || 0),
				duration: Number(file.length || 0),
				type: 'flac',
			});
		} catch (error) {
			console.warn(`Internet Archive metadata failed for ${document.identifier}: ${error.message}`);
		}
	}

	return candidates;
}

async function downloadCandidate(candidate, outputPath) {
	const extension = getCandidateExtension(candidate);

	if (!ACCEPTED_EXTENSIONS.has(extension)) {
		throw new Error(`source is not FLAC or WAV: ${extension || 'unknown'}`);
	}

	if (!candidate.downloadUrl) {
		throw new Error('candidate has no original download URL');
	}

	if (candidate.bytes && Number(candidate.bytes) > MAX_SOURCE_BYTES) {
		throw new Error(`source is too large (${candidate.bytes} bytes)`);
	}

	await downloadFile(candidate.downloadUrl, outputPath, {
		headers: candidate.headers,
		maxBytes: MAX_SOURCE_BYTES,
	});

	const fileStats = await stat(outputPath);

	if (fileStats.size === 0) {
		throw new Error('downloaded source is empty');
	}
}

async function downloadFile(url, outputPath, options = {}) {
	const headers = {
		'User-Agent': USER_AGENT,
		Accept: 'audio/flac,audio/wav,audio/x-wav,audio/*,*/*',
		...(options.headers || {}),
	};
	const response = await fetch(url, { headers, redirect: 'follow' });

	if (!response.ok) {
		throw new Error(`download failed with HTTP ${response.status}`);
	}

	const contentLength = Number(response.headers.get('content-length') || 0);

	if (contentLength > options.maxBytes) {
		throw new Error(`download is too large (${contentLength} bytes)`);
	}

	let written = 0;
	const file = createWriteStream(outputPath, { flags: 'w' });

	try {
		for await (const chunk of response.body) {
			written += chunk.byteLength;

			if (written > options.maxBytes) {
				throw new Error(`download exceeded ${options.maxBytes} bytes`);
			}

			if (!file.write(chunk)) {
				await onceDrain(file);
			}
		}
	} catch (error) {
		file.destroy();
		await rm(outputPath, { force: true });
		throw error;
	}

	await new Promise((resolve, reject) => {
		file.end((error) => (error ? reject(error) : resolve()));
	});
}

async function probeAudio(filePath) {
	const output = await run('ffprobe', [
		'-v',
		'error',
		'-show_entries',
		'format=duration,format_name:stream=codec_type,codec_name',
		'-of',
		'json',
		filePath,
	]);
	const data = JSON.parse(output.stdout);
	const audioStream = (data.streams || []).find((stream) => stream.codec_type === 'audio');

	if (!audioStream) {
		throw new Error('source has no audio stream');
	}

	return {
		codecName: audioStream.codec_name,
		formatName: data.format?.format_name || '',
		duration: Number(data.format?.duration || 0),
	};
}

function validateSourceProbe(probe, extension) {
	if (!Number.isFinite(probe.duration) || probe.duration < MIN_DURATION_SECONDS) {
		throw new Error(`source is shorter than ${MIN_DURATION_SECONDS}s`);
	}

	if (extension === '.flac' && probe.codecName !== 'flac') {
		throw new Error(`FLAC candidate decoded as ${probe.codecName}, rejecting`);
	}

	if (extension === '.wav' && !LINEAR_PCM_CODECS.has(probe.codecName)) {
		throw new Error(`WAV candidate uses ${probe.codecName}, rejecting non-linear/lossy WAV`);
	}
}

async function ensureCommand(command) {
	try {
		await run(command, ['-version']);
	} catch {
		throw new Error(`${command} is required for MP3 Guesser generation`);
	}
}

function run(command, args) {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		const stdout = [];
		const stderr = [];

		child.stdout.on('data', (chunk) => stdout.push(chunk));
		child.stderr.on('data', (chunk) => stderr.push(chunk));
		child.on('error', reject);
		child.on('close', (code) => {
			const result = {
				stdout: Buffer.concat(stdout).toString('utf8'),
				stderr: Buffer.concat(stderr).toString('utf8'),
			};

			if (code === 0) {
				resolve(result);
				return;
			}

			reject(new Error(`${command} ${args.join(' ')} failed with ${code}: ${result.stderr.trim()}`));
		});
	});
}

async function fetchJson(url, options = {}) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), Number(process.env.MP3_GUESSER_FETCH_TIMEOUT_MS || 45000));
	const headers = {
		'User-Agent': USER_AGENT,
		Accept: 'application/json',
		...(options.headers || {}),
	};

	try {
		const response = await fetch(url, {
			...options,
			headers,
			signal: controller.signal,
		});

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new Error(`HTTP ${response.status} from ${url}: ${body.slice(0, 200)}`);
		}

		return response.json();
	} finally {
		clearTimeout(timeout);
	}
}

function getCandidateExtension(candidate) {
	const type = String(candidate.type || '').toLowerCase();

	if (type === 'flac' || type === 'wav') {
		return `.${type}`;
	}

	try {
		const extension = path.extname(new URL(candidate.downloadUrl).pathname).toLowerCase();
		return extension;
	} catch {
		return '';
	}
}

function normalizeHistoryUrl(url) {
	const value = String(url || '').trim();

	if (!value) {
		return '';
	}

	try {
		const parsedUrl = new URL(value);
		parsedUrl.hash = '';
		parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
		parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, '');
		return parsedUrl.toString();
	} catch {
		return value.replace(/\/+$/, '');
	}
}

function readCommonsMetadata(metadata, key) {
	return metadata?.[key]?.value || '';
}

function commonsFileUrl(title) {
	return `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replaceAll(' ', '_'))}`;
}

function freesoundHeaders(forDownload) {
	if (forDownload && FREESOUND_OAUTH_TOKEN) {
		return { Authorization: `Bearer ${FREESOUND_OAUTH_TOKEN}` };
	}

	if (FREESOUND_API_TOKEN) {
		return { Authorization: `Token ${FREESOUND_API_TOKEN}` };
	}

	if (FREESOUND_OAUTH_TOKEN) {
		return { Authorization: `Bearer ${FREESOUND_OAUTH_TOKEN}` };
	}

	return {};
}

function freesoundLicenseUrl(license) {
	const normalized = String(license || '').toLowerCase();

	if (normalized.includes('zero') || normalized === 'cc0') {
		return 'https://creativecommons.org/publicdomain/zero/1.0/';
	}

	if (normalized.includes('noncommercial')) {
		return 'https://creativecommons.org/licenses/by-nc/4.0/';
	}

	if (normalized.includes('attribution')) {
		return 'https://creativecommons.org/licenses/by/4.0/';
	}

	return '';
}

function licenseNameFromUrl(url) {
	const value = String(url || '').toLowerCase();

	if (value.includes('/by-nc/')) {
		return 'CC BY-NC';
	}

	if (value.includes('/by-sa/')) {
		return 'CC BY-SA';
	}

	if (value.includes('/by/')) {
		return 'CC BY';
	}

	if (value.includes('/zero/')) {
		return 'CC0';
	}

	return '';
}

function encodeArchivePath(filePath) {
	return filePath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function firstValue(value) {
	return Array.isArray(value) ? value[0] : value;
}

function cleanText(value) {
	return decodeHtmlEntities(String(firstValue(value) || ''))
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function decodeHtmlEntities(value) {
	return value
		.replaceAll('&amp;', '&')
		.replaceAll('&quot;', '"')
		.replaceAll('&#039;', "'")
		.replaceAll('&#39;', "'")
		.replaceAll('&lt;', '<')
		.replaceAll('&gt;', '>')
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function chunk(items, size) {
	const chunks = [];

	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}

	return chunks;
}

function shuffle(items, seed) {
	const result = [...items];
	const random = mulberry32(seed);

	for (let index = result.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		[result[index], result[swapIndex]] = [result[swapIndex], result[index]];
	}

	return result;
}

function hashString(value) {
	let hash = 2166136261;

	for (const character of value) {
		hash ^= character.codePointAt(0);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

function mulberry32(seed) {
	return () => {
		let value = (seed += 0x6d2b79f5);
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

function onceDrain(stream) {
	return new Promise((resolve, reject) => {
		stream.once('drain', resolve);
		stream.once('error', reject);
	});
}
