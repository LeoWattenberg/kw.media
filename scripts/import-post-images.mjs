import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { get } from 'node:https';

const xmlPath = process.argv[2];

if (!xmlPath) {
	console.error('Usage: node scripts/import-post-images.mjs path/to/export.xml');
	process.exit(1);
}

const root = process.cwd();
const xml = readFileSync(xmlPath, 'utf8');
const posts = readdirSync(join(root, 'src/data/posts'))
	.filter((fileName) => fileName.endsWith('.json'))
	.map((fileName) => JSON.parse(readFileSync(join(root, 'src/data/posts', fileName), 'utf8')));
const postIds = new Set(posts.map((post) => post.id));

function cdata(tag, text) {
	const open = `<${tag}><![CDATA[`;
	const close = `]]></${tag}>`;
	const start = text.indexOf(open);

	if (start === -1) {
		return undefined;
	}

	const valueStart = start + open.length;
	const end = text.indexOf(close, valueStart);

	return end === -1 ? undefined : text.slice(valueStart, end);
}

function tagValue(tag, text) {
	const open = `<${tag}>`;
	const close = `</${tag}>`;
	const start = text.indexOf(open);

	if (start === -1) {
		return undefined;
	}

	const valueStart = start + open.length;
	const end = text.indexOf(close, valueStart);

	return end === -1 ? undefined : text.slice(valueStart, end);
}

function canonicalUploadKey(url) {
	const parsed = new URL(url);
	return parsed.pathname
		.replace(/-\d+x\d+(?=\.[^.]+$)/, '')
		.replace(/-scaled(?=\.[^.]+$)/, '')
		.toLowerCase();
}

function localPathFor(url) {
	const parsed = new URL(url);
	return `/assets${decodeURI(parsed.pathname)}`;
}

function download(url, filePath) {
	if (existsSync(filePath)) {
		return Promise.resolve(false);
	}

	mkdirSync(dirname(filePath), { recursive: true });

	return new Promise((resolve, reject) => {
		const request = get(url, (response) => {
			if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
				response.resume();
				download(new URL(response.headers.location, url).toString(), filePath).then(resolve, reject);
				return;
			}

			if ((response.statusCode ?? 0) >= 400) {
				response.resume();
				reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
				return;
			}

			const file = createWriteStream(filePath);
			response.pipe(file);
			file.on('finish', () => {
				file.close(() => resolve(true));
			});
			file.on('error', reject);
		});

		request.on('error', reject);
	});
}

const referencedUrls = new Set();

for (const post of posts) {
	for (const match of post.contentHtml.matchAll(/https?:\/\/[^"' <>)]+/g)) {
		referencedUrls.add(match[0].replaceAll('&amp;', '&'));
	}
}

const referencedCanonicalKeys = new Set(
	[...referencedUrls]
		.filter((url) => /^https:\/\/kw\.media\/wp-content\/uploads\//.test(url))
		.map((url) => canonicalUploadKey(url)),
);
const allAttachments = [];

for (const match of xml.matchAll(/<item>[\s\S]*?<\/item>/g)) {
	const item = match[0];

	if (cdata('wp:post_type', item) !== 'attachment') {
		continue;
	}

	const parentId = Number(tagValue('wp:post_parent', item) ?? 0);
	const attachmentUrl = cdata('wp:attachment_url', item);

	if (!attachmentUrl) {
		continue;
	}

	allAttachments.push({
		parentId,
		url: attachmentUrl,
		localPath: localPathFor(attachmentUrl),
		canonicalKey: canonicalUploadKey(attachmentUrl),
	});
}

const attachments = allAttachments.filter((attachment) => {
	return postIds.has(attachment.parentId) || referencedCanonicalKeys.has(attachment.canonicalKey);
});

let downloaded = 0;

for (const attachment of attachments) {
	const absolutePath = join(root, 'public', attachment.localPath);
	if (await download(attachment.url, absolutePath)) {
		downloaded += 1;
	}
}

console.log(`Imported ${attachments.length} post attachments.`);
console.log(`Downloaded ${downloaded} new files.`);
