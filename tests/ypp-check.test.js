import assert from 'node:assert/strict';
import test from 'node:test';
import {
	MODULE_ORDER,
	POLICY_MODULES,
	QUESTIONS,
	addDays,
	assessModules,
	buildRequestMailto,
	deadlines,
	modulesForPolicies,
	needsLongFix,
	offerFor,
	overallLevel,
	questionsForModules,
	recommendation,
	unansweredQuestions,
} from '../src/lib/tools/ypp-check.js';

const allOk = (modules) => Object.fromEntries(
	questionsForModules(modules).map((question) => [question.id, question.options.find((option) => option.level === 'ok').id]),
);

test('every question belongs to a known module and has unique option ids with valid levels', () => {
	const ids = new Set();
	for (const question of QUESTIONS) {
		assert.ok(MODULE_ORDER.includes(question.module), question.id);
		assert.ok(!ids.has(question.id), `duplicate ${question.id}`);
		ids.add(question.id);
		const optionIds = question.options.map((option) => option.id);
		assert.equal(new Set(optionIds).size, optionIds.length, question.id);
		assert.ok(question.options.some((option) => option.level === 'ok'), `${question.id} needs a passing answer`);
		for (const option of question.options) assert.ok(['ok', 'warn', 'risk'].includes(option.level));
	}
	for (const modules of Object.values(POLICY_MODULES)) {
		for (const module of modules) assert.ok(MODULE_ORDER.includes(module));
	}
});

test('policies map to their modules in a fixed order, and the channel questions always come along', () => {
	assert.deepEqual(modulesForPolicies(['reused']), ['reused', 'channel']);
	assert.deepEqual(modulesForPolicies(['inauthentic', 'reused']), ['reused', 'repetitive', 'offputting', 'channel']);
	assert.deepEqual(modulesForPolicies(['unknown']), ['reused', 'repetitive', 'offputting', 'channel']);
	assert.deepEqual(modulesForPolicies([]), ['channel']);
});

test('a module takes its worst answer and lists every flagged one', () => {
	const answers = { ...allOk(['reused']), 'r-visible': 'never', 'r-music': 'yes' };
	const [reused] = assessModules(['reused'], answers);

	assert.equal(reused.level, 'risk');
	assert.deepEqual(reused.flagged, [
		{ question: 'r-visible', option: 'never', level: 'warn' },
		{ question: 'r-music', option: 'yes', level: 'risk' },
	]);
	assert.equal(reused.answered, questionsForModules(['reused']).length);
});

test('unanswered questions are reported instead of being counted as fine', () => {
	const answers = allOk(['repetitive']);
	delete answers['g-ai'];

	assert.deepEqual(unansweredQuestions(['repetitive'], answers).map((question) => question.id), ['g-ai']);
	assert.equal(assessModules(['repetitive'], answers)[0].answered, questionsForModules(['repetitive']).length - 1);
});

test('the recommendation follows the worst module across all of them', () => {
	const modules = ['reused', 'channel'];
	const clean = assessModules(modules, allOk(modules));
	const borderline = assessModules(modules, { ...allOk(modules), 's-about': 'no' });
	const broken = assessModules(modules, { ...allOk(modules), 'r-react': 'silent' });

	assert.equal(overallLevel(clean), 'ok');
	assert.equal(recommendation(clean), 'appeal');
	assert.equal(recommendation(borderline), 'borderline');
	assert.equal(recommendation(broken), 'fix');
});

test('silent gameplay and cutscene uploads are flagged as a long fix', () => {
	assert.equal(needsLongFix({ 'r-gameplay': 'silent' }), true);
	assert.equal(needsLongFix({ 'r-gameplay': 'cutscenes' }), true);
	assert.equal(needsLongFix({ 'r-gameplay': 'no' }), false);
	assert.equal(needsLongFix({}), false);
});

test('dates are added in UTC so daylight saving never shifts a deadline', () => {
	assert.equal(addDays('2026-10-06', 21), '2026-10-27');
	assert.equal(addDays('2026-03-20', 21), '2026-04-10');
	assert.equal(addDays('2026-12-20', 30), '2027-01-19');
	assert.equal(addDays('not a date', 3), null);
});

test('deadlines follow the YouTube Help rules for each situation', () => {
	assert.deepEqual(deadlines({ situation: 'rejected', date: '2026-10-06', repeat: false }), {
		appealBy: '2026-10-27',
		reapplyFrom: '2026-11-05',
		reapplyAfterFailedAppeal: '2027-01-04',
	});
	assert.deepEqual(deadlines({ situation: 'rejected', date: '2026-10-06', repeat: true }), {
		appealBy: '2026-10-27',
		reapplyFrom: '2027-01-04',
		reapplyAfterFailedAppeal: null,
	});
	assert.deepEqual(deadlines({ situation: 'suspension-notice', date: '2026-10-06' }), {
		appealBy: '2026-10-13',
		reapplyFrom: null,
		reapplyAfterFailedAppeal: null,
	});
	assert.deepEqual(deadlines({ situation: 'suspended', date: '2026-10-06' }), {
		appealBy: '2026-10-27',
		reapplyFrom: '2027-01-04',
		reapplyAfterFailedAppeal: null,
	});
	assert.equal(deadlines({ situation: 'rejected', date: '' }), null);
	assert.equal(deadlines({ situation: 'terminated', date: '2026-10-06' }), null);
});

test('the offer depends on the situation first and the catalogue size second', () => {
	assert.equal(offerFor({ situation: 'rejected', videos: 'under-50' }), 'rejection');
	assert.equal(offerFor({ situation: 'rejected', videos: '50-200' }), 'rejection');
	assert.equal(offerFor({ situation: 'rejected', videos: 'over-200' }), 'scope');
	assert.equal(offerFor({ situation: 'suspended', videos: 'under-50' }), 'suspension');
	assert.equal(offerFor({ situation: 'suspension-notice', videos: 'over-200' }), 'suspension');
});

test('the request mailto keeps subject and CRLF-separated lines intact', () => {
	const href = buildRequestMailto({
		email: 'team@kw.media',
		subject: 'YPP check – youtube.com/@ada',
		lines: ['Situation: rejected', 'Reused content: red'],
	});
	const url = new URL(href);

	assert.equal(url.pathname, 'team@kw.media');
	assert.equal(url.searchParams.get('subject'), 'YPP check – youtube.com/@ada');
	assert.equal(url.searchParams.get('body'), 'Situation: rejected\r\nReused content: red');
});
