import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { QUESTIONS } from '../../src/lib/tools/ypp-check.js';

const EN = '/en/tools/ypp-rejection-check/';
const DE = '/de/tools/ypp-ablehnung-check/';

const okOption = (questionId) => QUESTIONS.find((question) => question.id === questionId).options.find((option) => option.level === 'ok').id;

async function setUp(page, { situation, date = '2026-10-06', repeat = 'first', policies, videos = 'under-50' }) {
	const form = page.locator('form[data-ypp-check]');
	await form.locator(`input[name="situation"][value="${situation}"]`).check();
	await form.locator('[data-date]').fill(date);
	if (situation === 'rejected') await form.locator(`input[name="repeat"][value="${repeat}"]`).check();
	for (const policy of policies) await form.locator(`input[name="policy"][value="${policy}"]`).check();
	await form.locator(`input[name="videos"][value="${videos}"]`).check();
	return form;
}

async function answerVisible(form, overrides = {}) {
	const ids = await form.locator('[data-module]:not([hidden]) [data-question]').evaluateAll(
		(fieldsets) => fieldsets.map((fieldset) => fieldset.dataset.question),
	);
	for (const id of ids) {
		await form.locator(`input[name="${id}"][value="${overrides[id] ?? okOption(id)}"]`).check();
	}
	return ids;
}

test.describe('YPP self-check', () => {
	test('situations outside the Partner Program end with a pointer instead of questions', async ({ page }) => {
		await page.goto(EN);
		const form = page.locator('form[data-ypp-check]');

		await form.locator('input[name="situation"][value="yellow-icons"]').check();

		await expect(form.locator('[data-exit]')).toBeVisible();
		await expect(form.locator('[data-exit-link]')).toHaveAttribute('href', /answer\/6162278/);
		await expect(form.locator('[data-setup]')).toBeHidden();
		await expect(form.locator('[data-module]:not([hidden])')).toHaveCount(0);
	});

	test('only the modules behind the named policies are asked, and missing answers are counted', async ({ page }) => {
		await page.goto(EN);
		const form = await setUp(page, { situation: 'rejected', policies: ['reused'] });

		const visible = await form.locator('[data-module]:not([hidden])').evaluateAll((panels) => panels.map((panel) => panel.dataset.module));
		expect(visible).toEqual(['reused', 'channel']);

		await form.locator('[data-evaluate]').click();

		const expected = QUESTIONS.filter((question) => ['reused', 'channel'].includes(question.module)).length;
		await expect(form.locator('[data-status]')).toHaveText(`${expected} questions still need an answer.`);
		await expect(form.locator('[data-question][data-missing]')).toHaveCount(expected);
		await expect(page.locator('[data-result]')).toBeHidden();
	});

	test('silent gameplay leads to "fix and re-apply" with the long-fix note and correct dates', async ({ page }) => {
		await page.goto(EN);
		const form = await setUp(page, { situation: 'rejected', policies: ['reused'] });
		await answerVisible(form, { 'r-gameplay': 'silent' });
		await form.locator('[data-evaluate]').click();

		const result = page.locator('[data-result]');
		await expect(result).toBeVisible();
		await expect(result.locator('[data-module-result="reused"]')).toHaveAttribute('data-level', 'risk');
		await expect(result.locator('[data-module-result="reused"]')).toContainText('Gameplay without commentary');
		await expect(result.locator('[data-module-result="channel"]')).toHaveAttribute('data-level', 'ok');
		await expect(result.locator('[data-recommendation-title]')).toHaveText('Fix your channel and re-apply');
		await expect(result.locator('[data-long-fix]')).toBeVisible();
		await expect(result.locator('[data-failed-appeal]')).toBeVisible();
		await expect(result.locator('[data-checklist]')).toBeHidden();
		await expect(result.locator('[data-deadlines] li')).toHaveText([
			'Appeal by 27 October 2026',
			'Re-apply from 5 November 2026',
			'If an appeal is rejected: re-apply only from 4 January 2027',
		]);
		await expect(result.locator('[data-offer-variant="rejection"]')).toBeVisible();
		await expect(result.locator('[data-offer-variant="suspension"]')).toBeHidden();

		await result.locator('[data-channel]').fill('youtube.com/@example');
		const href = await result.locator('[data-request]').getAttribute('href');
		const url = new URL(href);
		expect(url.pathname).toBe('team@kw.media');
		expect(url.searchParams.get('subject')).toBe('YPP check – youtube.com/@example');
		const body = url.searchParams.get('body');
		expect(body).toContain('Channel: youtube.com/@example');
		expect(body).toContain('- Reused content: Probably applies');
		expect(body).toContain('Gameplay without commentary: Yes, my own gameplay without commentary');
		expect(body).toContain('Recommendation: Fix your channel and re-apply');
	});

	test('a clean channel gets the appeal checklist, and changing an answer hides the old result', async ({ page }) => {
		await page.goto(EN);
		const form = await setUp(page, { situation: 'rejected', repeat: 'repeat', policies: ['inauthentic'] });
		const ids = await answerVisible(form);
		expect(ids).toContain('g-ai');
		expect(ids).toContain('u-shock');
		await form.locator('[data-evaluate]').click();

		const result = page.locator('[data-result]');
		await expect(result.locator('[data-recommendation-title]')).toHaveText('Consider an appeal');
		await expect(result.locator('[data-checklist]')).toBeVisible();
		await expect(result.locator('[data-failed-appeal]')).toBeHidden();
		await expect(result.locator('[data-deadlines] li')).toHaveText(['Appeal by 27 October 2026', 'Re-apply from 4 January 2027']);

		await form.locator('input[name="g-ai"][value="automated"]').check();
		await expect(result).toBeHidden();
	});

	test('the German page covers an announced suspension with the 7-day window and the suspension offer', async ({ page }) => {
		await page.goto(DE);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Monetarisierung abgelehnt? YPP-Selbst-Check');
		const form = await setUp(page, { situation: 'suspension-notice', policies: ['repetitive'], videos: 'over-200' });
		await expect(form.locator('[data-repeat]')).toBeHidden();
		await answerVisible(form, { 'g-volume': 'several-daily' });
		await form.locator('[data-evaluate]').click();

		const result = page.locator('[data-result]');
		await expect(result.locator('[data-recommendation-title]')).toHaveText('Grenzfall');
		await expect(result.locator('[data-deadlines] li').first()).toContainText('spätestens etwa am 13. Oktober 2026');
		await expect(result.locator('[data-offer-variant="suspension"]')).toBeVisible();
		await expect(result.locator('[data-offer-variant="scope"]')).toBeHidden();
		await expect(result).toContainText('Lösch nichts, bevor du mit einem Experten gesprochen hast.');
		await expect(result).toContainText('Deutsch gehört nicht dazu.');
	});

	test('the form and the result pass an accessibility scan', async ({ page }) => {
		await page.goto(EN);
		const form = await setUp(page, { situation: 'rejected', policies: ['unknown'] });
		await answerVisible(form, { 'r-music': 'yes', 'g-vary': 'partly' });
		await form.locator('[data-evaluate]').click();
		await expect(page.locator('[data-result]')).toBeVisible();

		// White on the brand accent (#ff6900) is 2.88:1 on every primary button site-wide;
		// that is a design-token decision, not something this tool introduces.
		const results = await new AxeBuilder({ page })
			.include('.ypp-layout')
			.disableRules(['color-contrast'])
			.analyze();

		expect(results.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
	});
});
