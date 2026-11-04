import { expect, test } from '@playwright/test';

for (const locale of ['de', 'en']) {
	for (const javaScriptEnabled of [true, false]) {
		test.describe(`${locale} audio editor with JavaScript ${javaScriptEnabled ? 'enabled' : 'disabled'}`, () => {
			test.use({ javaScriptEnabled });

			test('redirects to the locale-specific standalone Soundscaper', async ({ page, request }) => {
				const path = `/${locale}/tools/audio-editor/`;
				const destination = `https://soundscaper.org/${locale}/`;
				const response = await request.get(path);
				expect(response.ok()).toBe(true);
				const html = await response.text();
				expect(html).toContain(`<meta http-equiv="refresh" content="0;url=${destination}">`);
				expect(html).toContain(`<a href="${destination}">`);
				expect(html).not.toContain('<iframe');

				await page.route('https://soundscaper.org/**', async (route) => {
					expect(route.request().frame()).toBe(page.mainFrame());
					await route.fulfill({
						contentType: 'text/html',
						body: '<!doctype html><title>Soundscaper</title><h1>Soundscaper</h1>',
					});
				});
				await page.goto(path, { waitUntil: 'domcontentloaded' });
				await expect(page).toHaveURL(destination);
				await expect(page.getByRole('heading', { name: 'Soundscaper' })).toBeVisible();
			});
		});
	}
}
