import test from 'node:test';
import assert from 'node:assert/strict';

import {
	calculatePerfectOdds,
	escapeHtml,
	formatDuration,
	formatTemplate,
	normalizeManifest,
	resolveAssetUrl,
	storageKey,
} from '../src/lib/games/mp3-guesser.js';

test('mp3 guesser resolves generated game asset URLs against the site base', () => {
	assert.equal(resolveAssetUrl('/games/mp3guesser/daily.json', '/'), '/games/mp3guesser/daily.json');
	assert.equal(resolveAssetUrl('/games/mp3guesser/daily.json', '/de/'), '/de/games/mp3guesser/daily.json');
	assert.equal(resolveAssetUrl('relative.mp3', '/de/'), 'relative.mp3');
	assert.equal(resolveAssetUrl('https://example.com/file.mp3', '/de/'), 'https://example.com/file.mp3');
	assert.equal(resolveAssetUrl('data:audio/mp3;base64,abc', '/de/'), 'data:audio/mp3;base64,abc');
});

test('mp3 guesser normalizes all level option URLs', () => {
	const manifest = normalizeManifest({
		date: '2026-07-11',
		levels: [
			{
				label: 'V9',
				options: [
					{ id: 'original', url: '/games/mp3guesser/2026-07-11/original.wav' },
					{ id: 'v9', url: 'v9.mp3' },
				],
			},
		],
	}, '/en/');

	assert.equal(manifest.levels[0].options[0].url, '/en/games/mp3guesser/2026-07-11/original.wav');
	assert.equal(manifest.levels[0].options[1].url, 'v9.mp3');
});

test('mp3 guesser calculates result odds from answer choices per level', () => {
	assert.equal(calculatePerfectOdds([]), 1);
	assert.equal(calculatePerfectOdds([
		{ options: [{}, {}, {}] },
		{ options: [{}, {}, {}, {}] },
		{ options: [] },
	]), 12);
});

test('mp3 guesser formatting helpers are stable', () => {
	assert.equal(storageKey('2026-07-11'), 'kwm-mp3-guesser:2026-07-11');
	assert.equal(storageKey(), 'kwm-mp3-guesser:unknown');
	assert.equal(formatDuration(0), '0s');
	assert.equal(formatDuration(59.6), '1:00');
	assert.equal(formatDuration(125), '2:05');
	assert.equal(formatTemplate('{score}/{total}', { score: '4', total: '5' }), '4/5');
	assert.equal(escapeHtml('<a href="x">& test</a>'), '&lt;a href=&quot;x&quot;&gt;&amp; test&lt;/a&gt;');
});
