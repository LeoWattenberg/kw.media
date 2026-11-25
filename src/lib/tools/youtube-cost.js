// What a channel costs YouTube per year: storage, encoding and delivery at four price levels.
// Prices and assumptions as of November 2026. Google does not publish its costs, so the
// "google" level is an estimate, and so are the encoding prices of the "wholesale" level.

export const WEEKS_PER_YEAR = 52;
export const GB_PER_MBPS_HOUR = 0.45;
export const VOD_AFTER_LIVE = 1.15;

export const FORMAT_IDS = ['longform', 'shorts', 'live'];

// storedMbps: original plus all renditions, without redundancy. deliveredMbps: average delivery bitrate.
export const FORMATS = {
	longform: { storedMbps: 22, deliveredMbps: 2, live: false },
	shorts: { storedMbps: 20, deliveredMbps: 2, live: false },
	live: { storedMbps: 18, deliveredMbps: 3, live: true },
};

// Prices in US dollars. Storage is per GB or hour and month, delivery per GB or hour watched,
// encoding per hour of material.
export const PRICE_LEVELS = [
	{
		id: 'google',
		storage: { unit: 'gb', price: 0.002 },
		delivery: { unit: 'gb', price: 0.0002 },
		liveDelivery: { unit: 'gb', price: 0.0002 },
		encoding: 0.3,
		liveEncoding: 0.1,
	},
	{
		id: 'wholesale',
		storage: { unit: 'gb', price: 0.0027 },
		delivery: { unit: 'gb', price: 0.0005 },
		liveDelivery: { unit: 'gb', price: 0.0005 },
		encoding: 3.6,
		liveEncoding: 0.5,
	},
	{
		id: 'aws',
		storage: { unit: 'gb', price: 0.021 },
		delivery: { unit: 'gb', price: 0.02 },
		liveDelivery: { unit: 'hour', price: 0.048 },
		encoding: 10.8,
		liveEncoding: 2,
	},
	{
		id: 'cloudflare',
		storage: { unit: 'hour', price: 0.3 },
		delivery: { unit: 'hour', price: 0.06 },
		liveDelivery: { unit: 'hour', price: 0.06 },
		encoding: 0,
		liveEncoding: 0,
	},
];

const basePreset = {
	longform: { perWeek: 1, minutes: 12 },
	shorts: { perWeek: 7, seconds: 40, secondsPerView: 25 },
	live: { perWeek: 3, hours: 3 },
};

const preset = ({ watchHours, views, viewers }) => ({
	longform: { ...basePreset.longform, watchHours },
	shorts: { ...basePreset.shorts, views },
	live: { ...basePreset.live, viewers },
});

// Model channels: a small channel, and one right at the Partner Program threshold today and from February 2027.
export const PRESETS = {
	small: preset({ watchHours: 173, views: 109500, viewers: 3 }),
	today: preset({ watchHours: 4000, views: 10000000, viewers: 7.4 }),
	2027: preset({ watchHours: 8000, views: 20000000, viewers: 14.9 }),
};

export const PRESET_IDS = ['small', 'today', '2027'];
export const DEFAULT_PRESET = 'today';

function amount(value) {
	const number = typeof value === 'number' ? value : Number.parseFloat(value);
	return Number.isFinite(number) && number > 0 ? number : 0;
}

/** Hours of material per year and hours watched, per format. */
export function yearlyAmounts(inputs) {
	const { longform = {}, shorts = {}, live = {} } = inputs;
	const liveHours = amount(live.perWeek) * WEEKS_PER_YEAR * amount(live.hours);

	return {
		longform: {
			materialHours: amount(longform.perWeek) * WEEKS_PER_YEAR * amount(longform.minutes) / 60,
			watchedHours: amount(longform.watchHours),
		},
		shorts: {
			materialHours: amount(shorts.perWeek) * WEEKS_PER_YEAR * amount(shorts.seconds) / 3600,
			watchedHours: amount(shorts.views) * amount(shorts.secondsPerView) / 3600,
		},
		live: {
			materialHours: liveHours,
			watchedHours: liveHours * amount(live.viewers) * VOD_AFTER_LIVE,
		},
	};
}

/** Stored and delivered gigabytes for one format. */
export function dataVolume(formatId, { materialHours, watchedHours }) {
	const format = FORMATS[formatId];

	return {
		storedGb: format.storedMbps * GB_PER_MBPS_HOUR * materialHours,
		deliveredGb: format.deliveredMbps * GB_PER_MBPS_HOUR * watchedHours,
	};
}

/** Cost of one format at one price level for a year, with a full year of storage. */
export function formatCost(level, formatId, amounts) {
	const format = FORMATS[formatId];
	const { storedGb, deliveredGb } = dataVolume(formatId, amounts);
	const delivery = format.live ? level.liveDelivery : level.delivery;
	const result = {
		storage: (level.storage.unit === 'gb' ? storedGb : amounts.materialHours) * level.storage.price * 12,
		encoding: amounts.materialHours * (format.live ? level.liveEncoding : level.encoding),
		delivery: (delivery.unit === 'gb' ? deliveredGb : amounts.watchedHours) * delivery.price,
	};

	return { ...result, total: result.storage + result.encoding + result.delivery };
}

const sumCosts = (costs) => costs.reduce(
	(sum, cost) => ({
		storage: sum.storage + cost.storage,
		encoding: sum.encoding + cost.encoding,
		delivery: sum.delivery + cost.delivery,
		total: sum.total + cost.total,
	}),
	{ storage: 0, encoding: 0, delivery: 0, total: 0 },
);

/** Yearly cost per price level, split by format and by cost type. */
export function calculateChannelCost(inputs) {
	const amounts = yearlyAmounts(inputs);
	const volumes = FORMAT_IDS.map((formatId) => dataVolume(formatId, amounts[formatId]));
	const levels = Object.fromEntries(PRICE_LEVELS.map((level) => {
		const formats = Object.fromEntries(FORMAT_IDS.map((formatId) => [formatId, formatCost(level, formatId, amounts[formatId])]));
		return [level.id, { formats, all: sumCosts(Object.values(formats)) }];
	}));

	return {
		amounts,
		levels,
		totals: {
			materialHours: FORMAT_IDS.reduce((sum, formatId) => sum + amounts[formatId].materialHours, 0),
			watchedHours: FORMAT_IDS.reduce((sum, formatId) => sum + amounts[formatId].watchedHours, 0),
			storedGb: volumes.reduce((sum, volume) => sum + volume.storedGb, 0),
			deliveredGb: volumes.reduce((sum, volume) => sum + volume.deliveredGb, 0),
		},
	};
}

/** Rounds to the precision the model supports: whole dollars below 100, two significant digits above. */
export function roundEstimate(value) {
	if (value < 100) return Math.round(value);
	const step = 10 ** (Math.floor(Math.log10(value)) - 1);
	return Math.round(value / step) * step;
}

export function formatEstimate(value, numberLocale) {
	const currency = new Intl.NumberFormat(numberLocale, {
		style: 'currency',
		currency: 'USD',
		currencyDisplay: 'narrowSymbol',
		maximumFractionDigits: 0,
	});
	if (!(value > 0)) return currency.format(0);
	if (value < 1) return `< ${currency.format(1)}`;
	return currency.format(roundEstimate(value));
}

export function formatVolume(gigabytes, numberLocale) {
	const terabytes = gigabytes >= 1000;
	const number = new Intl.NumberFormat(numberLocale, { maximumFractionDigits: terabytes && gigabytes < 10000 ? 1 : 0 });
	return `${number.format(terabytes ? gigabytes / 1000 : gigabytes)} ${terabytes ? 'TB' : 'GB'}`;
}
