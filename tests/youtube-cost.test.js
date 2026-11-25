import assert from 'node:assert/strict';
import test from 'node:test';
import {
	DEFAULT_PRESET,
	FORMAT_IDS,
	PRESETS,
	PRESET_IDS,
	PRICE_LEVELS,
	calculateChannelCost,
	dataVolume,
	formatEstimate,
	formatVolume,
	roundEstimate,
	yearlyAmounts,
} from '../src/lib/tools/youtube-cost.js';

const empty = { longform: {}, shorts: {}, live: {} };

test('the threshold preset reproduces the numbers from the video', () => {
	const { levels } = calculateChannelCost(PRESETS.today);

	assert.equal(roundEstimate(levels.google.formats.longform.total), 6);
	assert.equal(roundEstimate(levels.wholesale.formats.longform.total), 43);
	assert.equal(roundEstimate(levels.aws.formats.longform.total), 210);
	assert.equal(roundEstimate(levels.cloudflare.formats.longform.total), 280);

	assert.equal(roundEstimate(levels.google.formats.shorts.total), 15);
	assert.equal(roundEstimate(levels.aws.formats.shorts.total), 1300);
	assert.equal(roundEstimate(levels.cloudflare.formats.shorts.total), 4200);

	assert.equal(roundEstimate(levels.google.formats.live.total), 140);
	assert.ok(levels.aws.formats.live.total > 2000);
});

test('the doubled threshold adds under a dollar for long-form and about 12.50 for Shorts', () => {
	const today = calculateChannelCost(PRESETS.today).levels.google.formats;
	const next = calculateChannelCost(PRESETS[2027]).levels.google.formats;

	assert.ok(next.longform.total - today.longform.total < 1);
	assert.ok(Math.abs(next.shorts.total - today.shorts.total - 12.5) < 0.01);
});

test('amounts follow from uploads and watch time', () => {
	const amounts = yearlyAmounts(PRESETS.today);

	assert.equal(amounts.longform.materialHours, 10.4);
	assert.equal(amounts.longform.watchedHours, 4000);
	assert.equal(Math.round(amounts.shorts.watchedHours), 69444);
	assert.equal(amounts.live.materialHours, 468);
	assert.ok(Math.abs(amounts.live.watchedHours - 4000) < 20);
	assert.equal(Math.round(dataVolume('longform', amounts.longform).deliveredGb), 3600);
});

test('live encoding costs money even without viewers', () => {
	const { levels } = calculateChannelCost({ ...empty, live: { perWeek: 3, hours: 3, viewers: 0 } });

	assert.equal(levels.aws.formats.live.delivery, 0);
	assert.equal(levels.aws.formats.live.encoding, 936);
});

test('empty, negative and invalid inputs cost nothing', () => {
	const invalid = {
		longform: { perWeek: -1, minutes: 12, watchHours: -5 },
		shorts: { perWeek: 'abc' },
		live: { perWeek: Number.NaN },
	};

	for (const inputs of [empty, invalid]) {
		const { levels, totals } = calculateChannelCost(inputs);
		for (const level of PRICE_LEVELS) assert.equal(levels[level.id].all.total, 0);
		assert.equal(totals.storedGb, 0);
		assert.equal(totals.deliveredGb, 0);
	}
});

test('inputs may arrive as strings from form fields', () => {
	const asStrings = Object.fromEntries(Object.entries(PRESETS.today).map(
		([formatId, fields]) => [formatId, Object.fromEntries(Object.entries(fields).map(([name, value]) => [name, String(value)]))],
	));

	assert.deepEqual(calculateChannelCost(asStrings), calculateChannelCost(PRESETS.today));
});

test('totals are the sum of all formats and cost types', () => {
	const { levels } = calculateChannelCost(PRESETS.today);

	for (const level of PRICE_LEVELS) {
		const { formats, all } = levels[level.id];
		const byFormat = FORMAT_IDS.reduce((sum, formatId) => sum + formats[formatId].total, 0);
		assert.ok(Math.abs(all.total - byFormat) < 1e-9, level.id);
		assert.ok(Math.abs(all.total - (all.storage + all.encoding + all.delivery)) < 1e-9, level.id);
	}
});

test('every preset is listed and fills every field', () => {
	assert.deepEqual([...PRESET_IDS].sort(), Object.keys(PRESETS).sort());
	assert.ok(PRESET_IDS.includes(DEFAULT_PRESET));
	for (const id of PRESET_IDS) {
		assert.deepEqual(Object.keys(PRESETS[id]), FORMAT_IDS);
		for (const formatId of FORMAT_IDS) {
			assert.deepEqual(Object.keys(PRESETS[id][formatId]).sort(), Object.keys(PRESETS.today[formatId]).sort());
			for (const value of Object.values(PRESETS[id][formatId])) assert.ok(value > 0);
		}
	}
});

test('estimates are shown without false precision', () => {
	assert.equal(formatEstimate(0, 'en-US'), '$0');
	assert.equal(formatEstimate(0.4, 'en-US'), '< $1');
	assert.equal(formatEstimate(5.8, 'en-US'), '$6');
	assert.equal(formatEstimate(1263, 'en-US'), '$1,300');
	assert.equal(formatEstimate(41234, 'en-US'), '$41,000');
	assert.match(formatEstimate(1263, 'de-DE'), /^1\.300\s\$$/);
	assert.equal(roundEstimate(99.7), 100);
	assert.equal(roundEstimate(995), 1000);
});

test('volumes switch from gigabytes to terabytes', () => {
	assert.equal(formatVolume(103, 'en-US'), '103 GB');
	assert.equal(formatVolume(3600, 'en-US'), '3.6 TB');
	assert.equal(formatVolume(3600, 'de-DE'), '3,6 TB');
	assert.equal(formatVolume(62500, 'en-US'), '63 TB');
});
