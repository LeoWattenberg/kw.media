import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const playlists = [
	{
		id: 'PLpM9DoCHlaQHdyH6R1XWPYmQLsrif1Y9F',
		defaultWatchKind: 'shorts',
	},
	{
		id: 'PLpM9DoCHlaQFlsYdZiGUVG3eREZTs706N',
		defaultWatchKind: 'watch',
	},
];

const postsDir = join(process.cwd(), 'src/data/posts');
const apiKey = process.env.YOUTUBE_API_KEY;
const oauthClientId = process.env.YOUTUBE_OAUTH_CLIENT_ID;
const oauthClientSecret = process.env.YOUTUBE_OAUTH_CLIENT_SECRET;
const oauthRefreshToken = process.env.YOUTUBE_OAUTH_REFRESH_TOKEN;
const hasCaptionOAuth = Boolean(oauthClientId && oauthClientSecret && oauthRefreshToken);

if (!apiKey) {
	console.error('Missing YOUTUBE_API_KEY. Add a YouTube Data API key to the workflow secrets.');
	process.exit(1);
}

function readPosts() {
	return readdirSync(postsDir)
		.filter((fileName) => fileName.endsWith('.md'))
		.map((fileName) => ({
			fileName,
			content: readFileSync(join(postsDir, fileName), 'utf8'),
		}));
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
	return new Set(posts.map((post) => post.fileName.replace(/\.md$/, '')));
}

async function apiGet(path, params, accessToken) {
	const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	}

	if (!accessToken) {
		url.searchParams.set('key', apiKey);
	}

	const response = await fetch(url, {
		headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`YouTube API ${path} failed with HTTP ${response.status}: ${body}`);
	}

	return response.json();
}

async function captionAccessToken() {
	if (!hasCaptionOAuth) {
		return undefined;
	}

	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: oauthClientId,
			client_secret: oauthClientSecret,
			refresh_token: oauthRefreshToken,
			grant_type: 'refresh_token',
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Failed to refresh YouTube OAuth token: HTTP ${response.status}: ${body}`);
	}

	const token = await response.json();
	return token.access_token;
}

async function playlistVideoIds(playlistId) {
	const ids = [];
	let pageToken;

	do {
		const page = await apiGet('playlistItems', {
			part: 'contentDetails',
			playlistId,
			maxResults: 50,
			pageToken,
		});

		for (const item of page.items ?? []) {
			if (item.contentDetails?.videoId) {
				ids.push(item.contentDetails.videoId);
			}
		}

		pageToken = page.nextPageToken;
	} while (pageToken);

	return ids;
}

async function videoMetadata(videoIds) {
	const videos = new Map();

	for (let index = 0; index < videoIds.length; index += 50) {
		const batch = videoIds.slice(index, index + 50);
		const response = await apiGet('videos', {
			part: 'snippet,contentDetails',
			id: batch.join(','),
			maxResults: 50,
		});

		for (const item of response.items ?? []) {
			videos.set(item.id, item);
		}
	}

	return videos;
}

function likelyGerman(text) {
	return /\b(und|oder|wie|was|ist|das|der|die|den|euch|dein|deinen|keine|für|über|nicht)\b/i.test(text)
		|| /[äöüß]/i.test(text);
}

function localeFor(video) {
	const language = (video.snippet?.defaultAudioLanguage ?? video.snippet?.defaultLanguage ?? '').toLowerCase();

	if (language.startsWith('de')) {
		return 'de';
	}

	if (language.startsWith('en')) {
		return 'en';
	}

	return likelyGerman(video.snippet?.title ?? '') ? 'de' : 'en';
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

	while (existingSlugs.has(slug) || existsSync(join(postsDir, `${slug}.md`))) {
		slug = `${baseSlug}-${counter}`;
		counter += 1;
	}

	existingSlugs.add(slug);
	return slug;
}

function decodeEntities(text) {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'");
}

function parseVtt(text) {
	const cues = [];

	for (const block of text.split(/\n\s*\n/)) {
		const lines = block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
		if (!lines.length || lines[0].startsWith('WEBVTT') || lines[0].startsWith('Kind:') || lines[0].startsWith('Language:')) {
			continue;
		}

		const timestampIndex = lines.findIndex((line) => /-->/.test(line));
		if (timestampIndex === -1) {
			continue;
		}

		const cueText = decodeEntities(lines.slice(timestampIndex + 1).join(' ')
			.replace(/<\/?c[^>]*>/g, '')
			.replace(/<\d{2}:\d{2}:\d{2}\.\d{3}>/g, '')
			.replace(/\s+/g, ' ')
			.trim());

		if (cueText && cues[cues.length - 1] !== cueText) {
			cues.push(cueText);
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

async function captionTrack(videoId, locale, accessToken) {
	if (!accessToken) {
		return undefined;
	}

	const captions = await apiGet('captions', {
		part: 'snippet',
		videoId,
	}, accessToken);
	const tracks = captions.items ?? [];
	const localeTracks = tracks.filter((track) => track.snippet?.language?.toLowerCase().startsWith(locale));

	return (
		localeTracks.find((track) => track.snippet?.trackKind?.toLowerCase() !== 'asr')
		?? localeTracks[0]
		?? tracks.find((track) => track.snippet?.trackKind?.toLowerCase() !== 'asr')
		?? tracks[0]
	);
}

async function downloadCaption(trackId, accessToken) {
	const url = new URL(`https://www.googleapis.com/youtube/v3/captions/${trackId}`);
	url.searchParams.set('tfmt', 'vtt');

	const response = await fetch(url, {
		headers: { Authorization: `Bearer ${accessToken}` },
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Caption download failed with HTTP ${response.status}: ${body}`);
	}

	return response.text();
}

async function transcriptFor(videoId, locale, accessToken) {
	const track = await captionTrack(videoId, locale, accessToken);
	if (!track?.id) {
		return undefined;
	}

	return parseVtt(await downloadCaption(track.id, accessToken));
}

function frontmatterString(data) {
	const quote = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

	return [
		'---',
		`id: ${data.id}`,
		`slug: ${quote(data.slug)}`,
		`path: ${quote(data.path)}`,
		`title: ${quote(data.title)}`,
		`excerpt: ${quote(data.excerpt)}`,
		`date: ${quote(data.date)}`,
		`modified: ${quote(data.modified)}`,
		`locale: ${quote(data.locale)}`,
		`categoryIds: [${data.categoryIds.join(', ')}]`,
		`image: ${quote(data.image)}`,
		`authorName: ${quote(data.authorName)}`,
		`sourceUrl: ${quote(data.sourceUrl)}`,
		'video:',
		`  youtubeId: ${quote(data.video.youtubeId)}`,
		`  embedUrl: ${quote(data.video.embedUrl)}`,
		`  watchUrl: ${quote(data.video.watchUrl)}`,
		`  thumbnailUrl: ${quote(data.video.thumbnailUrl)}`,
		'---',
	].join('\n');
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

function thumbnailUrl(video) {
	const thumbnails = video.snippet?.thumbnails ?? {};
	return thumbnails.maxres?.url
		?? thumbnails.standard?.url
		?? thumbnails.high?.url
		?? `https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`;
}

const posts = readPosts();
const existingVideoIds = extractExistingVideoIds(posts);
const existingSlugs = extractExistingSlugs(posts);
let nextId = extractMaxId(posts) + 1;
const created = [];
const skipped = [];
const accessToken = await captionAccessToken();

if (!accessToken) {
	console.warn('Caption OAuth secrets are not configured. New videos will be skipped because YouTube Data API caption downloads require OAuth.');
}

for (const playlist of playlists) {
	const ids = await playlistVideoIds(playlist.id);
	const newIds = ids.filter((id) => !existingVideoIds.has(id));

	if (!newIds.length) {
		continue;
	}

	const videos = await videoMetadata(newIds);

	for (const videoId of newIds) {
		const video = videos.get(videoId);

		if (!video) {
			skipped.push(`${videoId}: video metadata not found`);
			continue;
		}

		const locale = localeFor(video);
		let transcript;
		try {
			transcript = await transcriptFor(videoId, locale, accessToken);
		} catch (error) {
			skipped.push(`${video.snippet.title} (${videoId}): ${error.message}`);
			continue;
		}

		if (!transcript) {
			skipped.push(`${video.snippet.title} (${videoId}): no downloadable ${locale} caption track found`);
			continue;
		}

		const cleanedTranscript = cleanTranscript(transcript, locale);
		const slug = uniqueSlug(slugify(video.snippet.title, locale), existingSlugs);
		const postPath = `/${locale === 'de' ? 'youtube-tipps-de' : 'youtube-tips-en'}/${slug}/`;
		const date = video.snippet.publishedAt.replace(/\.\d{3}Z$/, '');
		const currentWatchUrl = watchUrl(videoId, playlist.defaultWatchKind);
		const post = {
			id: nextId,
			slug,
			path: postPath,
			title: video.snippet.title,
			excerpt: summarizeTranscript(cleanedTranscript),
			date,
			modified: date,
			locale,
			categoryIds: [locale === 'de' ? 17 : 18],
			image: thumbnailUrl(video),
			authorName: 'Martin Koytek',
			sourceUrl: currentWatchUrl,
			video: {
				youtubeId: videoId,
				embedUrl: `https://www.youtube.com/embed/${videoId}`,
				watchUrl: currentWatchUrl,
				thumbnailUrl: thumbnailUrl(video),
			},
		};

		const fileContent = `${frontmatterString(post)}\n\n${markdownBody(locale, transcriptParagraphs(cleanedTranscript))}\n`;
		writeFileSync(join(postsDir, `${slug}.md`), fileContent);
		existingVideoIds.add(videoId);
		nextId += 1;
		created.push(`${video.snippet.title} (${videoId})`);
	}
}

if (created.length) {
	console.log(`Created ${created.length} YouTube post(s):`);
	for (const item of created) {
		console.log(`- ${item}`);
	}
} else {
	console.log('No new YouTube videos imported.');
}

if (skipped.length) {
	console.warn(`Skipped ${skipped.length} video(s):`);
	for (const item of skipped) {
		console.warn(`- ${item}`);
	}
}
