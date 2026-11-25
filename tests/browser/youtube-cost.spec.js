import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { PRICE_LEVELS } from '../../src/lib/tools/youtube-cost.js';

const EN = '/en/tools/youtube-channel-cost/';
const DE = '/de/tools/youtube-kanal-kosten/';

test.describe('YouTube cost calculator', () => {
	test('starts with the current threshold and shows the numbers from the video', async ({ page }) => {
		await page.goto(EN);
		const tool = page.locator('[data-youtube-cost]');

		await expect(tool.locator('[data-preset="today"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(tool.locator('[data-cell="google.longform"]')).toHaveText('$6');
		await expect(tool.locator('[data-cell="aws.longform"]')).toHaveText('$210');
		await expect(tool.locator('[data-cell="google.shorts"]')).toHaveText('$15');
		await expect(tool.locator('[data-cell="google.live"]')).toHaveText('$140');
		await expect(tool.locator('tbody tr')).toHaveCount(PRICE_LEVELS.length * 2);
	});

	test('presets fill the fields and recalculate', async ({ page }) => {
		await page.goto(EN);
		const tool = page.locator('[data-youtube-cost]');

		await tool.locator('[data-preset="2027"]').click();

		await expect(tool.locator('[name="longform.watchHours"]')).toHaveValue('8000');
		await expect(tool.locator('[name="shorts.views"]')).toHaveValue('20000000');
		await expect(tool.locator('[data-cell="google.shorts"]')).toHaveText('$27');
		await expect(tool.locator('[data-preset="2027"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(tool.locator('[data-preset="today"]')).toHaveAttribute('aria-pressed', 'false');
	});

	test('own numbers update every result and release the preset', async ({ page }) => {
		await page.goto(EN);
		const tool = page.locator('[data-youtube-cost]');

		for (const input of await tool.locator('input').all()) await input.fill('0');
		await expect(tool.locator('[data-stat="google"]')).toHaveText('$0');
		await expect(tool.locator('[data-preset][aria-pressed="true"]')).toHaveCount(0);

		await tool.locator('[name="live.perWeek"]').fill('3');
		await tool.locator('[name="live.hours"]').fill('3');
		await expect(tool.locator('[data-cell="aws.encoding"]')).toHaveText('$940');
		await expect(tool.locator('[data-cell="aws.delivery"]')).toHaveText('$0');
		await expect(tool.locator('[data-cell="aws.longform"]')).toHaveText('$0');
		await expect(tool.locator('[data-volume]')).toContainText('468 hours of material');
	});

	test('the German page formats numbers in German and links to the German offer', async ({ page }) => {
		await page.goto(DE);
		const tool = page.locator('[data-youtube-cost]');

		await expect(tool.locator('[data-cell="aws.shorts"]')).toHaveText(/^1\.300\s\$$/);
		await expect(tool.locator('a[href="/de/kanal-check/"]')).toBeVisible();
		await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', new RegExp(`${EN}$`));
	});

	for (const path of [EN, DE]) {
		test(`has no accessibility violations or page overflow on ${path}`, async ({ page }) => {
			await page.setViewportSize({ width: 375, height: 812 });
			await page.goto(path);
			await page.locator('[data-youtube-cost] details summary').click();

			const results = await new AxeBuilder({ page }).include('[data-youtube-cost]').analyze();
			expect(results.violations).toEqual([]);
			expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
		});
	}
});
