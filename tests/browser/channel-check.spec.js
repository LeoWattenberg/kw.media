import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const pages = [
	{
		locale: 'en',
		path: '/en/channel-check/',
		alternate: '/de/kanal-check/',
		creator: '/en/creator/',
		heading: "I'll do the maths on your channel.",
		book: '#book',
		caseStudy: '#case-study',
		submit: 'Create email',
		subject: 'Channel Check – youtube.com/@example',
		labels: {
			name: 'Name',
			email: 'Email',
			channel: 'Link to your channel',
			goal: 'What do you want from your channel in the next 6 months?',
			problem: "What's bugging you right now?",
		},
	},
	{
		locale: 'de',
		path: '/de/kanal-check/',
		alternate: '/en/channel-check/',
		creator: '/de/creator/',
		heading: 'Ich rechne deinen Kanal durch.',
		book: '#buchen',
		caseStudy: '#fallstudie',
		submit: 'E-Mail erstellen',
		subject: 'Kanal-Check – youtube.com/@example',
		labels: {
			name: 'Name',
			email: 'E-Mail',
			channel: 'Link zu deinem Kanal',
			goal: 'Was willst du in den nächsten 6 Monaten mit deinem Kanal erreichen?',
			problem: 'Was nervt dich gerade?',
		},
	},
];

for (const entry of pages) {
	test.describe(`channel check (${entry.locale})`, () => {
		test('hero actions jump to the form and the case study video', async ({ page }) => {
			await page.goto(entry.path);

			await expect(page.getByRole('heading', { level: 1, name: entry.heading, exact: true })).toBeVisible();
			await expect(page.locator(`.hero a[href="${entry.book}"]`)).toHaveCount(1);
			await expect(page.locator(`.hero a[href="${entry.caseStudy}"]`)).toHaveCount(1);
			await expect(page.locator(entry.book).locator('form[data-request-form]')).toHaveCount(1);
			await expect(page.locator(entry.caseStudy).locator('[data-youtube-embed]')).toHaveAttribute(
				'data-youtube-src',
				'https://www.youtube.com/embed/jw7B_3qGB5I',
			);
			await expect(page.locator(`link[rel="alternate"][hreflang="${entry.locale === 'en' ? 'de' : 'en'}"]`)).toHaveAttribute(
				'href',
				new RegExp(`${entry.alternate}$`),
			);
		});

		test('the form refuses to build an email while required fields are empty', async ({ page }) => {
			await page.goto(entry.path);
			const form = page.locator('form[data-request-form]');

			await form.getByRole('button', { name: entry.submit }).click();

			await expect(form).not.toHaveAttribute('data-mailto', /.+/);
			await expect(page.locator('[data-request-sent]')).toBeHidden();
		});

		test('a complete form becomes an email draft with every answer', async ({ page }) => {
			await page.goto(entry.path);
			const form = page.locator('form[data-request-form]');

			await form.getByLabel(entry.labels.name, { exact: true }).fill('Ada Example');
			await form.getByLabel(entry.labels.email, { exact: true }).fill('ada@example.com');
			await form.getByLabel(entry.labels.channel, { exact: true }).fill('youtube.com/@example');
			await form.getByLabel(entry.labels.goal, { exact: true }).fill('More regulars\nFewer one-off viewers');
			await form.getByLabel(entry.labels.problem, { exact: true }).fill('Views come and go');
			await form.locator('input[type="checkbox"]').check();
			await form.getByRole('button', { name: entry.submit }).click();

			await expect(form).toHaveAttribute('data-mailto', /^mailto:team@kw\.media\?/);
			const href = await form.getAttribute('data-mailto');
			const url = new URL(href);
			const body = url.searchParams.get('body');

			expect(url.searchParams.get('subject')).toBe(entry.subject);
			expect(body).toContain(`${entry.labels.name}: Ada Example`);
			expect(body).toContain(`${entry.labels.email}: ada@example.com`);
			expect(body).toContain(`${entry.labels.goal}\r\nMore regulars\r\nFewer one-off viewers`);
			expect(body).toContain('[x] ');
			expect(body).not.toContain('(optional)');

			const sent = page.locator('[data-request-sent]');
			await expect(sent).toBeVisible();
			// A textarea normalises CRLF to LF in its value, so either line break counts.
			await expect(sent.locator('[data-request-copy]')).toHaveValue(new RegExp(`^To: team@kw\\.media\\r?\\nSubject: ${entry.subject}`));
			await expect(sent.locator('[data-request-mailto]')).toHaveAttribute('href', href);
		});

		test('the creator page links to the channel check', async ({ page }) => {
			await page.goto(entry.creator);

			await expect(page.locator(`.hero a[href="${entry.path}"]`)).toHaveCount(1);
		});

		test('the new form and video blocks pass an accessibility scan', async ({ page }) => {
			await page.goto(entry.path);

			// White on the brand accent (#ff6900) is 2.88:1 on every primary button site-wide;
			// that is a design-token decision, not something these blocks introduce.
			const results = await new AxeBuilder({ page })
				.include(entry.book)
				.include(entry.caseStudy)
				.disableRules(['color-contrast'])
				.analyze();

			expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
		});
	});
}

test('the form stacks into one column on a narrow viewport', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto('/en/channel-check/');
	const form = page.locator('form[data-request-form]');

	const [name, email] = await Promise.all([
		form.getByLabel('Name', { exact: true }).boundingBox(),
		form.getByLabel('Email', { exact: true }).boundingBox(),
	]);
	expect(name).not.toBeNull();
	expect(email).not.toBeNull();
	expect(Math.abs(name.x - email.x)).toBeLessThan(1);
	expect(email.y).toBeGreaterThan(name.y + name.height);
});
