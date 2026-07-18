import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupPostFile, readPostFile, writePostFile } from '../scripts/content-ai.mjs';

test('post rewrites preserve related-post selections in frontmatter', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'kw-media-frontmatter-'));
	const filePath = join(directory, 'post.md');
	const frontmatter = {
		id: 1,
		slug: 'example',
		path: '/example/',
		title: 'Example',
		excerpt: 'Example excerpt',
		date: '2026-01-01',
		modified: '2026-01-01',
		locale: 'en',
		category: 'blog',
		tags: ['Testing'],
		relatedPosts: ['/related-one/', '/related-two/'],
		authorName: 'Author',
		sourceUrl: 'https://example.com',
	};

	writePostFile(filePath, frontmatter, 'Post body.');
	const post = readPostFile(filePath);

	assert.deepEqual(post.frontmatter.relatedPosts, ['/related-one/', '/related-two/']);
	assert.match(await readFile(filePath, 'utf8'), /^relatedPosts: \["\/related-one\/", "\/related-two\/"\]$/m);
});

test('cleanup keeps the original post when Ollama returns the wrong language', async (t) => {
	const directory = await mkdtemp(join(tmpdir(), 'kw-media-cleanup-'));
	const filePath = join(directory, 'post.md');
	const originalBody = '## Transcript\n\nThis is an English video and here I will show you how to edit subtitles for your viewers. We also review the settings for your channel.';

	writePostFile(filePath, {
		id: 2,
		slug: 'english-video',
		path: '/youtube-tips-en/english-video/',
		title: 'English video',
		excerpt: 'Original excerpt',
		date: '2026-01-01',
		modified: '2026-01-01',
		locale: 'en',
		category: 'news-video',
	}, originalBody);
	const bodyBeforeCleanup = readPostFile(filePath).body;

	t.mock.method(globalThis, 'fetch', async () => ({
		ok: true,
		json: async () => ({
			response: '## Transkript\n\nDas ist ein deutsches Video und hier zeige ich euch, wie ihr die Untertitel für eure Zuschauer bearbeiten könnt.',
		}),
	}));
	t.mock.method(console, 'warn', () => {});

	const result = await cleanupPostFile(filePath, { model: 'test-model' });
	const post = readPostFile(filePath);

	assert.equal(result.cleanupSkipped, true);
	assert.equal(post.body, bodyBeforeCleanup);
	assert.equal(console.warn.mock.callCount(), 1);
});
