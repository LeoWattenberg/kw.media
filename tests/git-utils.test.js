import assert from 'node:assert/strict';
import test from 'node:test';
import { parseStatusPaths } from '../scripts/git-utils.mjs';

test('status parsing collects staged, unstaged, and untracked paths', () => {
	const output = [
		'M  src/data/posts/video/de/one.md\0',
		' M src/data/posts/video/en/two.md\0',
		'?? src/data/posts/video/en/three.md\0',
	].join('');

	assert.deepEqual([...parseStatusPaths(output)], [
		'src/data/posts/video/de/one.md',
		'src/data/posts/video/en/two.md',
		'src/data/posts/video/en/three.md',
	]);
});

test('status parsing keeps both sides of a rename instead of reading the source as a status record', () => {
	const output = [
		'R  src/data/posts/video/de/new.md\0src/data/posts/video/de/old.md\0',
		'?? src/data/posts/video/en/other.md\0',
	].join('');

	assert.deepEqual([...parseStatusPaths(output)], [
		'src/data/posts/video/de/new.md',
		'src/data/posts/video/de/old.md',
		'src/data/posts/video/en/other.md',
	]);
});

test('status parsing keeps paths that contain spaces', () => {
	const output = '?? src/data/posts/video/en/a post.md\0';

	assert.deepEqual([...parseStatusPaths(output)], ['src/data/posts/video/en/a post.md']);
});

test('status parsing returns nothing for a clean working tree', () => {
	assert.deepEqual([...parseStatusPaths('')], []);
});
