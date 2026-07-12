const MIN_DB = -120;

export const ROSEUS_STOPS = [
	[0, 0, 0],
	[24, 7, 28],
	[63, 9, 66],
	[101, 17, 87],
	[139, 31, 87],
	[174, 52, 77],
	[207, 80, 63],
	[233, 119, 62],
	[249, 166, 82],
	[253, 216, 139],
	[255, 255, 255],
];

export function clamp(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

export function amplitudeToDbfs(amplitude) {
	return amplitude > 0 ? Math.max(MIN_DB, 20 * Math.log10(amplitude)) : MIN_DB;
}

export function meanSquare(samples, start = 0, end = samples.length) {
	const first = clamp(Math.floor(start), 0, samples.length);
	const last = clamp(Math.ceil(end), first, samples.length);
	if (last <= first) return 0;

	let sum = 0;
	for (let index = first; index < last; index += 1) {
		sum += samples[index] * samples[index];
	}
	return sum / (last - first);
}

export function peakAmplitude(samples, start = 0, end = samples.length) {
	const first = clamp(Math.floor(start), 0, samples.length);
	const last = clamp(Math.ceil(end), first, samples.length);
	let peak = 0;
	for (let index = first; index < last; index += 1) {
		peak = Math.max(peak, Math.abs(samples[index]));
	}
	return peak;
}

export function formatAnalyzerTime(seconds) {
	const value = Math.max(0, Number(seconds) || 0);
	const minutes = Math.floor(value / 60);
	const remainder = value - minutes * 60;
	return `${minutes}:${remainder.toFixed(3).padStart(6, '0')}`;
}

export function normalizeSelection(selection, duration, nyquist) {
	if (!selection) {
		return { startTime: 0, endTime: duration, lowFrequency: 0, highFrequency: nyquist };
	}

	const startTime = clamp(Math.min(selection.startTime, selection.endTime), 0, duration);
	const endTime = clamp(Math.max(selection.startTime, selection.endTime), startTime, duration);
	const lowFrequency = clamp(Math.min(selection.lowFrequency ?? 0, selection.highFrequency ?? nyquist), 0, nyquist);
	const highFrequency = clamp(Math.max(selection.lowFrequency ?? 0, selection.highFrequency ?? nyquist), lowFrequency, nyquist);
	return { startTime, endTime, lowFrequency, highFrequency };
}

export function downmixChannels(channels) {
	if (!channels.length) return new Float32Array();
	const length = Math.min(...channels.map((channel) => channel.length));
	const output = new Float32Array(length);
	const scale = 1 / channels.length;
	for (const channel of channels) {
		for (let index = 0; index < length; index += 1) {
			output[index] += channel[index] * scale;
		}
	}
	return output;
}

function biquadCoefficients(type, sampleRate, frequency, q, gain = 0) {
	const omega = (2 * Math.PI * frequency) / sampleRate;
	const cosine = Math.cos(omega);
	const sine = Math.sin(omega);
	const alpha = sine / (2 * q);
	let b0;
	let b1;
	let b2;
	let a0;
	let a1;
	let a2;

	if (type === 'highpass') {
		b0 = (1 + cosine) / 2;
		b1 = -(1 + cosine);
		b2 = (1 + cosine) / 2;
		a0 = 1 + alpha;
		a1 = -2 * cosine;
		a2 = 1 - alpha;
	} else {
		const a = 10 ** (gain / 40);
		const shelfAlpha = sine / 2 * Math.sqrt((a + 1 / a) * (1 / 1 - 1) + 2);
		const twoRootAAlpha = 2 * Math.sqrt(a) * shelfAlpha;
		b0 = a * ((a + 1) + (a - 1) * cosine + twoRootAAlpha);
		b1 = -2 * a * ((a - 1) + (a + 1) * cosine);
		b2 = a * ((a + 1) + (a - 1) * cosine - twoRootAAlpha);
		a0 = (a + 1) - (a - 1) * cosine + twoRootAAlpha;
		a1 = 2 * ((a - 1) - (a + 1) * cosine);
		a2 = (a + 1) - (a - 1) * cosine - twoRootAAlpha;
	}

	return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

function applyBiquad(samples, coefficients) {
	const [b0, b1, b2, a1, a2] = coefficients;
	const output = new Float32Array(samples.length);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	for (let index = 0; index < samples.length; index += 1) {
		const x0 = samples[index];
		const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
		output[index] = y0;
		x2 = x1;
		x1 = x0;
		y2 = y1;
		y1 = y0;
	}
	return output;
}

export function kWeightSamples(samples, sampleRate) {
	if (!samples.length || sampleRate <= 0) return new Float32Array();
	const shelf = biquadCoefficients('highshelf', sampleRate, 1681.974, 0.707, 4);
	const highpass = biquadCoefficients('highpass', sampleRate, 38.135, 0.5);
	return applyBiquad(applyBiquad(samples, shelf), highpass);
}

function loudnessFromEnergy(energy) {
	return energy > 0 ? -0.691 + 10 * Math.log10(energy) : MIN_DB;
}

function windowEnergies(samples, windowSize, stepSize) {
	if (!samples.length) return [];
	const size = Math.max(1, Math.min(samples.length, Math.round(windowSize)));
	const step = Math.max(1, Math.round(stepSize));
	const values = [];
	let sum = 0;
	for (let index = 0; index < size; index += 1) sum += samples[index] * samples[index];
	for (let start = 0; start + size <= samples.length; start += step) {
		if (start > 0) {
			const previous = start - step;
			for (let index = previous; index < Math.min(start, samples.length); index += 1) sum -= samples[index] * samples[index];
			for (let index = previous + size; index < Math.min(start + size, samples.length); index += 1) sum += samples[index] * samples[index];
		}
		values.push(Math.max(0, sum / size));
	}
	if (!values.length) values.push(meanSquare(samples));
	return values;
}

export function integratedLufs(weightedSamples, sampleRate) {
	const energies = windowEnergies(weightedSamples, sampleRate * 0.4, sampleRate * 0.1);
	const absoluteGated = energies.filter((energy) => loudnessFromEnergy(energy) >= -70);
	if (!absoluteGated.length) return MIN_DB;
	const ungatedEnergy = absoluteGated.reduce((sum, value) => sum + value, 0) / absoluteGated.length;
	const relativeGate = loudnessFromEnergy(ungatedEnergy) - 10;
	const relativeGated = absoluteGated.filter((energy) => loudnessFromEnergy(energy) >= relativeGate);
	const energy = relativeGated.reduce((sum, value) => sum + value, 0) / Math.max(1, relativeGated.length);
	return loudnessFromEnergy(energy);
}

export function analyzeLevels(samples, sampleRate) {
	if (!samples.length || sampleRate <= 0) {
		return { peakDbfs: MIN_DB, rmsDbfs: MIN_DB, momentaryLufs: MIN_DB, shortTermLufs: MIN_DB, integratedLufs: MIN_DB };
	}

	const weighted = kWeightSamples(samples, sampleRate);
	const momentary = windowEnergies(weighted, sampleRate * 0.4, sampleRate * 0.1).map(loudnessFromEnergy);
	const shortTerm = windowEnergies(weighted, sampleRate * 3, sampleRate).map(loudnessFromEnergy);
	return {
		peakDbfs: amplitudeToDbfs(peakAmplitude(samples)),
		rmsDbfs: amplitudeToDbfs(Math.sqrt(meanSquare(samples))),
		momentaryLufs: Math.max(...momentary),
		shortTermLufs: Math.max(...shortTerm),
		integratedLufs: integratedLufs(weighted, sampleRate),
	};
}

export function fftReal(samples, fftSize) {
	const size = 2 ** Math.floor(Math.log2(Math.max(2, fftSize)));
	const real = new Float64Array(size);
	const imaginary = new Float64Array(size);
	for (let index = 0; index < Math.min(samples.length, size); index += 1) real[index] = samples[index];

	for (let index = 1, reversed = 0; index < size; index += 1) {
		let bit = size >> 1;
		while (reversed & bit) {
			reversed ^= bit;
			bit >>= 1;
		}
		reversed ^= bit;
		if (index < reversed) {
			[real[index], real[reversed]] = [real[reversed], real[index]];
		}
	}

	for (let length = 2; length <= size; length *= 2) {
		const angle = -2 * Math.PI / length;
		const stepReal = Math.cos(angle);
		const stepImaginary = Math.sin(angle);
		for (let start = 0; start < size; start += length) {
			let twiddleReal = 1;
			let twiddleImaginary = 0;
			for (let offset = 0; offset < length / 2; offset += 1) {
				const even = start + offset;
				const odd = even + length / 2;
				const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
				const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
				real[odd] = real[even] - oddReal;
				imaginary[odd] = imaginary[even] - oddImaginary;
				real[even] += oddReal;
				imaginary[even] += oddImaginary;
				const nextReal = twiddleReal * stepReal - twiddleImaginary * stepImaginary;
				twiddleImaginary = twiddleReal * stepImaginary + twiddleImaginary * stepReal;
				twiddleReal = nextReal;
			}
		}
	}

	return { real, imaginary };
}

function hann(index, size) {
	return size <= 1 ? 1 : 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
}

export function createSpectrogram(samples, sampleRate, options = {}) {
	const fftSize = options.fftSize ?? 1024;
	const maxFrames = options.maxFrames ?? 640;
	const frameCount = Math.max(1, Math.min(maxFrames, Math.ceil(samples.length / Math.max(1, fftSize / 4))));
	const lastStart = Math.max(0, samples.length - fftSize);
	const frames = [];
	let minimum = Infinity;
	let maximum = -Infinity;

	for (let frame = 0; frame < frameCount; frame += 1) {
		const start = frameCount === 1 ? 0 : Math.round((frame / (frameCount - 1)) * lastStart);
		const windowed = new Float32Array(fftSize);
		for (let index = 0; index < fftSize; index += 1) {
			windowed[index] = (samples[start + index] ?? 0) * hann(index, fftSize);
		}
		const { real, imaginary } = fftReal(windowed, fftSize);
		const magnitudes = new Float32Array(fftSize / 2);
		for (let bin = 0; bin < magnitudes.length; bin += 1) {
			const magnitude = Math.hypot(real[bin], imaginary[bin]) / (fftSize / 2);
			const db = amplitudeToDbfs(magnitude);
			magnitudes[bin] = db;
			minimum = Math.min(minimum, db);
			maximum = Math.max(maximum, db);
		}
		frames.push(magnitudes);
	}

	return { frames, fftSize, sampleRate, minimum, maximum };
}

export function averageSpectrum(samples, sampleRate, options = {}) {
	const fftSize = options.fftSize ?? 2048;
	const maxFrames = options.maxFrames ?? 48;
	const lowFrequency = clamp(options.lowFrequency ?? 0, 0, sampleRate / 2);
	const highFrequency = clamp(options.highFrequency ?? sampleRate / 2, lowFrequency, sampleRate / 2);
	const frameCount = Math.max(1, Math.min(maxFrames, Math.ceil(samples.length / fftSize)));
	const lastStart = Math.max(0, samples.length - fftSize);
	const energy = new Float64Array(fftSize / 2);

	for (let frame = 0; frame < frameCount; frame += 1) {
		const start = frameCount === 1 ? 0 : Math.round((frame / (frameCount - 1)) * lastStart);
		const windowed = new Float32Array(fftSize);
		for (let index = 0; index < fftSize; index += 1) windowed[index] = (samples[start + index] ?? 0) * hann(index, fftSize);
		const { real, imaginary } = fftReal(windowed, fftSize);
		for (let bin = 0; bin < energy.length; bin += 1) energy[bin] += real[bin] ** 2 + imaginary[bin] ** 2;
	}

	const spectrum = [];
	for (let bin = 1; bin < energy.length; bin += 1) {
		const frequency = bin * sampleRate / fftSize;
		if (frequency < lowFrequency || frequency > highFrequency) continue;
		const rmsMagnitude = Math.sqrt(energy[bin] / frameCount) / (fftSize / 2);
		spectrum.push({ frequency, db: amplitudeToDbfs(rmsMagnitude) });
	}
	return spectrum;
}

export function roseusColor(value) {
	const normalized = clamp(value, 0, 1) * (ROSEUS_STOPS.length - 1);
	const first = Math.floor(normalized);
	const second = Math.min(ROSEUS_STOPS.length - 1, first + 1);
	const mix = normalized - first;
	return ROSEUS_STOPS[first].map((channel, index) => Math.round(channel + (ROSEUS_STOPS[second][index] - channel) * mix));
}
