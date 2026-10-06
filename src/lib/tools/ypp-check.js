// Self-check for YouTube Partner Program rejections and suspensions. The questions follow
// YouTube's channel monetization policies (support.google.com/youtube/answer/1311392) and the
// appeal rules (answer/9564590, answer/9235730) as published in October 2026. Copy lives in
// the component; this module only knows ids, levels and rules so it can be tested in Node.

export const LEVELS = ['ok', 'warn', 'risk'];

export const SITUATIONS = {
	rejected: { exit: false },
	'suspension-notice': { exit: false },
	suspended: { exit: false },
	'yellow-icons': { exit: true },
	terminated: { exit: true },
};

// Each policy named in the rejection email maps to the question modules that cover it.
// "Inauthentic content" is the umbrella YouTube introduced in July 2025.
export const POLICY_MODULES = {
	reused: ['reused'],
	repetitive: ['repetitive'],
	offputting: ['offputting'],
	inauthentic: ['repetitive', 'offputting'],
	persona: ['persona'],
	kids: ['kids'],
	integrity: ['integrity'],
	guidelines: ['guidelines'],
	unknown: ['reused', 'repetitive', 'offputting'],
};

export const MODULE_ORDER = ['reused', 'repetitive', 'offputting', 'persona', 'kids', 'integrity', 'guidelines', 'channel'];

const ok = (id) => ({ id, level: 'ok' });
const warn = (id) => ({ id, level: 'warn' });
const risk = (id) => ({ id, level: 'risk' });

export const QUESTIONS = [
	{ id: 'r-own', module: 'reused', options: [ok('most'), warn('half'), risk('little'), risk('none')] },
	{ id: 'r-add', module: 'reused', options: [ok('commentary'), warn('overlays'), risk('nothing'), ok('no-foreign')] },
	{ id: 'r-visible', module: 'reused', options: [ok('mostly'), warn('sometimes'), warn('never')] },
	{ id: 'r-compile', module: 'reused', options: [ok('no'), warn('narrated'), risk('plain')] },
	{ id: 'r-react', module: 'reused', options: [ok('none'), ok('commentary'), risk('silent')] },
	{ id: 'r-music', module: 'reused', options: [ok('no'), risk('yes')] },
	{ id: 'r-reading', module: 'reused', options: [ok('no'), warn('context'), risk('only')] },
	{ id: 'r-gameplay', module: 'reused', options: [ok('no'), risk('silent'), risk('cutscenes')] },
	{ id: 'r-meta', module: 'reused', options: [ok('yes'), warn('partly'), risk('no')] },
	{ id: 'g-vary', module: 'repetitive', options: [ok('yes'), warn('partly'), risk('no')] },
	{ id: 'g-template', module: 'repetitive', options: [ok('no'), ok('own-content'), risk('same')] },
	{ id: 'g-slides', module: 'repetitive', options: [ok('no'), warn('voiced'), risk('plain')] },
	{ id: 'g-ai', module: 'repetitive', options: [ok('none'), ok('helper'), risk('pipeline'), risk('automated')] },
	{ id: 'g-volume', module: 'repetitive', options: [ok('normal'), warn('several-daily')] },
	{ id: 'u-shock', module: 'offputting', options: [ok('no'), warn('pointed'), risk('yes')] },
	{ id: 'u-disturbing', module: 'offputting', options: [ok('no'), risk('yes')] },
	{ id: 'u-trends', module: 'offputting', options: [ok('no'), ok('own-spin'), risk('copy')] },
	{ id: 'u-ai-clips', module: 'offputting', options: [ok('no'), risk('yes')] },
	{ id: 'p-expert', module: 'persona', options: [ok('no'), risk('yes')] },
	{ id: 'k-promo', module: 'kids', options: [ok('no'), risk('yes')] },
	{ id: 'k-fake-edu', module: 'kids', options: [ok('no'), risk('yes')] },
	{ id: 'k-characters', module: 'kids', options: [ok('no'), risk('yes')] },
	{ id: 'i-bought', module: 'integrity', options: [ok('no'), risk('yes')] },
	{ id: 'i-deleted', module: 'integrity', options: [ok('no'), risk('yes')] },
	{ id: 'c-strikes', module: 'guidelines', options: [ok('no'), risk('yes')] },
	{ id: 's-top', module: 'channel', options: [ok('yes'), warn('no')] },
	{ id: 's-about', module: 'channel', options: [ok('yes'), warn('no')] },
];

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(value) {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
	if (!match) return null;
	const time = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
	return Number.isNaN(time) ? null : time;
}

export function addDays(value, days) {
	const time = parseDate(value);
	if (time === null) return null;
	return new Date(time + days * DAY_MS).toISOString().slice(0, 10);
}

// The "modules" a visitor has to answer: the ones behind the selected policies, plus the
// channel-level questions every review starts with.
export function modulesForPolicies(policies) {
	const selected = new Set();
	for (const policy of policies) {
		for (const module of POLICY_MODULES[policy] ?? []) selected.add(module);
	}
	selected.add('channel');
	return MODULE_ORDER.filter((module) => selected.has(module));
}

export function questionsForModules(modules) {
	const wanted = new Set(modules);
	return QUESTIONS.filter((question) => wanted.has(question.module));
}

function worse(first, second) {
	return LEVELS.indexOf(second) > LEVELS.indexOf(first) ? second : first;
}

// answers: { [questionId]: optionId }. Each module takes the worst answered level; the
// flagged list keeps every warn/risk answer so the result can explain it.
export function assessModules(modules, answers) {
	return modules.map((module) => {
		let level = 'ok';
		const flagged = [];
		let answered = 0;

		for (const question of questionsForModules([module])) {
			const option = question.options.find((candidate) => candidate.id === answers[question.id]);
			if (!option) continue;
			answered += 1;
			level = worse(level, option.level);
			if (option.level !== 'ok') flagged.push({ question: question.id, option: option.id, level: option.level });
		}

		return { module, level, flagged, answered };
	});
}

export function unansweredQuestions(modules, answers) {
	return questionsForModules(modules).filter((question) => !question.options.some((option) => option.id === answers[question.id]));
}

export function overallLevel(assessments) {
	return assessments.reduce((level, assessment) => worse(level, assessment.level), 'ok');
}

// Silent gameplay is a long fix in practice: months of videos where the creator can be
// seen or heard, so the earliest re-apply date is rarely the realistic one.
export function needsLongFix(answers) {
	return answers['r-gameplay'] === 'silent' || answers['r-gameplay'] === 'cutscenes';
}

export function recommendation(assessments) {
	const level = overallLevel(assessments);
	if (level === 'risk') return 'fix';
	if (level === 'warn') return 'borderline';
	return 'appeal';
}

// Dates per YouTube Help as of October 2026. Re-applying after a failed appeal waits 90 days
// even when a first rejection alone would have allowed 30.
export function deadlines({ situation, date, repeat }) {
	if (!parseDate(date)) return null;

	if (situation === 'rejected') {
		return {
			appealBy: addDays(date, 21),
			reapplyFrom: addDays(date, repeat ? 90 : 30),
			reapplyAfterFailedAppeal: repeat ? null : addDays(date, 90),
		};
	}

	if (situation === 'suspension-notice') {
		return {
			appealBy: addDays(date, 7),
			reapplyFrom: null,
			reapplyAfterFailedAppeal: null,
		};
	}

	if (situation === 'suspended') {
		return {
			appealBy: addDays(date, 21),
			reapplyFrom: addDays(date, 90),
			reapplyAfterFailedAppeal: null,
		};
	}

	return null;
}

export function offerFor({ situation, videos }) {
	if (situation === 'suspension-notice' || situation === 'suspended') return 'suspension';
	if (videos === 'over-200') return 'scope';
	return 'rejection';
}

const CRLF = '\r\n';

export function buildRequestMailto({ email, subject, lines }) {
	return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join(CRLF))}`;
}
