import { AUDIO_EDITOR_SAMPLE_RATE, createStableId } from './project.js';

const EQ_FREQUENCIES = [100, 500, 2_000, 8_000];

/**
 * @typedef {Object} AudioEditorEffect
 * @property {string} id
 * @property {keyof AUDIO_EFFECT_DEFINITIONS} type
 * @property {boolean} enabled
 * @property {Record<string, *>} params
 */

export const AUDIO_EFFECT_DEFINITIONS = Object.freeze({
	highpass: {
		defaults: { frequency: 80, q: 0.707 },
		ranges: { frequency: [10, 20_000], q: [0.1, 30] },
	},
	lowpass: {
		defaults: { frequency: 18_000, q: 0.707 },
		ranges: { frequency: [10, 24_000], q: [0.1, 30] },
	},
	eq: {
		defaults: {
			bands: EQ_FREQUENCIES.map((frequency) => ({ frequency, gain: 0, q: 1 })),
		},
	},
	compressor: {
		defaults: { threshold: -24, knee: 30, ratio: 4, attack: 0.003, release: 0.25, makeupGain: 0 },
		ranges: {
			threshold: [-100, 0], knee: [0, 40], ratio: [1, 20], attack: [0, 1], release: [0.01, 2], makeupGain: [-24, 24],
		},
	},
	limiter: {
		defaults: { ceiling: -1, lookahead: 0.005, release: 0.1 },
		ranges: { ceiling: [-24, 0], lookahead: [0, 0.1], release: [0.01, 2] },
	},
	gate: {
		defaults: { threshold: -50, attack: 0.005, hold: 0.05, release: 0.1, rangeDb: -80 },
		ranges: { threshold: [-100, 0], attack: [0, 1], hold: [0, 2], release: [0.01, 3], rangeDb: [-100, 0] },
	},
	reverb: {
		defaults: { mix: 0.2, decay: 2, preDelay: 0.01 },
		ranges: { mix: [0, 1], decay: [0.1, 10], preDelay: [0, 1] },
	},
	delay: {
		defaults: { time: 0.25, feedback: 0.3, mix: 0.2 },
		ranges: { time: [0.001, 5], feedback: [0, 0.95], mix: [0, 1] },
	},
});

/** @returns {AudioEditorEffect} */
export function createEffect(type, options = {}) {
	const definition = AUDIO_EFFECT_DEFINITIONS[type];
	if (!definition) throw new RangeError(`Unsupported audio effect: ${type}.`);
	const params = normalizeEffectParams(type, {
		...clone(definition.defaults),
		...(options.params || {}),
	});
	return {
		id: options.id || createStableId('effect'),
		type,
		enabled: options.enabled !== false,
		params,
	};
}

export function normalizeEffect(effect) {
	if (!effect || typeof effect !== 'object') throw new TypeError('An effect is required.');
	if (typeof effect.id !== 'string' || !effect.id) throw new TypeError('Every effect needs a stable ID.');
	return createEffect(effect.type, effect);
}

export function validateEffect(effect) {
	normalizeEffect(effect);
	return true;
}

export function updateEffect(effect, changes = {}) {
	return createEffect(changes.type || effect.type, {
		id: effect.id,
		enabled: changes.enabled ?? effect.enabled,
		params: { ...clone(effect.params), ...(changes.params || {}) },
	});
}

export function effectTailFrames(effect, sampleRate = AUDIO_EDITOR_SAMPLE_RATE) {
	const normalized = effect?.id
		? normalizeEffect(effect)
		: createEffect(effect?.type, { ...effect, id: `tail-${effect?.type || 'effect'}` });
	if (!normalized.enabled) return 0;
	if (normalized.type === 'reverb') {
		return Math.ceil((normalized.params.preDelay + normalized.params.decay) * sampleRate);
	}
	if (normalized.type === 'delay' && normalized.params.mix > 0) {
		const repeatsToMinus60Db = normalized.params.feedback > 0
			? Math.ceil(Math.log(0.001) / Math.log(normalized.params.feedback))
			: 1;
		return Math.ceil(normalized.params.time * Math.max(1, repeatsToMinus60Db) * sampleRate);
	}
	if (normalized.type === 'limiter') return Math.ceil(normalized.params.lookahead * sampleRate);
	return 0;
}

export function rackTailFrames(effects, sampleRate = AUDIO_EDITOR_SAMPLE_RATE, maximumSeconds = 10) {
	const maximum = Math.round(maximumSeconds * sampleRate);
	const tail = (effects || []).reduce((total, effect) => Math.min(maximum, total + effectTailFrames(effect, sampleRate)), 0);
	return Math.min(maximum, tail);
}

function normalizeEffectParams(type, params) {
	if (type === 'eq') {
		if (!Array.isArray(params.bands) || params.bands.length !== 4) {
			throw new RangeError('The parametric EQ requires exactly four bands.');
		}
		return {
			bands: params.bands.map((band, index) => ({
				frequency: range(band.frequency, 10, 24_000, `eq.bands[${index}].frequency`),
				gain: range(band.gain, -24, 24, `eq.bands[${index}].gain`),
				q: range(band.q, 0.1, 30, `eq.bands[${index}].q`),
			})),
		};
	}

	const definition = AUDIO_EFFECT_DEFINITIONS[type];
	const output = {};
	for (const [name, [minimum, maximum]] of Object.entries(definition.ranges)) {
		output[name] = range(params[name], minimum, maximum, `${type}.${name}`);
	}
	return output;
}

function range(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

function clone(value) {
	return JSON.parse(JSON.stringify(value));
}
