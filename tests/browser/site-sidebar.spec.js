import { expect, test } from '@playwright/test';

async function sidebarLayout(page) {
	return page.evaluate(() => {
		const logo = [...document.querySelectorAll('.site-sidebar .brand img')].find((image) => image.offsetParent !== null);
		const firstLink = document.querySelector('.site-sidebar .sidebar-link');
		return {
			logo: logo?.getAttribute('src'),
			logoLoaded: Boolean(logo?.complete && logo.naturalWidth > 0),
			logoWidth: logo?.getBoundingClientRect().width,
			logoHeight: logo?.getBoundingClientRect().height,
			navTop: firstLink?.getBoundingClientRect().top,
		};
	});
}

test.describe('site sidebar', () => {
	test.use({ viewport: { width: 1280, height: 900 } });

	test('switching the theme swaps the logo without moving the navigation', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' });
		await page.goto('/');
		await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'dark');
		const light = await sidebarLayout(page);

		await page.locator('.site-sidebar [data-theme-toggle]').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		const dark = await sidebarLayout(page);

		expect(light.logo).toContain('logo-schwarz.svg');
		expect(dark.logo).toContain('logo-wei');
		expect(light.logoLoaded && dark.logoLoaded).toBe(true);
		expect(dark.logoWidth).toBeCloseTo(light.logoWidth, 0);
		expect(dark.logoHeight).toBeCloseTo(light.logoHeight, 0);
		expect(dark.navTop).toBeCloseTo(light.navTop, 0);
	});
});
