import { expect, test } from '@playwright/test';

const articles = [
	['/en/audacity/the-best-free-audacity-alternative-2027/', '/audacity/die-beste-kostenlose-audacity-alternative-2027/'],
	['/en/audacity/the-best-free-adobe-audition-alternative-2027/', '/audacity/die-beste-kostenlose-adobe-audition-alternative-2027/'],
];

for (const [original, translation] of articles) {
	test(`AI disclosure and translation link for ${original}`, async ({ page }) => {
		await page.goto(original);
		await expect(page.locator('.article-disclosure')).toHaveText('This article was AI generated.');
		await expect(page.locator('[data-kwm-part="post-disclosure"]')).toHaveCount(1);
		await expect(page.locator(`link[hreflang="de"]`)).toHaveAttribute('href', new RegExp(`${translation}$`));

		await page.goto(translation);
		await expect(page.locator('.article-disclosure')).toHaveText('Dieser Artikel wurde KI-generiert.');
		const translationNotice = page.locator('[data-kwm-part="post-disclosure"]').filter({ hasText: 'automatisch aus' });
		await expect(translationNotice).toContainText('übersetzt.');
		await expect(translationNotice.getByRole('link', { name: 'dem Original' })).toHaveAttribute('href', original);
		await expect(page.locator('link[hreflang="en"]')).toHaveAttribute('href', new RegExp(`${original}$`));
	});
}

test('video posts retain their existing source-specific AI disclosure', async ({ page }) => {
	await page.goto('/audacity/missing-macros-in-audacity-4-0-here-is-the-solution/');
	const notice = page.locator('.article-disclosure');
	await expect(notice).toContainText('This article was AI generated based on');
	await expect(notice.getByRole('link', { name: 'our video' })).toHaveAttribute('href', /youtube\.com/);
});
