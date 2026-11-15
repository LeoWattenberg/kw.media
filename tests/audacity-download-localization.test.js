import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { DOWNLOAD_LANGUAGES, downloadComparisonUrl, downloadPagePath, localizeDownloadComparison } from '../src/lib/audacity-download-localization.js';

const directory = new URL('../src/data/audacity-download-locales/', import.meta.url);
const english = JSON.parse(readFileSync(new URL('en.json', directory)));

test('the download page has exactly 25 additional languages without expanding global site locales', () => {
	assert.equal(DOWNLOAD_LANGUAGES.length, 27);
	assert.deepEqual(readdirSync(directory).sort(), DOWNLOAD_LANGUAGES.map(language => `${language}.json`).sort());
	assert.match(readFileSync(new URL('../src/i18n/config.ts', import.meta.url), 'utf8'), /locales = \['de', 'en'\]/);
});

for (const language of DOWNLOAD_LANGUAGES) {
	test(`${language} has a complete download catalog and preserves the reviewed versions`, () => {
		const catalog = JSON.parse(readFileSync(new URL(`${language}.json`, directory)));
		assert.equal(catalog.direction, ['ar', 'fa', 'he'].includes(language) ? 'rtl' : 'ltr');
		assert.ok(catalog.nativeName.trim());
		assert.ok(catalog.description.trim());
		assert.ok(catalog.copy.soundscaper.includes('Soundscaper'), 'the recommended download heading must name Soundscaper');
		assert.deepEqual(Object.keys(catalog.copy).sort(), Object.keys(english.copy).sort());
		for (const value of Object.values(catalog.copy)) assert.ok(typeof value === 'string' && value.trim());
		if (language === 'de') return; // German continues to use the original German comparison article.
		assert.deepEqual(Object.keys(catalog.comparison).sort(), Object.keys(english.comparison).sort());
		for (const [source, translation] of Object.entries(catalog.comparison)) {
			assert.ok(typeof translation === 'string' && translation.trim(), source);
			assert.deepEqual((translation.match(/\d+\.\d+\.\d+/g) ?? []).sort(), (source.match(/\d+\.\d+\.\d+/g) ?? []).sort(), source);
		}
	});
}

test('comparison links use the handbook language paths, with English at the root', () => {
	assert.equal(downloadComparisonUrl('en'), 'https://soundscaper.org/docs/start/how-soundscaper-compares/');
	assert.equal(downloadComparisonUrl('de'), 'https://soundscaper.org/docs/de/start/how-soundscaper-compares/');
	assert.equal(downloadComparisonUrl('pt-BR'), 'https://soundscaper.org/docs/pt-br/start/how-soundscaper-compares/');
	assert.equal(downloadComparisonUrl('zh-CN'), 'https://soundscaper.org/docs/zh-cn/start/how-soundscaper-compares/');
	assert.equal(downloadComparisonUrl('unknown'), downloadComparisonUrl('en'));
	assert.equal(downloadPagePath('zh-TW'), '/audacity/download/zh-tw/');
});

test('comparison localization preserves status styling and markup while escaping translated text', () => {
	const html = '<table><tr><td>Macros</td><td class="comparison-cell--extra"><span aria-hidden="true">★</span><span class="comparison-status-label">Yes</span> <span>including JS scripting</span></td></tr></table>';
	const translated = localizeDownloadComparison(html, { Macros: 'マクロ', Yes: 'はい', 'including JS scripting': 'JS & <scripts>' });
	assert.ok(translated.includes('<td>マクロ</td>'));
	assert.ok(translated.includes('class="comparison-cell--extra"'));
	assert.ok(translated.includes('aria-hidden="true">★</span>'));
	assert.ok(translated.includes('class="comparison-status-label">はい</span>'));
	assert.ok(translated.includes('JS &amp; &lt;scripts&gt;'));
	assert.equal(localizeDownloadComparison(html, {}), html);
});
