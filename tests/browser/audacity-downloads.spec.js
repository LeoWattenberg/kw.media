import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { DOWNLOAD_LANGUAGES, downloadComparisonUrl, downloadPagePath } from '../../src/lib/audacity-download-localization.js';

const releases = JSON.parse(readFileSync(new URL('../../src/data/audacity-downloads.json', import.meta.url)));
const card = (page, product) => page.locator(`[data-product="${product}"]`);
const primary = (page, product) => card(page, product).locator('[data-primary-download]');

async function environment(page, { platform = 'Win32', userAgent = 'Windows NT 10.0; Win64; x64', hints = null, maxTouchPoints = 0 } = {}) {
	await page.addInitScript(values => {
		for (const name of ['platform', 'userAgent', 'maxTouchPoints']) Object.defineProperty(navigator, name, { value: values[name], configurable: true });
		Object.defineProperty(navigator, 'userAgentData', {
			value: values.hints ? { ...values.hints, getHighEntropyValues: async () => values.hints } : undefined,
			configurable: true,
		});
	}, { platform, userAgent, hints, maxTouchPoints });
}

test.beforeEach(async ({ page }) => {
	// Source outages must leave every snapshot download usable, without relying on live GitHub availability.
	await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ status: 503, body: 'Unavailable' }));
	await page.route('https://api.github.com/**', route => route.fulfill({ status: 403, body: 'Rate limited' }));
});

async function open(page, locale = 'en') {
	await page.goto(`/audacity/download/${locale}/`);
	await expect(page.locator('[data-audacity-downloads]')).toHaveAttribute('data-download-ready', 'true');
}

test('Windows gets installers, with portable packages and other systems in the split button', async ({ page }) => {
	await environment(page);
	await open(page);
	await expect(primary(page, 'soundscaper')).toHaveAttribute('href', /-win-x64\.exe$/);
	await expect(primary(page, 'audacity4')).toHaveAttribute('href', /-x86_64\.msi$/);
	await expect(primary(page, 'audacity3')).toHaveAttribute('href', /-64bit\.exe$/);
	await card(page, 'soundscaper').getByLabel('Other downloads for Soundscaper', { exact: true }).filter({ has: page.locator('svg') }).click();
	const menu = card(page, 'soundscaper').getByRole('navigation');
	await expect(menu).toBeVisible();
	await expect(menu.getByRole('link', { name: 'Windows · x64 / Intel · zip', exact: true })).toHaveAttribute('href', /-win-x64\.zip$/);
	await expect(menu.getByRole('link', { name: 'Windows · x64 / Intel · exe', exact: true })).toHaveCount(0);
	await expect(menu.getByRole('link', { name: 'macOS · ARM64 · pkg', exact: true })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
	await expect(card(page, 'soundscaper').locator('summary')).toBeFocused();
	await card(page, 'soundscaper').locator('summary').click();
	await card(page, 'audacity4').locator('summary').click();
	await expect(menu).toBeHidden();
	await expect(card(page, 'audacity4').getByRole('navigation')).toBeVisible();
	await page.getByRole('heading', { level: 1 }).click();
	await expect(card(page, 'audacity4').getByRole('navigation')).toBeHidden();
});

test('native Windows ARM64 hints override the x64 compatibility UA', async ({ page }) => {
	await environment(page, { hints: { platform: 'Windows', architecture: 'arm', bitness: '64', mobile: false } });
	await open(page);
	for (const product of ['soundscaper', 'audacity4', 'audacity3']) {
		await expect(primary(page, product)).toHaveAttribute('href', /-arm64\.(exe|msi)$/);
	}
});

test('refreshes version labels and real package links from both upstream feeds', async ({ page }) => {
	const version = '4.1.0';
	await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({
		body: `export const audacityReleases: ReleaseDirectory = {
 version: "${version}",
 win: [{ name: "x86_64 MSI installer", browser_download_url: "https://github.com/audacity/audacity/releases/download/Audacity-${version}/audacity-win-${version}-x86_64.msi", type: ".msi" }],
 mac: [], lin: [],
};`,
	}));
	const tag = 'Soundscaper-rc.2026.Nov.15.a';
	await page.route('https://api.github.com/**', route => route.fulfill({ json: [{
		tag_name: tag, published_at: '2026-11-15T10:00:00Z', draft: false,
		assets: ['win-x64.exe', 'win-x64.zip'].map(target => ({
			name: `${tag}-${target}`, state: 'uploaded',
			browser_download_url: `https://github.com/mindscaper-org/Soundscaper/releases/download/${tag}/${tag}-${target}`,
		})),
	}] }));
	await environment(page);
	await open(page);
	await expect(primary(page, 'audacity4')).toContainText('Download Audacity 4.1.0');
	await expect(card(page, 'audacity4').locator('.download-description')).toContainText('Audacity 4.1.0, the latest version');
	await expect(primary(page, 'audacity4')).toHaveAttribute('href', /Audacity-4\.1\.0\/audacity-win-4\.1\.0-x86_64\.msi$/);
	await expect(primary(page, 'soundscaper')).toContainText(tag);
	await expect(primary(page, 'soundscaper')).toHaveAttribute('href', new RegExp(`${tag}/${tag}-win-x64\\.exe$`));
	// The comparison remains explicitly tied to the post's reviewed versions.
	await expect(page.locator('.download-comparison table th').nth(2)).toHaveText('Audacity 4.0.2');
});

test('Linux ARM64 receives AppImages and opens manual choices for unsupported Audacity 3', async ({ page }) => {
	await environment(page, { platform: 'Linux aarch64', userAgent: 'X11; Linux aarch64' });
	await open(page);
	await expect(primary(page, 'soundscaper')).toHaveAttribute('href', /-linux-arm64\.AppImage$/);
	await expect(primary(page, 'audacity4')).toHaveAttribute('href', /-aarch64\.AppImage$/);
	await expect(card(page, 'audacity3').locator('[data-download-note]')).toContainText('No matching download');
	await primary(page, 'audacity3').click();
	await expect(card(page, 'audacity3').getByRole('navigation')).toBeVisible();
	await expect(card(page, 'audacity3').getByRole('link', { name: 'Windows · 32-bit · exe', exact: true })).toHaveAttribute('href', /-32bit\.exe$/);
});

test('Apple Silicon uses native packages, while Safari without CPU hints uses universal packages', async ({ page }) => {
	await environment(page, { platform: 'MacIntel', userAgent: 'Macintosh; Intel Mac OS X 10_15_7', hints: { platform: 'macOS', architecture: 'arm', bitness: '64' } });
	await open(page);
	await expect(primary(page, 'soundscaper')).toHaveAttribute('href', /-mac-arm64\.pkg$/);
	await expect(primary(page, 'audacity4')).toHaveAttribute('href', /-arm64\.dmg$/);
	await expect(primary(page, 'audacity3')).toHaveAttribute('href', /-universal\.pkg$/);
	await environment(page, { platform: 'MacIntel', userAgent: 'Macintosh; Intel Mac OS X 10_15_7' });
	await open(page);
	await expect(primary(page, 'audacity4')).toHaveAttribute('href', /-universal\.dmg$/);
	await expect(primary(page, 'audacity3')).toHaveAttribute('href', /-universal\.pkg$/);
	await primary(page, 'soundscaper').click();
	await expect(card(page, 'soundscaper').getByRole('navigation')).toBeVisible();
});

async function comparisonRows(page, selector) {
	return page.locator(`${selector} table tr`).evaluateAll(rows => rows.map(row => [...row.cells].map(cell => {
		const copy = cell.cloneNode(true);
		copy.querySelectorAll('.comparison-symbol').forEach(symbol => symbol.remove());
		return copy.textContent.trim().replace(/\s+/g, ' ').replace(/^(Yes|Ja|No|Nein|Kein|Partial|Teilweise)\s*[–—-]\s*/, '$1 ');
	})));
}

test('German and English comparisons follow download order and retain the translated notes and language links', async ({ page }) => {
	await environment(page);
	for (const [locale, postPath, heading] of [
		['de', '/audacity/audacity-4-fehlt-vieles-von-audacity-3-ich-habe-es-hinzugefugt/', 'Audacity und Soundscaper herunterladen'],
		['en', '/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/', 'Download Audacity and Soundscaper'],
	]) {
		await open(page, locale);
		await expect(page.locator('html')).toHaveAttribute('lang', locale);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://kw.media/audacity/download/${locale}/`);
		const comparison = await comparisonRows(page, '.download-comparison');
		expect(comparison.length).toBeGreaterThan(0);
		expect(comparison[0]).toEqual([locale === 'de' ? 'Funktion' : 'Feature', 'Soundscaper', 'Audacity 4.0.2', 'Audacity 3.7.9']);
		await expect(page.locator('.download-comparison h2')).toHaveText('Soundscaper vs. Audacity 4.0.2 vs. Audacity 3.7.9');
		await expect(page.locator('.comparison-cell--extra')).toHaveCount(3);
		await expect(page.locator('.comparison-cell--extra .comparison-symbol')).toHaveText(['★', '★', '★']);
		await expect(page.locator('.comparison-cell--partial .comparison-symbol')).toHaveText('~');
		const macros = page.locator('.download-comparison tr').filter({ has: page.getByRole('cell', { name: locale === 'de' ? 'Makros' : 'Macros', exact: true }) });
		await expect(macros.locator('.comparison-symbol')).toHaveText(['★', '/', '+']);
		await expect(page.locator('.download-comparison')).toContainText(locale === 'de' ? 'Aktualisiert am 15. November 2026' : 'Updated November 15, 2026');
		const other = locale === 'de' ? 'en' : 'de';
		await page.locator('[data-language-menu] summary').click();
		await expect(page.locator(`[data-language-menu] a[hreflang="${other}"]`)).toHaveAttribute('href', `/audacity/download/${other}/`);
		await expect(page.locator('.comparison-source')).toHaveAttribute('href', downloadComparisonUrl(locale));
		await page.goto(postPath);
		const omitted = locale === 'de'
			? ['Jedes Label als separate Datei exportieren', 'Spuren als separate Stems exportieren', 'Audio außerhalb der Auswahl kürzen']
			: ['Export each label as its own file', 'Export tracks as separate stems', 'Trim audio outside the selection'];
		const original = await comparisonRows(page, '.content-html');
		expect(original.length - comparison.length).toBe(3);
		expect(original.filter(row => !omitted.includes(row[0])).map(row => [row[0], row[3], row[2], row[1]])).toEqual(comparison);
	}
});

test('desktop uses 2:1:1 columns and mobile stacks without horizontal overflow', async ({ page }) => {
	await environment(page);
	await page.setViewportSize({ width: 1536, height: 1000 });
	await open(page);
	const bounds = await page.locator('.download-card').evaluateAll(cards => cards.map(card => ({ top: card.offsetTop, width: card.getBoundingClientRect().width })));
	expect(bounds[0].top).toEqual(bounds[1].top);
	expect(bounds[1].top).toEqual(bounds[2].top);
	expect(bounds[0].width / bounds[1].width).toBeCloseTo(2, 1);
	expect(bounds[1].width).toBeCloseTo(bounds[2].width, 1);
	await page.screenshot({ path: 'test-results/audacity-downloads-desktop.png', fullPage: true });
	await page.setViewportSize({ width: 390, height: 844 });
	await environment(page, { platform: 'iPhone', userAgent: 'iPhone; CPU iPhone OS 18', maxTouchPoints: 5 });
	await open(page);
	const mobileBounds = await page.locator('.download-card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().top));
	expect(mobileBounds[1]).toBeGreaterThan(mobileBounds[0]);
	expect(mobileBounds[2]).toBeGreaterThan(mobileBounds[1]);
	await expect(card(page, 'soundscaper').getByRole('link', { name: 'Open online version' })).toHaveAttribute('href', 'https://soundscaper.org/en/');
	await primary(page, 'soundscaper').click();
	await expect(card(page, 'soundscaper').getByRole('navigation')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.screenshot({ path: 'test-results/audacity-downloads-mobile.png', fullPage: true });
});

test('download controls and comparison tables pass accessibility checks in both themes', async ({ page }) => {
	await environment(page);
	await open(page);
	for (const theme of ['light', 'dark']) {
		await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
		const statusColors = await page.locator('.comparison-cell--extra, .comparison-cell--partial, .comparison-cell--yes, .comparison-cell--no').evaluateAll(cells => {
			return Object.fromEntries(cells.map(cell => [cell.className, getComputedStyle(cell).backgroundColor]));
		});
		expect(new Set(Object.values(statusColors)).size).toBe(4);
		await card(page, 'soundscaper').locator('summary').click();
		const result = await new AxeBuilder({ page }).include('.downloads-section').include('.comparison-section').analyze();
		expect(result.violations).toEqual([]);
		await page.keyboard.press('Escape');
	}
});

test('static versions, every package and comparison tables remain available without JavaScript', async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto('/audacity/download/en/');
	for (const [product, release] of Object.entries(releases)) {
		await expect(primary(page, product)).toHaveAttribute('href', release.url);
		await expect(primary(page, product)).toContainText(release.version);
		await card(page, product).locator('summary').click();
		await expect(card(page, product).getByRole('navigation')).toBeVisible();
		await expect(card(page, product).locator('[data-download-list] a')).toHaveCount(release.assets.length);
	}
	await expect(page.locator('.download-comparison table')).toBeVisible();
	await page.locator('[data-language-menu] summary').click();
	await expect(page.locator('[data-language-menu] a')).toHaveCount(27);
	await page.locator('[data-language-menu] a[hreflang="ja"]').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'ja');
	await expect(page.locator('.download-comparison')).toContainText('マクロ');
	await context.close();
});

for (const language of DOWNLOAD_LANGUAGES.filter(language => language !== 'en' && language !== 'de')) {
	test(`${language} translates the download page, including comparison details, and offers all 27 languages`, async ({ page }) => {
		const catalog = JSON.parse(readFileSync(new URL(`../../src/data/audacity-download-locales/${language}.json`, import.meta.url)));
		await environment(page);
		await page.goto(downloadPagePath(language));
		await expect(page.locator('[data-audacity-downloads]')).toHaveAttribute('data-download-ready', 'true');
		await expect(page.locator('html')).toHaveAttribute('lang', language);
		await expect(page.locator('html')).toHaveAttribute('dir', catalog.direction);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(catalog.copy.heading);
		await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', catalog.description);
		await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://kw.media${downloadPagePath(language)}`);
		await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(28);
		await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute('href', 'https://kw.media/audacity/download/en/');
		await expect(page.locator('.comparison-source')).toHaveAttribute('href', downloadComparisonUrl(language));
		await expect(page.locator('.download-description a')).toHaveAttribute('href', downloadComparisonUrl(language));
		await expect(page.locator('.download-comparison table th').first()).toHaveText(catalog.comparison.Feature);
		await expect(page.locator('.download-comparison')).toContainText(catalog.comparison.Macros);
		await expect(page.locator('.download-comparison')).toContainText(catalog.comparison['including JS scripting']);
		await expect(page.locator('.comparison-cell--extra')).toHaveCount(3);
		await expect(page.locator('.comparison-cell--partial .comparison-symbol')).toHaveText('~');
		await expect(primary(page, 'audacity4')).toHaveAttribute('href', /-x86_64\.msi$/);
		await page.locator('[data-language-menu] summary').click();
		await expect(page.locator('[data-language-menu] a')).toHaveCount(27);
		await expect(page.locator('[data-language-menu] [aria-current="page"]')).toHaveText(catalog.nativeName);
		await expect(page.locator('[data-language-menu] a[hreflang="en"]')).toHaveAttribute('href', '/audacity/download/en/');
	});
}

test('the language switcher navigates among translated downloads, and other pages fall back to English', async ({ page }) => {
	await environment(page);
	await open(page);
	await page.locator('[data-language-menu] summary').click();
	await page.locator('[data-language-menu] a[hreflang="fr"]').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
	await page.locator('[data-language-menu] summary').click();
	await page.locator('[data-language-menu] a[hreflang="ar"]').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
	await expect(page.locator('.site-sidebar .brand')).toHaveAttribute('href', '/en/');
	await expect(page.locator('.breadcrumbs a').first()).toHaveAttribute('href', '/en/');
	await page.locator('.sidebar-link').filter({ hasText: /^Audacity$/ }).click();
	await expect(page).toHaveURL(/\/en\/audacity\/$/);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.locator('[data-language-menu]')).toHaveCount(0);
});

test('RTL translations fit mobile screens and the language menu works with a collapsed sidebar', async ({ page }) => {
	await environment(page);
	await page.setViewportSize({ width: 1280, height: 900 });
	await page.goto('/audacity/download/ar/');
	await page.locator('[data-sidebar-collapse-toggle]').click();
	await page.locator('[data-language-menu] summary').click();
	await page.locator('[data-language-menu] a[hreflang="he"]').click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'he');
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/audacity/download/ar/');
	await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
	await expect(page.locator('[data-audacity-downloads]')).toHaveAttribute('data-download-ready', 'true');
	await card(page, 'soundscaper').locator('summary').click();
	await expect(card(page, 'soundscaper').getByRole('navigation')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.keyboard.press('Escape');
	await page.locator('[data-language-menu] summary').click();
	await expect(page.locator('[data-language-menu] a[hreflang="en"]')).toBeVisible();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	for (const theme of ['light', 'dark']) {
		await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
		const result = await new AxeBuilder({ page }).include('.downloads-section').include('.comparison-section').include('[data-language-menu]').analyze();
		expect(result.violations).toEqual([]);
	}
	await page.screenshot({ path: 'test-results/audacity-downloads-arabic-mobile.png', fullPage: false });
});
