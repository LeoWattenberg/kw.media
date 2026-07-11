import assert from 'node:assert/strict';
import test from 'node:test';
import { assertTextLocale, detectTextLocale, languageScores } from '../scripts/language-utils.mjs';

test('detectTextLocale identifies a German transcript mislabeled as English', () => {
	const transcript = 'Das ist ein deutsches Video und hier zeige ich euch, wie ihr die Untertitel für eure Zuschauer bearbeiten könnt. Wir gehen auch auf die wichtigsten Einstellungen ein.';

	assert.equal(detectTextLocale(transcript), 'de');
	assert.ok(languageScores(transcript).de > languageScores(transcript).en);
});

test('detectTextLocale identifies an English transcript', () => {
	const transcript = 'This is an English video and here I will show you how to edit the subtitles for your viewers. We also look at the settings that can help your channel.';

	assert.equal(detectTextLocale(transcript), 'en');
});

test('detectTextLocale leaves short or ambiguous copy undecided', () => {
	assert.equal(detectTextLocale('YouTube Creator Music'), undefined);
});

test('assertTextLocale rejects a confident mismatch', () => {
	assert.throws(
		() => assertTextLocale('Das ist ein Video und hier zeige ich euch, wie ihr die Untertitel bearbeiten könnt.', 'en', 'Transcript'),
		/Transcript looks de, expected en/,
	);
});
