export const ANALYSIS_FLOOR_DB = -120;

/**
 * @typedef {Object} AudioAnalysisResult
 * @property {number} sampleRate
 * @property {number} channelCount
 * @property {number} frameCount
 * @property {number} peakDbfs
 * @property {number} truePeakDbtp
 * @property {number} rmsDbfs
 * @property {number | null} stereoCorrelation
 * @property {number | null} momentaryLufs
 * @property {number | null} shortTermLufs
 * @property {number | null} integratedLufs
 * @property {number | null} loudnessRangeLufs
 */

export function amplitudeToDb(amplitude) {
	return amplitude > 0 ? Math.max(ANALYSIS_FLOOR_DB, 20 * Math.log10(amplitude)) : ANALYSIS_FLOOR_DB;
}

export function energyToLufs(energy) {
	return energy > 0 ? -0.691 + 10 * Math.log10(energy) : null;
}

/**
 * Creates a bounded-state analyzer. Each `push` accepts one equally-sized typed
 * array per channel; K-weighting, gating windows, correlation, and true-peak
 * interpolation remain continuous across arbitrary chunk boundaries.
 *
 * @returns {{push: (channels: Array<ArrayBufferView>) => *, finish: () => AudioAnalysisResult}}
 */
export function createStreamingAudioAnalyzer(options = {}) {
	const sampleRate = Number(options.sampleRate);
	const channelCount = Number(options.channelCount ?? 2);
	if (!Number.isInteger(sampleRate) || sampleRate < 8_000) throw new RangeError('A valid analysis sample rate is required.');
	if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 8) {
		throw new RangeError('Analysis channel count must be from 1 to 8.');
	}
	const oversample = Number(options.truePeakOversample ?? 4);
	if (![1, 2, 4, 8].includes(oversample)) throw new RangeError('True-peak oversampling must be 1, 2, 4, or 8.');
	const clipThreshold = Number(options.clipThreshold ?? 1);
	if (!Number.isFinite(clipThreshold) || clipThreshold <= 0) throw new RangeError('Clip threshold must be positive.');
	const channelWeights = options.channelWeights || Array.from({ length: channelCount }, () => 1);
	if (channelWeights.length !== channelCount || channelWeights.some((weight) => !Number.isFinite(weight) || weight < 0)) {
		throw new RangeError('A non-negative loudness weight is required for every channel.');
	}

	const kWeighting = Array.from({ length: channelCount }, () => createKWeightingFilter(sampleRate));
	const samplePeaks = new Float64Array(channelCount);
	const truePeakStates = Array.from({ length: channelCount }, () => ({ history: [], started: false, peak: 0 }));
	const momentaryFrames = Math.max(1, Math.round(sampleRate * 0.4));
	const momentaryStep = Math.max(1, Math.round(sampleRate * 0.1));
	const shortTermFrames = Math.max(momentaryFrames, Math.round(sampleRate * 3));
	const shortTermStep = Math.max(1, Math.round(sampleRate));
	const energyRing = new Float64Array(shortTermFrames);
	const momentaryEnergies = [];
	const shortTermEnergies = [];
	let energyWriteIndex = 0;
	let momentaryEnergySum = 0;
	let shortTermEnergySum = 0;
	let frameCount = 0;
	let sampleSquareSum = 0;
	let clippedSamples = 0;
	let clippedFrames = 0;
	let leftSum = 0;
	let rightSum = 0;
	let leftSquareSum = 0;
	let rightSquareSum = 0;
	let crossSum = 0;
	let result = null;

	function push(channels) {
		if (result) throw new Error('Cannot add PCM after analysis has finished.');
		if (!Array.isArray(channels) || channels.length !== channelCount) {
			throw new RangeError(`Expected ${channelCount} PCM channels.`);
		}
		const frames = channels[0]?.length;
		if (!Number.isInteger(frames)) throw new TypeError('PCM channels must be typed arrays.');
		if (channels.some((channel) => !ArrayBuffer.isView(channel) || channel.length !== frames)) {
			throw new RangeError('PCM channels must be equally sized typed arrays.');
		}

		for (let frame = 0; frame < frames; frame += 1) {
			let weightedEnergy = 0;
			let frameClipped = false;
			for (let channel = 0; channel < channelCount; channel += 1) {
				const sample = Number(channels[channel][frame]);
				if (!Number.isFinite(sample)) throw new RangeError('PCM samples must be finite.');
				const absolute = Math.abs(sample);
				samplePeaks[channel] = Math.max(samplePeaks[channel], absolute);
				sampleSquareSum += sample * sample;
				if (absolute >= clipThreshold) {
					clippedSamples += 1;
					frameClipped = true;
				}
				pushTruePeakSample(truePeakStates[channel], sample, oversample);
				const weighted = kWeighting[channel].process(sample);
				weightedEnergy += weighted * weighted * channelWeights[channel];
			}
			if (frameClipped) clippedFrames += 1;
			if (channelCount >= 2) {
				const left = Number(channels[0][frame]);
				const right = Number(channels[1][frame]);
				leftSum += left;
				rightSum += right;
				leftSquareSum += left * left;
				rightSquareSum += right * right;
				crossSum += left * right;
			}
			pushLoudnessEnergy(weightedEnergy);
			frameCount += 1;
		}
		return api;
	}

	function pushLoudnessEnergy(energy) {
		if (frameCount >= shortTermFrames) shortTermEnergySum -= energyRing[energyWriteIndex];
		if (frameCount >= momentaryFrames) {
			const expiredIndex = (energyWriteIndex - momentaryFrames + shortTermFrames) % shortTermFrames;
			momentaryEnergySum -= energyRing[expiredIndex];
		}
		energyRing[energyWriteIndex] = energy;
		energyWriteIndex = (energyWriteIndex + 1) % shortTermFrames;
		momentaryEnergySum += energy;
		shortTermEnergySum += energy;
		const nextFrameCount = frameCount + 1;
		if (nextFrameCount >= momentaryFrames && (nextFrameCount - momentaryFrames) % momentaryStep === 0) {
			momentaryEnergies.push(Math.max(0, momentaryEnergySum / momentaryFrames));
		}
		if (nextFrameCount >= shortTermFrames && (nextFrameCount - shortTermFrames) % shortTermStep === 0) {
			shortTermEnergies.push(Math.max(0, shortTermEnergySum / shortTermFrames));
		}
	}

	function finish() {
		if (result) return result;
		const truePeaks = truePeakStates.map((state) => finishTruePeak(state, oversample));
		const peakAmplitude = Math.max(0, ...samplePeaks);
		const truePeakAmplitude = Math.max(peakAmplitude, ...truePeaks);
		const integratedLufs = calculateIntegratedLufs(momentaryEnergies);
		const momentaryValues = momentaryEnergies.map(energyToLufs).filter(Number.isFinite);
		const shortTermValues = shortTermEnergies.map(energyToLufs).filter(Number.isFinite);
		result = Object.freeze({
			sampleRate,
			channelCount,
			frameCount,
			durationSeconds: frameCount / sampleRate,
			peakAmplitude,
			peakDbfs: amplitudeToDb(peakAmplitude),
			channelPeakDbfs: Array.from(samplePeaks, amplitudeToDb),
			truePeakAmplitude,
			truePeakDbtp: amplitudeToDb(truePeakAmplitude),
			truePeakOversample: oversample,
			truePeakEstimated: true,
			rmsAmplitude: frameCount ? Math.sqrt(sampleSquareSum / (frameCount * channelCount)) : 0,
			rmsDbfs: amplitudeToDb(frameCount ? Math.sqrt(sampleSquareSum / (frameCount * channelCount)) : 0),
			clippedSamples,
			clippedFrames,
			stereoCorrelation: calculateCorrelation(),
			momentaryLufs: last(momentaryValues),
			maxMomentaryLufs: maximum(momentaryValues),
			shortTermLufs: last(shortTermValues),
			maxShortTermLufs: maximum(shortTermValues),
			integratedLufs,
			loudnessRangeLufs: calculateLoudnessRange(shortTermEnergies, integratedLufs),
			momentaryBlockCount: momentaryEnergies.length,
			shortTermBlockCount: shortTermEnergies.length,
		});
		return result;
	}

	function calculateCorrelation() {
		if (channelCount < 2 || frameCount < 2) return null;
		const covariance = crossSum - leftSum * rightSum / frameCount;
		const leftVariance = leftSquareSum - leftSum * leftSum / frameCount;
		const rightVariance = rightSquareSum - rightSum * rightSum / frameCount;
		const denominator = Math.sqrt(Math.max(0, leftVariance) * Math.max(0, rightVariance));
		return denominator > 0 ? Math.max(-1, Math.min(1, covariance / denominator)) : null;
	}

	const api = Object.freeze({ push, finish });
	return api;
}

/** @returns {AudioAnalysisResult} */
export function analyzeAudioChannels(channels, sampleRate, options = {}) {
	return createStreamingAudioAnalyzer({ ...options, sampleRate, channelCount: channels.length })
		.push(channels)
		.finish();
}

export function calculateIntegratedLufs(blockEnergies) {
	const absoluteGated = blockEnergies.filter((energy) => {
		const loudness = energyToLufs(energy);
		return loudness != null && loudness >= -70;
	});
	if (!absoluteGated.length) return null;
	const preliminaryEnergy = average(absoluteGated);
	const relativeGate = energyToLufs(preliminaryEnergy) - 10;
	const relativeGated = absoluteGated.filter((energy) => energyToLufs(energy) >= relativeGate);
	return energyToLufs(average(relativeGated));
}

export function calculateLoudnessRange(shortTermEnergies, integratedLufs) {
	if (!Number.isFinite(integratedLufs)) return null;
	const absoluteGated = shortTermEnergies.filter((energy) => {
		const loudness = energyToLufs(energy);
		return Number.isFinite(loudness) && loudness >= -70;
	});
	if (absoluteGated.length < 2) return null;
	const relativeGate = energyToLufs(average(absoluteGated)) - 20;
	const gated = absoluteGated
		.map(energyToLufs)
		.filter((loudness) => loudness >= relativeGate)
		.sort((first, second) => first - second);
	if (gated.length < 2) return null;
	return percentile(gated, 0.95) - percentile(gated, 0.1);
}

function createKWeightingFilter(sampleRate) {
	const shelf = createShelfCoefficients(sampleRate);
	const highpass = createHighpassCoefficients(sampleRate);
	const shelfState = createBiquadState(shelf);
	const highpassState = createBiquadState(highpass);
	return {
		process(sample) {
			return processBiquad(highpassState, processBiquad(shelfState, sample));
		},
	};
}

function createShelfCoefficients(sampleRate) {
	const frequency = 1_681.974450955533;
	const gain = 3.999843853973347;
	const q = 0.7071752369554196;
	const vh = 10 ** (gain / 20);
	const vb = vh ** 0.4996667741545416;
	const k = Math.tan(Math.PI * frequency / sampleRate);
	const a0 = 1 + k / q + k * k;
	return {
		b0: (vh + vb * k / q + k * k) / a0,
		b1: 2 * (k * k - vh) / a0,
		b2: (vh - vb * k / q + k * k) / a0,
		a1: 2 * (k * k - 1) / a0,
		a2: (1 - k / q + k * k) / a0,
	};
}

function createHighpassCoefficients(sampleRate) {
	const frequency = 38.13547087602444;
	const q = 0.5003270373238773;
	const k = Math.tan(Math.PI * frequency / sampleRate);
	const a0 = 1 + k / q + k * k;
	return {
		b0: 1 / a0,
		b1: -2 / a0,
		b2: 1 / a0,
		a1: 2 * (k * k - 1) / a0,
		a2: (1 - k / q + k * k) / a0,
	};
}

function createBiquadState(coefficients) {
	return { ...coefficients, x1: 0, x2: 0, y1: 0, y2: 0 };
}

function processBiquad(state, x0) {
	const y0 = state.b0 * x0 + state.b1 * state.x1 + state.b2 * state.x2
		- state.a1 * state.y1 - state.a2 * state.y2;
	state.x2 = state.x1;
	state.x1 = x0;
	state.y2 = state.y1;
	state.y1 = y0;
	return y0;
}

function pushTruePeakSample(state, sample, oversample) {
	state.peak = Math.max(state.peak, Math.abs(sample));
	if (oversample === 1) return;
	state.history.push(sample);
	if (!state.started && state.history.length === 3) {
		interpolatePeak(state, state.history[0], state.history[0], state.history[1], state.history[2], oversample);
		state.started = true;
	}
	if (state.history.length === 4) {
		interpolatePeak(state, state.history[0], state.history[1], state.history[2], state.history[3], oversample);
		state.history.shift();
	}
}

function finishTruePeak(state, oversample) {
	if (oversample === 1 || state.history.length < 2) return state.peak;
	const history = state.history;
	if (!state.started) {
		interpolatePeak(state, history[0], history[0], history[1], history[1], oversample);
	} else {
		interpolatePeak(state, history[0], history[1], history[2], history[2], oversample);
	}
	return state.peak;
}

function interpolatePeak(state, p0, p1, p2, p3, oversample) {
	for (let phase = 1; phase < oversample; phase += 1) {
		const t = phase / oversample;
		const t2 = t * t;
		const t3 = t2 * t;
		const sample = 0.5 * ((2 * p1)
			+ (-p0 + p2) * t
			+ (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
			+ (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
		state.peak = Math.max(state.peak, Math.abs(sample));
	}
}

function average(values) {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function last(values) {
	return values.length ? values[values.length - 1] : null;
}

function maximum(values) {
	return values.length ? Math.max(...values) : null;
}

function percentile(sortedValues, fraction) {
	const position = (sortedValues.length - 1) * fraction;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sortedValues[lower];
	return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (position - lower);
}
