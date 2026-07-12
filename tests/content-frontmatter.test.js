import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readPostFile, writePostFile } from '../scripts/content-ai.mjs';

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
