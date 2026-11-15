import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { detectDownloadEnvironment, downloadAsset, extractComparisonHtml, fetchSoundscaperRelease, formatDownloadComparisonHtml, getDownloadEnvironment, matchingDownloads, parseAudacity3Release, parseAudacityReleases, selectSoundscaperRelease } from '../src/lib/audacity-downloads.js';

const releases = JSON.parse(readFileSync(new URL('../src/data/audacity-downloads.json', import.meta.url)));
const audacityUrl = 'https://github.com/audacity/audacity/releases/download/Audacity-4.1.0/';
const source = `export type ReleaseInfo = { name: string };
export const audacityReleases: ReleaseDirectory = {
 version: "4.1.0",
 win: [{ name: "x86_64 MSI installer", browser_download_url: "${audacityUrl}audacity-win-4.1.0-x86_64.msi", type: ".msi" }],
 mac: [{ name: "Universal DMG", browser_download_url: "${audacityUrl}audacity-macOS-4.1.0-universal.dmg", type: ".dmg" }],
 lin: [{ name: "ARM64 AppImage", browser_download_url: "${audacityUrl}audacity-linux-4.1.0-aarch64.AppImage", type: ".AppImage" }],
};
export const betaPreRelease = { downloads: { version: "5.0.0-beta", win: [] } };`;

test('reads the stable Audacity 4 data literal without running upstream code', () => {
	const release = parseAudacityReleases(source + '\nthrow new Error("Do not execute me");');
	assert.equal(release.version, '4.1.0');
	assert.deepEqual(release.assets.map(asset => [asset.platform, asset.architecture, asset.format]), [
		['win', 'x64', 'msi'], ['mac', 'universal', 'dmg'], ['linux', 'arm64', 'AppImage'],
	]);
	assert.throws(() => parseAudacityReleases('export const betaPreRelease = {};'));
	assert.throws(() => parseAudacityReleases(source.replaceAll('4.1.0', '5.0.0')));
	assert.throws(() => parseAudacityReleases(source.replaceAll('https://github.com/', 'https://other.example/')));
});

test('excludes sources, manuals, checksums and non-release download URLs', () => {
	assert.equal(downloadAsset('manual', audacityUrl + 'audacity-manual-4.1.0.zip'), null);
	assert.equal(downloadAsset('sources', audacityUrl + 'audacity-sources-4.1.0.zip'), null);
	assert.equal(downloadAsset('checksum', audacityUrl + 'SHA256SUMS'), null);
	assert.equal(downloadAsset('installer', 'javascript:alert(1)'), null);
	assert.equal(downloadAsset('installer', 'https://other.example/audacity-win-x64.exe'), null);
	assert.equal(downloadAsset('installer', 'https://['), null);
	assert.equal(downloadAsset('installer', audacityUrl + '%zz.exe'), null);
	assert.equal(downloadAsset('unknown CPU', audacityUrl + 'audacity-win-4.1.0.exe'), null);
});

function soundscaperRelease(tag, published, filenames = ['win-x64.exe', 'win-x64.zip']) {
	const prefix = tag.startsWith('soundscaper-v') ? `Soundscaper-${tag.slice('soundscaper-v'.length)}` : tag;
	return {
		tag_name: tag, published_at: published, draft: false,
		assets: filenames.map(filename => ({
			name: `${prefix}-${filename}`, state: 'uploaded',
			browser_download_url: `https://github.com/mindscaper-org/Soundscaper/releases/download/${tag}/${prefix}-${filename}`,
		})),
	};
}

test('selects one complete published Soundscaper RC and ignores other products and channels', () => {
	const older = soundscaperRelease('soundscaper-v1.0.0-rc.9', '2026-09-10');
	const latest = soundscaperRelease('soundscaper-v1.0.0-rc.Nov.10.a', '2026-11-10');
	const candidates = [
		older, latest,
		{ ...soundscaperRelease('soundscaper-v1.0.0-rc.99', '2026-12-10'), draft: true },
		soundscaperRelease('soundscaper-v1.0.0-rc.100', '2026-12-10', []),
		soundscaperRelease('soundscaper-v1.0.0-beta.100', '2026-12-10'),
		soundscaperRelease('framescaper-v1.0.0-rc.100', '2026-12-10'),
	];
	const release = selectSoundscaperRelease(candidates);
	assert.equal(release.version, '1.0.0-rc.Nov.10.a');
	assert.equal(release.assets.length, 2);
	assert.ok(release.assets.every(asset => asset.url.includes(latest.tag_name)));
	const calendar = soundscaperRelease('Soundscaper-rc.2026.Nov.11.a', '2026-11-11');
	assert.equal(selectSoundscaperRelease([...candidates, calendar]).version, calendar.tag_name);
	const republishedOlderCalendar = soundscaperRelease('Soundscaper-rc.2026.Oct.31.a', '2026-12-12');
	const republishedSemantic = soundscaperRelease('soundscaper-v1.0.0-rc.9', '2026-12-13');
	assert.equal(selectSoundscaperRelease([calendar, republishedOlderCalendar, republishedSemantic]).version, calendar.tag_name);
	const nextBuild = soundscaperRelease('Soundscaper-rc.2026.Nov.11.aa', '2026-11-10');
	assert.equal(selectSoundscaperRelease([calendar, nextBuild]).version, nextBuild.tag_name);
	const unrecognizedPackages = soundscaperRelease('soundscaper-v1.0.0-rc.99', '2026-12-10', ['corresponding-source-win-x64.zip', 'helper-win-x64.zip']);
	assert.equal(selectSoundscaperRelease([older, unrecognizedPackages]).version, '1.0.0-rc.9');
	assert.throws(() => selectSoundscaperRelease([]));
	assert.throws(() => selectSoundscaperRelease({}));
});

test('paginates the repository release feed without mixing pages or changing per_page', async () => {
	const urls = [];
	const release = soundscaperRelease('soundscaper-v1.0.0-rc.10', '2026-10-10');
	const result = await fetchSoundscaperRelease(async url => {
		urls.push(url);
		return new Response(JSON.stringify(urls.length === 1 ? [] : [release]), {
			headers: urls.length === 1 ? { link: '<https://api.github.com/repositories/1299822768/releases?per_page=100&page=2>; rel="next"' } : {},
		});
	});
	assert.equal(result.version, '1.0.0-rc.10');
	assert.deepEqual(urls.map(url => new URL(url).search), ['?per_page=100&page=1', '?per_page=100&page=2']);
	await assert.rejects(fetchSoundscaperRelease(async () => new Response('', { status: 403 })));
	await assert.rejects(fetchSoundscaperRelease(async () => new Response('{}')));
});

test('detects Windows and Linux CPUs, with native client hints taking priority over compatibility UAs', () => {
	assert.deepEqual(detectDownloadEnvironment({ userAgent: 'Windows NT 10.0; Win64; x64', platform: 'Win32' }), { platform: 'win', architecture: 'x64' });
	assert.deepEqual(detectDownloadEnvironment({ userAgent: 'Windows NT 10.0; Win64; x64', platform: 'Win32' }, { platform: 'Windows', architecture: 'arm', bitness: '64' }), { platform: 'win', architecture: 'arm64' });
	assert.deepEqual(detectDownloadEnvironment({ userAgent: 'X11; Linux aarch64', platform: 'Linux' }), { platform: 'linux', architecture: 'arm64' });
	assert.deepEqual(detectDownloadEnvironment({ userAgent: 'X11; Linux i686', platform: 'Linux' }), { platform: 'linux', architecture: 'x86' });
	assert.deepEqual(detectDownloadEnvironment({ platform: 'Win32' }, { architecture: 'x86', bitness: '32' }), { platform: 'win', architecture: 'x86' });
	assert.deepEqual(detectDownloadEnvironment({ platform: 'Linux' }, { architecture: 'arm', bitness: '32' }), { platform: 'linux', architecture: 'unsupported' });
	assert.deepEqual(detectDownloadEnvironment({ platform: 'Linux', userAgent: 'Linux x86_64' }, { architecture: 'riscv', bitness: '64' }), { platform: 'linux', architecture: 'unsupported' });
});

test('does not misidentify Safari Apple Silicon, mobile devices or unknown CPUs', () => {
	assert.deepEqual(detectDownloadEnvironment({ userAgent: 'Macintosh; Intel Mac OS X 10_15_7', platform: 'MacIntel' }), { platform: 'mac', architecture: null });
	assert.deepEqual(detectDownloadEnvironment({ userAgent: 'Macintosh; Intel Mac OS X 10_15_7', platform: 'MacIntel' }, { platform: 'macOS', architecture: 'arm', bitness: '64' }), { platform: 'mac', architecture: 'arm64' });
	for (const environment of [
		{ userAgent: 'Linux; Android 14', platform: 'Linux aarch64' },
		{ userAgent: 'iPhone; CPU iPhone OS 18', platform: 'iPhone' },
		{ userAgent: 'Macintosh; Intel Mac OS X 10_15_7', platform: 'MacIntel', maxTouchPoints: 5 },
		{},
	]) assert.deepEqual(detectDownloadEnvironment(environment), { platform: null, architecture: null });
});

test('uses high entropy hints and tolerates browsers denying them', async () => {
	const navigator = { userAgent: 'Windows NT 10.0; Win64; x64', platform: 'Win32' };
	assert.equal((await getDownloadEnvironment({ ...navigator, userAgentData: {
		getHighEntropyValues: async () => ({ platform: 'Windows', architecture: 'arm', bitness: '64' }),
	} })).architecture, 'arm64');
	assert.equal((await getDownloadEnvironment({ ...navigator, userAgentData: {
		getHighEntropyValues: async () => { throw new Error('Denied'); },
	} })).architecture, 'x64');
});

test('prefers installers over archives and keeps every alternative for manual selection', () => {
	for (const [product, platform, architecture, format] of [
		['soundscaper', 'win', 'x64', 'exe'], ['soundscaper', 'win', 'arm64', 'exe'],
		['soundscaper', 'mac', 'arm64', 'pkg'], ['soundscaper', 'linux', 'x64', 'AppImage'],
		['audacity4', 'win', 'arm64', 'msi'], ['audacity4', 'linux', 'arm64', 'AppImage'],
		['audacity3', 'win', 'x86', 'exe'], ['audacity3', 'mac', null, 'pkg'],
	]) {
		const matching = matchingDownloads(releases[product].assets, { platform, architecture });
		assert.equal(matching[0]?.format, format, `${product} ${platform} ${architecture}`);
		assert.ok(matching.every(asset => asset.architecture === architecture || asset.architecture === 'universal'));
	}
	assert.equal(matchingDownloads(releases.audacity4.assets, { platform: 'mac', architecture: null })[0].architecture, 'universal');
	assert.deepEqual(matchingDownloads(releases.soundscaper.assets, { platform: 'mac', architecture: 'x64' }), []);
	assert.deepEqual(matchingDownloads(releases.soundscaper.assets, { platform: 'win', architecture: null }), []);
	assert.deepEqual(matchingDownloads(releases.audacity3.assets, { platform: 'linux', architecture: 'arm64' }), []);
	assert.equal(matchingDownloads(releases.audacity3.assets, { platform: 'linux', architecture: 'x64' })[0].variant, '20.04');
});

test('pins Audacity 3 to 3.7.9', () => {
	assert.throws(() => parseAudacity3Release({ tag_name: 'Audacity-3.7.8', assets: [] }));
	assert.equal(parseAudacity3Release({ tag_name: 'Audacity-3.7.9', assets: releases.audacity3.assets.map(asset => ({ name: asset.name, browser_download_url: asset.url })) }).assets.length, releases.audacity3.assets.length);
});

test('reuses comparison tables with their version and scope notes, excluding the rest of the post', () => {
	const section = '<h2>Version comparison</h2><p>Updated today; partial feature list.</p><table><tr><td>First</td></tr></table><h3>More</h3><table><tr><td>Second</td></tr></table>';
	assert.equal(extractComparisonHtml('<p>Intro</p>' + section + '<h2>Later</h2><p>Conclusion</p>'), section);
	assert.throws(() => extractComparisonHtml('<h2>No tables</h2>'));
});

test('adapts both languages to the download order, omits three features and distinguishes status from enhancements', () => {
	for (const [yes, no, partial, extras, removed] of [
		['Yes', 'No', 'Partial', ['including JS scripting', 'and more added', 'also added spectral drawing'], ['Export each label as its own file', 'Export tracks as separate stems', 'Trim audio outside the selection']],
		['Ja', 'Nein', 'Teilweise', ['inklusive JS-Skripting', 'und mehr hinzugefügt', 'auch spektrales Zeichnen hinzugefügt'], ['Jedes Label als separate Datei exportieren', 'Spuren als separate Stems exportieren', 'Audio außerhalb der Auswahl kürzen']],
	]) {
		const row = (feature, soundscaper) => `<tr><td>${feature}</td><td>${yes}</td><td>${no}</td><td>${soundscaper}</td></tr>`;
		const source = '<h2>Original order</h2><p>Reviewed versions</p><table><thead><tr><th>Feature</th><th>Audacity 3.7.9</th><th>Audacity 4.0.2</th><th>Soundscaper</th></tr></thead><tbody>'
			+ removed.map(feature => row(feature, yes)).join('')
			+ extras.map((detail, index) => row(`Extra ${index}`, `${yes} – ${detail}`)).join('')
			+ row('Limited', partial) + row('Beta', `${yes} - beta`) + '</tbody></table>';
		const result = formatDownloadComparisonHtml(source);
		assert.ok(result.includes('<h2>Soundscaper vs. Audacity 4.0.2 vs. Audacity 3.7.9</h2>'));
		assert.ok(result.includes('<th>Feature</th><th>Soundscaper</th><th>Audacity 4.0.2</th><th>Audacity 3.7.9</th>'));
		for (const feature of removed) assert.ok(!result.includes(feature));
		assert.equal([...result.matchAll(/class="comparison-cell--extra"/g)].length, 3);
		assert.ok(result.includes('aria-hidden="true">★</span>'));
		assert.ok(result.includes('aria-hidden="true">~</span>'));
		assert.ok(result.includes('aria-hidden="true">+</span>'));
		assert.ok(result.includes('aria-hidden="true">/</span>'));
		assert.ok(result.includes(`class="comparison-status-label">${yes}</span>`));
		assert.ok(result.includes('class="comparison-detail">beta</span>'));
		assert.ok(result.includes('<p>Reviewed versions</p>'));
		assert.ok(source.includes(removed[0]), 'the article source remains intact');
	}
});
