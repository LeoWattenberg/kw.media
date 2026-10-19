import { expect, test } from '@playwright/test';

const streamTools = [
	{ id: 'tier-list', title: { de: 'Tierliste für Streams', en: 'Stream Tier List' } },
	{ id: 'stream-bingo', title: { de: 'Stream-Bingo', en: 'Stream Bingo' } },
	{ id: 'chat-hotwords', title: { de: 'Chat-Hotwords', en: 'Chat Hotwords' } },
	{ id: 'spin-wheel', title: { de: 'Glücksrad', en: 'Spin the Wheel' } },
	{ id: 'tournament-bracket', title: { de: 'Turnier-Bracket', en: 'Tournament Bracket' } },
	{ id: 'stream-scenes', title: { de: 'Szenen-Screens', en: 'Stream Scene Screens' } },
	{ id: 'death-counter', title: { de: 'Tod- & Challenge-Zähler', en: 'Death & Challenge Counter' } },
];

function collectErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text());
	});
	return errors;
}

async function openTool(page, locale, id) {
	await page.goto(`/${locale}/tools/${id}/`);
	const iframe = page.locator('[data-stream-tool-embed] iframe');
	await expect(iframe).toHaveAttribute('src', `/stream-tools/${id}.html?lang=${locale}&embed=1`);
	const frame = page.frameLocator('[data-stream-tool-embed] iframe');
	await expect(frame.locator('#stage')).toBeVisible();
	return frame;
}

test.describe('stream tool pages', () => {
	for (const locale of ['de', 'en']) {
		for (const tool of streamTools) {
			test(`${locale} ${tool.id} embeds the standalone tool in the page language`, async ({ page }) => {
				const errors = collectErrors(page);
				const frame = await openTool(page, locale, tool.id);

				await expect(page.locator('.tool-intro h1')).toHaveText(tool.title[locale]);
				await expect(frame.locator('html')).toHaveAttribute('lang', locale);
				await expect(frame.locator('html')).toHaveClass(/embedded/);
				await expect(frame.locator('.topbar .brand')).toBeHidden();
				await expect(frame.locator('#btnLang')).toBeHidden();
				await expect(frame.locator('#btnPopup')).toBeVisible();
				await expect(page.locator('[data-stream-tool-download]')).toHaveAttribute('href', `/stream-tools/${tool.id}.html`);
				await expect(page.locator('[data-stream-tool-download]')).toHaveAttribute('download', `kwmedia-${tool.id}.html`);
				await expect(page.locator('[data-stream-tool-open]')).toHaveAttribute('href', `/stream-tools/${tool.id}.html?lang=${locale}`);
				await expect(page.locator('[data-stream-tool-url]')).toHaveText(`https://kw.media/stream-tools/${tool.id}.html#stream`);

				expect(errors).toEqual([]);
			});
		}
	}

	test('standalone files keep their own logo and language switch outside the embed', async ({ page }) => {
		const errors = collectErrors(page);
		await page.goto('/stream-tools/spin-wheel.html?lang=en');
		await expect(page.locator('.topbar .brand')).toBeVisible();
		await expect(page.locator('.topbar .brand')).toContainText('Spin the Wheel');
		await expect(page.locator('#btnLang')).toContainText('Deutsch');
		expect(errors).toEqual([]);
	});

	test('the stream tools category lists all seven tools', async ({ page }) => {
		await page.goto('/de/tools/stream/');
		await expect(page.locator('[data-tool-category-card]')).toHaveCount(streamTools.length);
		for (const tool of streamTools) {
			await expect(page.locator(`[data-tool-category-card][href="/de/tools/${tool.id}/"]`)).toHaveCount(1);
		}
	});
});

test.describe('stream tools work inside the embed', () => {
	test('chat hotwords demo fills the ranking', async ({ page }) => {
		const frame = await openTool(page, 'en', 'chat-hotwords');
		await frame.locator('#btnDemo').click();
		await expect(frame.locator('#stage .hw-row:not(.gone)').first()).toBeVisible({ timeout: 8000 });
	});

	test('spin wheel draws a result from its entries', async ({ page }) => {
		test.setTimeout(45_000);
		const frame = await openTool(page, 'de', 'spin-wheel');
		await frame.locator('[data-seg=dur] [data-val="4"]').click();
		await frame.locator('#btnSpin').click();
		await expect(frame.locator('#stage .wh-banner')).toBeVisible({ timeout: 10_000 });
		const entries = (await frame.locator('[data-key=items]').inputValue()).split('\n');
		expect(entries).toContain(await frame.locator('#resName').textContent());
	});

	test('tournament bracket advances the picked contestant', async ({ page }) => {
		const frame = await openTool(page, 'en', 'tournament-bracket');
		await frame.locator('#btnA').click();
		await expect(frame.locator('#stage .tb-card.win')).toHaveCount(1);
		await expect(frame.locator('#stage .tb-cta')).toContainText('goes through');
	});

	test('scene screens start a countdown', async ({ page }) => {
		const frame = await openTool(page, 'de', 'stream-scenes');
		await frame.locator('#timerBox [data-set="10"]').click();
		await expect(frame.locator('#stage .sc-cd')).toHaveText(/^(10:00|09:5\d)$/);
	});

	test('death counter counts up', async ({ page }) => {
		const frame = await openTool(page, 'de', 'death-counter');
		await frame.locator('#ctrlList .ct-pm.primary').first().click();
		await expect(frame.locator('#stage .ct-tile:not(.ct-timer) .ct-val').first()).toHaveText('1');
	});
});
