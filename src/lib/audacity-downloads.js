export const AUDACITY_RELEASES_URL = 'https://raw.githubusercontent.com/audacity/audacity.github.io/refs/heads/main/src/assets/data/audacityReleases.ts';
// The repository ID survives the Soundscaper repository's owner/name changes.
export const SOUNDSCAPER_RELEASES_URL = 'https://api.github.com/repositories/1299822768/releases?per_page=100&page=1';
export const AUDACITY_3_RELEASE_URL = 'https://api.github.com/repos/audacity/audacity/releases/tags/Audacity-3.7.9';

const platforms = { win: 'Windows', mac: 'macOS', linux: 'Linux' };

/** Normalize only desktop packages, excluding source archives, manuals and checksums. */
export function downloadAsset(name, url, platform) {
	if (typeof name !== 'string' || typeof url !== 'string') return null;
	let parsed, filename;
	try {
		parsed = new URL(url);
		filename = decodeURIComponent(parsed.pathname.split('/').pop());
	} catch {
		return null;
	}
	if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com'
		|| !/^\/(?:audacity\/audacity|mindscaper-org\/Soundscaper|LeoWattenberg\/Soundscaper)\/releases\/download\//i.test(parsed.pathname)) return null;
	if (/sources?|manual|corresponding/i.test(filename)) return null;
	const format = filename.match(/\.(exe|msi|pkg|dmg|AppImage|deb|flatpak|zip|7z)$/i)?.[1];
	const os = platform ?? (/[-_]win(?:dows)?[-_]/i.test(filename) ? 'win'
		: /[-_]mac(?:os)?[-_]/i.test(filename) ? 'mac' : /[-_]linux[-_]/i.test(filename) ? 'linux' : null);
	const architecture = /arm64|aarch64/i.test(filename) ? 'arm64'
		: /universal/i.test(filename) ? 'universal'
			: /x86_64|amd64|x64|64bit/i.test(filename) ? 'x64'
				: /32bit|x86|i[3-6]86/i.test(filename) ? 'x86' : null;
	if (!format || !platforms[os] || !architecture) return null;
	const variant = filename.match(/-(20\.04|22\.04)\.AppImage$/)?.[1];
	return { name, url, platform: os, architecture, format, ...(variant ? { variant } : {}) };
}

/** Read the upstream data literal without importing or evaluating remote TypeScript. */
export function parseAudacityReleases(source) {
	const literal = source.match(/export\s+const\s+audacityReleases(?:\s*:\s*\w+)?\s*=\s*\{([\s\S]*?)^\s*\};/m)?.[1];
	const version = literal?.match(/\bversion:\s*["'](4\.\d+\.\d+)["']/)?.[1];
	if (!version) throw new Error('Audacity 4 release data is unavailable.');
	const assets = [];
	for (const [, os, entries] of literal.matchAll(/\b(win|mac|lin):\s*\[([\s\S]*?)\]/g)) {
		for (const [entry] of entries.matchAll(/\{[^{}]*\}/g)) {
			const name = entry.match(/\bname:\s*["']([^"']+)["']/)?.[1];
			const url = entry.match(/\bbrowser_download_url:\s*["']([^"']+)["']/)?.[1];
			const asset = downloadAsset(name, url, os === 'lin' ? 'linux' : os);
			if (asset && new URL(asset.url).pathname.includes(`/Audacity-${version}/`)) assets.push(asset);
		}
	}
	if (!assets.length) throw new Error('Audacity 4 has no desktop downloads.');
	return { version, url: `https://github.com/audacity/audacity/releases/tag/Audacity-${version}`, assets };
}

export function parseAudacity3Release(release) {
	if (release?.tag_name !== 'Audacity-3.7.9') throw new Error('Expected Audacity 3.7.9.');
	const assets = release.assets.flatMap(asset => {
		const parsed = downloadAsset(asset.name, asset.browser_download_url);
		return parsed ? [parsed] : [];
	});
	if (!assets.length) throw new Error('Audacity 3.7.9 has no desktop downloads.');
	return { version: '3.7.9', url: 'https://github.com/audacity/audacity/releases/tag/Audacity-3.7.9', assets };
}

/** Match Soundscaper's download page: one published RC, never Framescaper or nightly builds. */
export function selectSoundscaperRelease(releases) {
	if (!Array.isArray(releases)) throw new Error('Invalid Soundscaper releases.');
	const candidates = releases.filter(release => release?.draft === false
		&& /^(?:soundscaper-v\d+\.\d+\.\d+-rc\.[\w.-]+|Soundscaper-rc\.\d{4}\.[A-Z][a-z]{2}\.\d{1,2}\.[a-z]+)$/.test(release.tag_name)
		&& Number.isFinite(Date.parse(release.published_at)))
		.sort((a, b) => compareCalendarTags(b.tag_name, a.tag_name)
			|| Date.parse(b.published_at) - Date.parse(a.published_at));
	for (const release of candidates) {
		const version = release.tag_name.replace(/^soundscaper-v/, '');
		const prefix = release.tag_name.startsWith('Soundscaper-rc.') ? release.tag_name : `Soundscaper-${version}`;
		const assets = (release.assets ?? []).flatMap(asset => {
			if (asset.state !== 'uploaded' || !asset.name?.startsWith(`${prefix}-`)) return [];
			const target = asset.name.slice(prefix.length + 1);
			if (!/^(?:win-(?:x64|arm64)\.(?:exe|zip)|mac-arm64\.(?:pkg|dmg)|linux-(?:x64|arm64)\.(?:AppImage|deb|flatpak))$/.test(target)) return [];
			const parsed = downloadAsset(asset.name, asset.browser_download_url);
			return parsed ? [parsed] : [];
		});
		if (assets.length) return { version, url: assets[0].url.split('/download/')[0] + `/tag/${encodeURIComponent(release.tag_name)}`, assets };
	}
	throw new Error('Soundscaper has no published release candidate.');
}

// Soundscaper's calendar versions supersede the semantic RC line and sort by version, not publication time.
function compareCalendarTags(left, right) {
	const key = tag => {
		const match = /^Soundscaper-rc\.(\d{4})\.([A-Z][a-z]{2})\.(\d{1,2})\.([a-z]+)$/.exec(tag);
		return match ? [Number(match[1]), ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].indexOf(match[2]), Number(match[3]), match[4].length, match[4]] : null;
	};
	const a = key(left), b = key(right);
	if (!a || !b) return Number(Boolean(a)) - Number(Boolean(b));
	for (let index = 0; index < a.length; index++) {
		if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
	}
	return 0;
}

export async function fetchSoundscaperRelease(fetchImpl = fetch) {
	const releases = [];
	const signal = AbortSignal.timeout(8000);
	for (let page = 1; page <= 5; page++) {
		const url = new URL(SOUNDSCAPER_RELEASES_URL);
		url.searchParams.set('page', String(page));
		const response = await fetchImpl(url.toString(), { signal });
		if (!response.ok) throw new Error(`Soundscaper release lookup failed (${response.status}).`);
		const entries = await response.json();
		if (!Array.isArray(entries)) throw new Error('Invalid Soundscaper releases.');
		releases.push(...entries);
		if (!/rel="next"/.test(response.headers.get('link') ?? '')) return selectSoundscaperRelease(releases);
	}
	throw new Error('Soundscaper release listing exceeded five pages.');
}

/** Client hints describe native hardware even when the compatibility UA says x64. */
export function detectDownloadEnvironment({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}, hints = {}) {
	if (hints.mobile || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
		|| (/Mac/i.test(platform) && maxTouchPoints > 1)) return { platform: null, architecture: null };
	const os = (hints.platform || platform || userAgent).toLowerCase();
	const detectedPlatform = /win/.test(os) ? 'win' : /mac/.test(os) ? 'mac' : /linux/.test(os) ? 'linux' : null;
	let architecture = null;
	if (hints.bitness === '32') architecture = hints.architecture === 'x86' ? 'x86' : 'unsupported';
	else if (/^(arm64|aarch64)$/i.test(hints.architecture ?? '')) architecture = 'arm64';
	else if (hints.architecture === 'arm') architecture = hints.bitness === '64' ? 'arm64' : null;
	else if (/x86|x64/i.test(hints.architecture ?? '')) architecture = hints.bitness === '64' ? 'x64' : null;
	else if (hints.architecture) architecture = 'unsupported';
	else if (/arm64|aarch64/i.test(userAgent)) architecture = 'arm64';
	else if (detectedPlatform !== 'mac' && /x86_64|amd64|Win64|WOW64|\bx64\b/i.test(userAgent)) architecture = 'x64';
	else if (detectedPlatform !== 'mac' && /\bi[3-6]86\b|Windows NT.*Win32/i.test(userAgent)) architecture = 'x86';
	// Safari's Intel Mac UA also appears on Apple Silicon; only universal packages are safe there.
	return { platform: detectedPlatform, architecture };
}

export async function getDownloadEnvironment(navigatorLike) {
	const data = navigatorLike.userAgentData;
	let hints = { platform: data?.platform, mobile: data?.mobile };
	try {
		hints = { ...hints, ...await data?.getHighEntropyValues(['architecture', 'bitness']) };
	} catch {
		// Browsers may refuse high entropy hints; retain the UA and low entropy platform hints.
	}
	return detectDownloadEnvironment(navigatorLike, hints);
}

const formatPriority = { exe: 0, msi: 0, pkg: 0, dmg: 1, appimage: 0, deb: 1, flatpak: 2, zip: 3, '7z': 3 };

export function matchingDownloads(assets, environment) {
	if (!environment.platform) return [];
	return assets.filter(asset => asset.platform === environment.platform
		&& (asset.architecture === 'universal' || asset.architecture === environment.architecture))
		.sort((a, b) => (formatPriority[a.format.toLowerCase()] - formatPriority[b.format.toLowerCase()])
			|| Number(a.architecture === 'universal') - Number(b.architecture === 'universal')
			|| (a.variant ?? '').localeCompare(b.variant ?? ''));
}

export function downloadAssetLabel(asset) {
	const architecture = { x64: 'x64 / Intel', arm64: 'ARM64', x86: '32-bit', universal: 'Universal' }[asset.architecture];
	return `${platforms[asset.platform]} · ${architecture} · ${asset.format}${asset.variant ? ` (Ubuntu ${asset.variant}+)` : ''}`;
}

/** Keep the source post's version heading, date, scope notes and all comparison tables together. */
export function extractComparisonHtml(html) {
	const first = html.indexOf('<table');
	const last = html.lastIndexOf('</table>');
	const start = html.lastIndexOf('<h2', first);
	if (first < 0 || last < first || start < 0) throw new Error('The Audacity comparison post has no comparison tables.');
	return html.slice(start, last + '</table>'.length);
}

const omittedComparisonFeatures = new Set([
	'Export each label as its own file', 'Export tracks as separate stems', 'Trim audio outside the selection',
	'Jedes Label als separate Datei exportieren', 'Spuren als separate Stems exportieren', 'Audio außerhalb der Auswahl kürzen',
]);

/** Adapt the source article's table for the download page while keeping its reviewed feature notes. */
export function formatDownloadComparisonHtml(html) {
	let heading;
	const comparison = extractComparisonHtml(html).replace(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g, (row, attributes, content) => {
		const cells = [...content.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g)];
		if (cells.length !== 4) return row;
		const feature = cells[0][3].replace(/<[^>]*>/g, '').trim();
		if (omittedComparisonFeatures.has(feature)) return '';
		const ordered = [cells[0], cells[3], cells[2], cells[1]];
		if (cells[0][1] === 'th') {
			heading = ordered.slice(1).map(cell => cell[3]).join(' vs. ');
			return `<tr${attributes}>${ordered.map(cell => cell[0]).join('')}</tr>`;
		}
		return `<tr${attributes}>${ordered.map((cell, index) => index === 0 ? cell[0] : formatComparisonCell(cell)).join('')}</tr>`;
	});
	return heading ? comparison.replace(/(<h2\b[^>]*>)[\s\S]*?(<\/h2>)/, `$1${heading}$2`) : comparison;
}

function formatComparisonCell(cell) {
	const content = cell[3].trim();
	const match = /^(Yes|No|Partial|Ja|Nein|Teilweise|Kein)\b/i.exec(content);
	if (!match) return cell[0];
	const detail = content.slice(match[0].length).replace(/^\s*[–—-]?\s*/, '');
	let status = /^(Yes|Ja)$/i.test(match[0]) ? 'yes' : /^(Partial|Teilweise)$/i.test(match[0]) ? 'partial' : 'no';
	if (status === 'yes' && /^(including JS scripting|and more added|also added spectral drawing|inklusive JS-Skripting|und mehr hinzugefügt|auch spektrales Zeichnen hinzugefügt)$/i.test(detail)) status = 'extra';
	const symbol = { yes: '+', no: '/', partial: '~', extra: '★' }[status];
	return `<td${cell[2]} class="comparison-cell--${status}"><span class="comparison-symbol" aria-hidden="true">${symbol}</span><span class="comparison-status-label">${match[0]}</span>${detail ? ` <span class="comparison-detail">${detail}</span>` : ''}</td>`;
}
