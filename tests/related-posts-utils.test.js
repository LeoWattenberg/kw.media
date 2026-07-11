import assert from 'node:assert/strict';
import test from 'node:test';
import { relatedPathsToRefresh } from '../scripts/related-posts-utils.mjs';

test('incremental related-post generation refreshes targets and posts whose candidates include them', () => {
	const posts = ['/old-a/', '/old-b/', '/new/'].map((path) => ({ frontmatter: { path } }));
	const candidates = new Map([
		['/old-a/', ['/new/', '/old-b/']],
		['/old-b/', ['/old-a/']],
		['/new/', ['/old-a/', '/old-b/']],
	]);

	assert.deepEqual(
		relatedPathsToRefresh(posts, candidates, ['/new/']),
		['/old-a/', '/new/'],
	);
});

test('incremental related-post generation handles multiple target posts', () => {
	const posts = ['/old/', '/new-de/', '/new-en/'].map((path) => ({ frontmatter: { path } }));
	const candidates = new Map([
		['/old/', ['/new-en/']],
		['/new-de/', ['/old/']],
		['/new-en/', ['/old/']],
	]);

	assert.deepEqual(
		relatedPathsToRefresh(posts, candidates, ['/new-de/', '/new-en/']),
		['/old/', '/new-de/', '/new-en/'],
	);
});
