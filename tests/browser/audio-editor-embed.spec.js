import { expect, test } from '@playwright/test';

for (const locale of ['de', 'en']) {
	test(`${locale} audio editor delegates to the locale-specific Soundscaper embed`, async ({ page }) => {
		await page.route('https://soundscaper.org/**', (route) => route.abort());
		await page.goto(`/${locale}/tools/audio-editor/`, { waitUntil: 'domcontentloaded' });
		const frame = page.locator('[data-soundscaper-embed] iframe');
		await expect(frame).toHaveAttribute('src', `https://soundscaper.org/embed/${locale}/`);
		await expect(frame).toHaveAttribute('allow', /microphone/);
		await expect(frame).toHaveAttribute('allow', /clipboard-write/);
		await expect(page.getByRole('link', { name: /Soundscaper/ }).last()).toHaveAttribute('href', `https://soundscaper.org/${locale}/`);
	});
}
