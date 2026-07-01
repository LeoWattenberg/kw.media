import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { cleanupPostFile, translatePostFile } from './content-ai.mjs';

const playlists = [
	{
		url: 'https://www.youtube.com/playlist?list=PLpM9DoCHlaQHdyH6R1XWPYmQLsrif1Y9F',
		defaultWatchKind: 'shorts',
		category: 'short-tutorial',
	},
	{
		url: 'https://www.youtube.com/playlist?list=PLpM9DoCHlaQFlsYdZiGUVG3eREZTs706N',
		defaultWatchKind: 'watch',
		category: 'video-tutorial',
	},
	{
		url: 'https://www.youtube.com/playlist?list=PLpM9DoCHlaQHzYpHUvIH5GECRL7rtA4F1',
		defaultWatchKind: 'watch',
		category: 'news-video',
	},
	{
		url: 'https://www.youtube.com/playlist?list=PLpM9DoCHlaQFDdZFQMkx27Jp9CB2x4uI3',
		defaultWatchKind: 'watch',
		category: 'audacity',
		postType: 'audacity',
		pathPrefix: '/audacity',
		authorName: 'Leo Wattenberg',
		translate: false,
	},
];

const postsDir = join(process.cwd(), 'src/data/posts');
const postDirectories = {
	blog: {
		de: join(postsDir, 'blog/de'),
		en: join(postsDir, 'blog/en'),
	},
	video: {
		de: join(postsDir, 'video/de'),
		en: join(postsDir, 'video/en'),
	},
	audacity: {
		de: join(postsDir, 'audacity'),
		en: join(postsDir, 'audacity'),
	},
};
const localYtDlp = join(process.cwd(), 'scripts/yt-dlp');
const ytDlpCommand = (process.env.YT_DLP_COMMAND ?? localYtDlp).split(/\s+/).filter(Boolean);

function runYtDlp(args, options = {}) {
	return execFileSync(ytDlpCommand[0], [...ytDlpCommand.slice(1), ...args], {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024 * 128,
		stdio: ['ignore', 'pipe', options.quiet ? 'pipe' : 'inherit'],
	});
}

function readPosts() {
	const files = [];
	const readDirectory = (directory) => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const filePath = join(directory, entry.name);
			if (entry.isDirectory()) {
				readDirectory(filePath);
			} else if (entry.isFile() && entry.name.endsWith('.md')) {
				files.push({
					fileName: entry.name,
					content: readFileSync(filePath, 'utf8'),
				});
			}
		}
	};

	readDirectory(postsDir);
	return files;
}

function extractExistingVideoIds(posts) {
	return new Set(
		posts
			.map((post) => post.content.match(/^\s+youtubeId:\s*"([^"]+)"/m)?.[1])
			.filter(Boolean),
	);
}

function extractMaxId(posts) {
	return Math.max(
		0,
		...posts.map((post) => Number(post.content.match(/^id:\s*(\d+)/m)?.[1] ?? 0)),
	);
}

function extractExistingSlugs(posts) {
	return new Set(posts.map((post) => basename(post.fileName, '.md')));
}

function parseYtDlpValue(value) {
	if (value === 'NA') {
		return null;
	}

	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}

function parseMetadataLine(line) {
	const [id, title, uploadDate, timestamp, language, duration, description] = line.trim().split('\t').map(parseYtDlpValue);
	return { id, title, uploadDate, timestamp, language, duration, description };
}

function flatPlaylistEntries(playlistUrl) {
	const playlist = JSON.parse(runYtDlp(['--flat-playlist', '--dump-single-json', playlistUrl]));
	return (playlist.entries ?? []).filter((entry) => entry?.id);
}

function videoMetadata(videoId) {
	const line = runYtDlp([
		'--skip-download',
		'--no-warnings',
		'--print',
		'%(id)j\t%(title)j\t%(upload_date)j\t%(timestamp)j\t%(language)j\t%(duration)j\t%(description)j',
		`https://www.youtube.com/watch?v=${videoId}`,
	]);

	return parseMetadataLine(line);
}

function likelyGerman(text) {
	return /\b(und|oder|wie|was|ist|das|der|die|den|euch|dein|deinen|keine|für|über|nicht)\b/i.test(text)
		|| /[äöüß]/i.test(text);
}

function localeFor(metadata) {
	if (metadata.language?.toLowerCase().startsWith('de')) {
		return 'de';
	}

	if (metadata.language?.toLowerCase().startsWith('en')) {
		return 'en';
	}

	return likelyGerman(metadata.title) ? 'de' : 'en';
}

function slugify(input, locale) {
	const ampersand = locale === 'de' ? ' und ' : ' and ';

	return input
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/ß/g, 'ss')
		.replace(/&/g, ampersand)
		.replace(/['’]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
}

function uniqueSlug(baseSlug, existingSlugs) {
	let slug = baseSlug;
	let counter = 2;

	while (existingSlugs.has(slug) || postFileExists(slug)) {
		slug = `${baseSlug}-${counter}`;
		counter += 1;
	}

	existingSlugs.add(slug);
	return slug;
}

function postFileExists(slug) {
	return Object.values(postDirectories).some((directories) => (
		Object.values(directories).some((directory) => existsSync(join(directory, `${slug}.md`)))
	));
}

function postOutputDirectory(type, locale) {
	const directory = postDirectories[type]?.[locale];
	if (!directory) {
		throw new Error(`Unsupported post output target: ${type}/${locale}`);
	}

	mkdirSync(directory, { recursive: true });
	return directory;
}

function isoDate(timestamp, uploadDate) {
	if (timestamp) {
		return new Date(timestamp * 1000).toISOString().replace(/\.\d{3}Z$/, '');
	}

	if (/^\d{8}$/.test(uploadDate ?? '')) {
		return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}T00:00:00`;
	}

	return new Date().toISOString().replace(/\.\d{3}Z$/, '');
}

function decodeEntities(text) {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function parseVtt(filePath) {
	const raw = readFileSync(filePath, 'utf8');
	const cues = [];

	for (const block of raw.split(/\n\s*\n/)) {
		const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		if (!lines.length || lines[0].startsWith('WEBVTT') || lines[0].startsWith('Kind:') || lines[0].startsWith('Language:')) {
			continue;
		}

		const timestampIndex = lines.findIndex((line) => /-->/.test(line));
		if (timestampIndex === -1) {
			continue;
		}

		const text = decodeEntities(lines.slice(timestampIndex + 1).join(' ')
			.replace(/<\/?c[^>]*>/g, '')
			.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
			.replace(/\s+/g, ' ')
			.trim());

		if (text && cues[cues.length - 1] !== text) {
			cues.push(text);
		}
	}

	const words = [];

	for (const cue of cues) {
		const next = cue.split(/\s+/).filter(Boolean);
		let overlap = 0;
		const max = Math.min(words.length, next.length, 40);

		for (let count = max; count > 0; count -= 1) {
			let matches = true;

			for (let index = 0; index < count; index += 1) {
				if (words[words.length - count + index].toLowerCase() !== next[index].toLowerCase()) {
					matches = false;
					break;
				}
			}

			if (matches) {
				overlap = count;
				break;
			}
		}

		words.push(...next.slice(overlap));
	}

	return words.join(' ').replace(/\s+/g, ' ').trim();
}

function cleanTranscript(text, locale) {
	let cleaned = text
		.replace(/\s+([,.!?;:])/g, '$1')
		.replace(/\s+/g, ' ')
		.replace(/\bYoutube\b/gi, 'YouTube')
		.replace(/\byoutuber\b/gi, 'YouTuber')
		.replace(/\baudacity\b/gi, 'Audacity')
		.replace(/\bab testing\b/gi, 'A/B testing')
		.replace(/\bclickthrough\b/gi, 'click-through')
		.trim();

	if (locale === 'en') {
		cleaned = cleaned
			.replace(/(^|\s)(uh|um)(?=\s|$)/gi, '$1')
			.replace(/\bi\b/g, 'I')
			.replace(/\bi'm\b/gi, "I'm")
			.replace(/\bi've\b/gi, "I've")
			.replace(/\bi'll\b/gi, "I'll");
	}

	return cleaned.replace(/(^|[.!?]\s+)([a-zäöü])/g, (match, prefix, letter) => {
		return prefix + letter.toLocaleUpperCase(locale === 'de' ? 'de-DE' : 'en-US');
	});
}

function transcriptParagraphs(text) {
	const sentences = text
		.replace(/\s+/g, ' ')
		.split(/(?<=[.!?])\s+/)
		.filter(Boolean);
	const paragraphs = [];
	let current = [];
	let wordCount = 0;

	for (const sentence of sentences) {
		const words = sentence.split(/\s+/).length;
		if (current.length && wordCount + words > 95) {
			paragraphs.push(current.join(' '));
			current = [];
			wordCount = 0;
		}
		current.push(sentence);
		wordCount += words;
	}

	if (current.length) {
		paragraphs.push(current.join(' '));
	}

	if (paragraphs.length > 1) {
		return paragraphs;
	}

	const words = text.split(/\s+/).filter(Boolean);
	const chunks = [];
	for (let index = 0; index < words.length; index += 90) {
		chunks.push(words.slice(index, index + 90).join(' '));
	}

	return chunks;
}

function summarizeTranscript(transcript) {
	const sentences = transcript
		.replace(/\s+/g, ' ')
		.split(/(?<=[.!?])\s+/)
		.filter(Boolean);
	const summary = sentences.slice(0, 2).join(' ');

	if (summary.length <= 220) {
		return summary;
	}

	return `${summary.slice(0, 217).replace(/\s+\S*$/, '')}...`;
}

function frontmatterString(data) {
	const quote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
	const lines = [
		'---',
		`id: ${data.id}`,
		`slug: ${quote(data.slug)}`,
		`path: ${quote(data.path)}`,
		`title: ${quote(data.title)}`,
		`excerpt: ${quote(data.excerpt)}`,
		`date: ${quote(data.date)}`,
		`modified: ${quote(data.modified)}`,
		`locale: ${quote(data.locale)}`,
	];

	if (data.translationKey) {
		lines.push(`translationKey: ${quote(data.translationKey)}`);
	}

	lines.push(
		`category: ${quote(data.category)}`,
		`image: ${quote(data.image)}`,
		`authorName: ${quote(data.authorName)}`,
		`sourceUrl: ${quote(data.sourceUrl)}`,
		'video:',
		`  youtubeId: ${quote(data.video.youtubeId)}`,
		`  embedUrl: ${quote(data.video.embedUrl)}`,
		`  watchUrl: ${quote(data.video.watchUrl)}`,
		`  thumbnailUrl: ${quote(data.video.thumbnailUrl)}`,
		'---',
	);

	return lines.join('\n');
}

function markdownBody(locale, paragraphs) {
	const heading = locale === 'de' ? 'Transkript' : 'Transcript';
	return [`## ${heading}`, ...paragraphs].join('\n\n');
}

function watchUrl(videoId, watchKind) {
	return watchKind === 'shorts'
		? `https://www.youtube.com/shorts/${videoId}`
		: `https://www.youtube.com/watch?v=${videoId}`;
}

function downloadTranscript(videoId, locale, tempDir) {
	const languagePreference = locale === 'de' ? 'de-orig,de' : 'en-orig,en';

	try {
		runYtDlp([
			'--ignore-errors',
			'--skip-download',
			'--write-subs',
			'--write-auto-subs',
			'--sub-langs',
			languagePreference,
			'--sub-format',
			'vtt',
			'-o',
			join(tempDir, '%(id)s.%(ext)s'),
			`https://www.youtube.com/watch?v=${videoId}`,
		], { quiet: true });
	} catch {
		// yt-dlp can exit non-zero when one requested subtitle variant fails while
		// another one was downloaded successfully, so inspect the output directory.
	}

	const files = readdirSync(tempDir).filter((fileName) => fileName.startsWith(`${videoId}.`) && fileName.endsWith('.vtt'));
	const preferredSuffixes = locale === 'de'
		? ['.de-orig.vtt', '.de.vtt']
		: ['.en-orig.vtt', '.en.vtt'];
	const fileName = preferredSuffixes
		.map((suffix) => files.find((file) => file.endsWith(suffix)))
		.find(Boolean) ?? files[0];

	if (!fileName) {
		return undefined;
	}

	return parseVtt(join(tempDir, fileName));
}

const posts = readPosts();
const existingVideoIds = extractExistingVideoIds(posts);
const existingSlugs = extractExistingSlugs(posts);
let nextId = extractMaxId(posts) + 1;
const tempDir = mkdtempSync(join(tmpdir(), 'kwmedia-youtube-import-'));
const created = [];
const translated = [];
const skipped = [];
const runAiPostProcessing = process.env.IMPORT_AI !== '0';

try {
	for (const playlist of playlists) {
		const entries = flatPlaylistEntries(playlist.url);

		for (const entry of entries) {
			if (existingVideoIds.has(entry.id)) {
				continue;
			}

			const metadata = videoMetadata(entry.id);
			const locale = localeFor(metadata);
			const transcript = downloadTranscript(entry.id, locale, tempDir);

			if (!transcript) {
				skipped.push(`${metadata.title} (${entry.id}): no ${locale} transcript found`);
				continue;
			}

			const cleanedTranscript = cleanTranscript(transcript, locale);
			const slug = uniqueSlug(slugify(metadata.title, locale), existingSlugs);
			const routePrefix = playlist.pathPrefix ?? `/${locale === 'de' ? 'youtube-tipps-de' : 'youtube-tips-en'}`;
			const postPath = `${routePrefix}/${slug}/`;
			const date = isoDate(metadata.timestamp, metadata.uploadDate);
			const currentWatchUrl = watchUrl(entry.id, playlist.defaultWatchKind);
			const thumbnailUrl = `https://i.ytimg.com/vi/${entry.id}/maxresdefault.jpg`;
			const post = {
				id: nextId,
				slug,
				path: postPath,
				title: metadata.title,
				excerpt: summarizeTranscript(cleanedTranscript),
				date,
				modified: date,
				locale,
				translationKey: `video:${entry.id}`,
				category: playlist.category,
				image: thumbnailUrl,
				authorName: playlist.authorName ?? 'Martin Koytek',
				sourceUrl: currentWatchUrl,
				video: {
					youtubeId: entry.id,
					embedUrl: `https://www.youtube.com/embed/${entry.id}`,
					watchUrl: currentWatchUrl,
					thumbnailUrl,
				},
			};

			const fileContent = `${frontmatterString(post)}\n\n${markdownBody(locale, transcriptParagraphs(cleanedTranscript))}\n`;
			const outputPath = join(postOutputDirectory(playlist.postType ?? 'video', locale), `${slug}.md`);
			let createdTranslation = false;
			writeFileSync(outputPath, fileContent);

			if (runAiPostProcessing) {
				console.log(`Cleaning ${outputPath}`);
				await cleanupPostFile(outputPath);
			}

			if (runAiPostProcessing && playlist.translate !== false) {
				console.log(`Translating ${outputPath}`);
				const translation = await translatePostFile(outputPath);
				if (!translation.skipped) {
					createdTranslation = true;
					translated.push(`${metadata.title} (${entry.id}) -> ${translation.targetPath}`);
				}
			}

			existingVideoIds.add(entry.id);
			nextId += createdTranslation ? 2 : 1;
			created.push(`${metadata.title} (${entry.id})`);
		}
	}
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}

if (created.length) {
	console.log(`Created ${created.length} imported post(s):`);
	for (const item of created) {
		console.log(`- ${item}`);
	}
} else {
	console.log('No new playlist videos found.');
}

if (translated.length) {
	console.log(`Translated ${translated.length} imported post(s):`);
	for (const item of translated) {
		console.log(`- ${item}`);
	}
}

if (skipped.length) {
	console.warn(`Skipped ${skipped.length} video(s):`);
	for (const item of skipped) {
		console.warn(`- ${item}`);
	}
}
