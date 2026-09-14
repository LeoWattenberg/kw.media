import { expect, test } from '@playwright/test';

const projects = [
	['Soundscaper', 'https://soundscaper.org/'],
	['Framescaper', 'https://framescaper.org/'],
	['Mindscaper', 'https://mindscaper.org/'],
	['Det sker på Ærø', 'https://leowattenberg.github.io/aeroevents/'],
	['ongkirstempel', 'https://ongkirstempel.id/'],
	['Æ Sydbane', 'https://sydbane.dk/'],
];

test.describe('website design and management portfolio', () => {
	test('shows six English projects with useful responsive images and live links', async ({ page }) => {
		await page.goto('/en/website-design-management/');

		const portfolio = page.locator('[data-portfolio]');
		const grid = portfolio.locator('[data-portfolio-grid]');
		const cards = grid.locator(':scope > article');

		await expect(portfolio.getByRole('heading', {
			level: 2,
			name: 'From focused websites to full web applications',
			exact: true,
		})).toBeVisible();
		await expect(cards).toHaveCount(projects.length);

		for (const [title, href] of projects) {
			const card = cards.filter({
				has: page.getByRole('heading', { level: 3, name: title, exact: true }),
			});
			await expect(card).toHaveCount(1);
			await expect(card.getByRole('heading', { level: 3, name: title, exact: true })).toBeVisible();
			await expect(card.locator('a')).toHaveAttribute('href', href);

			const image = card.locator('img');
			await expect(image).toHaveCount(1);
			await expect(image).toHaveAttribute('srcset', /\S+\s+\d+w,\s*\S+\s+\d+w/);

			const alt = (await image.getAttribute('alt'))?.trim() ?? '';
			expect(alt.length, `${title} should have descriptive alt text`).toBeGreaterThan(10);
			expect(alt, `${title} alt text should not be a filename`).not.toMatch(/\.(?:avif|jpe?g|png|webp)$/i);
		}
	});

	test('stacks the portfolio cards in one column on a narrow viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/en/website-design-management/');

		const cards = page.locator('[data-portfolio-grid] > article');
		await expect(cards).toHaveCount(projects.length);

		const [first, second] = await Promise.all([
			cards.nth(0).boundingBox(),
			cards.nth(1).boundingBox(),
		]);
		expect(first).not.toBeNull();
		expect(second).not.toBeNull();
		expect(Math.abs(first.x - second.x)).toBeLessThan(1);
		expect(second.y).toBeGreaterThanOrEqual(first.y + first.height);
	});

	test('shows the complete German portfolio', async ({ page }) => {
		await page.goto('/de/webdesign-management/');

		const portfolio = page.locator('[data-portfolio]');
		await expect(portfolio.getByRole('heading', {
			level: 2,
			name: 'Von fokussierten Websites bis zu vollständigen Webanwendungen',
			exact: true,
		})).toBeVisible();
		await expect(portfolio.locator('[data-portfolio-grid] > article')).toHaveCount(projects.length);
	});
});
