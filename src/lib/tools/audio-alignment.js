/*
 * Every MP3 encoder prepends its own decoder delay, so the encoded copy starts a
 * fraction of a second later than the file it was made from. Played untouched
 * against each other, that head start is an audible timing cue rather than a
 * quality difference, which is not what a blind test is meant to measure.
 *
 * The shift is recovered with a normalised cross-correlation over a bounded
 * window: a coarse pass correlates block averages - averaging is what keeps
 * neighbouring shifts correlated, so the peak survives the decimation - and a
 * fine pass then resolves the exact sample around it.
 */

/* An encoder delay is a couple of dozen milliseconds; a tenth of a second is plenty of room. */
const MAX_ENCODER_DELAY_SECONDS = 0.1;

const DEFAULT_MAX_OFFSET = 4410;
const DEFAULT_ANALYSIS_LENGTH = 65536;
const DEFAULT_COARSE_STEP = 8;
/* Periodic material correlates just as well a whole period away, so near-ties count as ties. */
const TIE_TOLERANCE = 1e-6;

/**
 * Finds the shift, in samples, that lines `candidate` up with `reference`.
 * A positive result means the candidate lags: candidate[n + offset] matches
 * reference[n], which is what a prepended encoder delay produces. The search is
 * bounded, so a true offset outside the window comes back as the best answer
 * inside it instead of running away.
 */
export function estimateAlignmentOffset(reference, candidate, options = {}) {
	const ref = toSamples(reference);
	const cand = toSamples(candidate);
	const maxOffset = boundedCount(options.maxOffset, defaultMaxOffset(options.sampleRate), 0);
	const analysisLength = boundedCount(options.analysisLength, DEFAULT_ANALYSIS_LENGTH, 1);
	const coarseStep = boundedCount(options.coarseStep, DEFAULT_COARSE_STEP, 1);

	if (!ref.length || !cand.length || maxOffset < 1) {
		return 0;
	}

	/*
	 * Every offset has to score the very same window, or a longer shift would win
	 * simply by correlating fewer samples. The guard band on both sides of the
	 * analysis window is what buys that, so it is reserved before anything is read.
	 */
	const span = Math.ceil(maxOffset / coarseStep) * coarseStep;
	const start = Math.min(span, ref.length - 1);
	const length = Math.min(analysisLength, ref.length - start, cand.length - start - span);

	/* Correlating silence against anything is meaningless, so keep the samples where they are. */
	if (length < 1 || !hasEnergy(ref, start, length) || !hasEnergy(cand, start - span, length + 2 * span)) {
		return 0;
	}

	const coarse = coarseOffset(ref, cand, start, length, maxOffset, coarseStep);
	const low = Math.max(-maxOffset, coarse - coarseStep);
	const high = Math.min(maxOffset, coarse + coarseStep);

	return bestOffset(low, high, (offset) => correlate(ref, cand, start, length, offset));
}

function coarseOffset(ref, cand, start, length, maxOffset, step) {
	const steps = Math.ceil(maxOffset / step);
	const frames = Math.floor(length / step);

	if (frames < 1) {
		return 0;
	}

	const refFrames = frameAverages(ref, start, frames, step);
	const candFrames = frameAverages(cand, start - steps * step, frames + 2 * steps, step);
	const best = bestOffset(-steps, steps, (offset) => correlate(refFrames, candFrames, 0, frames, offset + steps));

	return Math.max(-maxOffset, Math.min(maxOffset, best * step));
}

/* Ties resolve towards the smallest shift, so silence and periodic tones move as little as possible. */
function bestOffset(low, high, score) {
	if (high < low) {
		return 0;
	}

	const scores = [];
	let best = low;
	let bestScore = -Infinity;

	for (let offset = low; offset <= high; offset += 1) {
		const current = score(offset);
		scores.push(current);

		if (current > bestScore) {
			bestScore = current;
			best = offset;
		}
	}

	for (let index = 0; index < scores.length; index += 1) {
		const offset = low + index;

		if (scores[index] > bestScore - TIE_TOLERANCE && Math.abs(offset) < Math.abs(best)) {
			best = offset;
		}
	}

	return best;
}

function correlate(ref, cand, start, length, offset) {
	const from = Math.max(start, -offset, 0);
	const to = Math.min(start + length, ref.length, cand.length - offset);
	let dot = 0;
	let refEnergy = 0;
	let candEnergy = 0;

	for (let index = from; index < to; index += 1) {
		const a = ref[index];
		const b = cand[index + offset];
		dot += a * b;
		refEnergy += a * a;
		candEnergy += b * b;
	}

	const norm = Math.sqrt(refEnergy * candEnergy);
	return norm > 0 ? dot / norm : 0;
}

function frameAverages(samples, from, count, size) {
	const frames = new Float64Array(Math.max(0, count));

	for (let frame = 0; frame < frames.length; frame += 1) {
		const base = from + frame * size;
		let sum = 0;

		for (let index = 0; index < size; index += 1) {
			const position = base + index;

			if (position >= 0 && position < samples.length) {
				sum += samples[position];
			}
		}

		frames[frame] = sum / size;
	}

	return frames;
}

function hasEnergy(samples, from, length) {
	const start = Math.max(0, from);
	const end = Math.min(samples.length, from + length);

	for (let index = start; index < end; index += 1) {
		if (samples[index]) {
			return true;
		}
	}

	return false;
}

function toSamples(value) {
	if (Array.isArray(value)) {
		return Float64Array.from(value, (sample) => Number(sample) || 0);
	}

	return value && typeof value.length === 'number' ? value : new Float64Array(0);
}

function boundedCount(value, fallback, minimum) {
	const count = Math.floor(Number(value));
	return Number.isFinite(count) && count >= minimum ? count : fallback;
}

function defaultMaxOffset(sampleRate) {
	const rate = Number(sampleRate);
	return Number.isFinite(rate) && rate > 0 ? Math.round(rate * MAX_ENCODER_DELAY_SECONDS) : DEFAULT_MAX_OFFSET;
}

/**
 * Cuts `offset` samples off the front of a channel, which is how a measured
 * encoder delay is removed. A zero or unusable offset returns the samples
 * untouched so a caller can always hand the result straight back.
 */
export function shiftSamples(samples, offset) {
	const source = toSamples(samples);
	const shift = Math.trunc(Number(offset)) || 0;
	const length = source.length - shift;

	if (!shift || length < 1) {
		return source;
	}

	const shifted = new Float32Array(length);

	for (let index = 0; index < length; index += 1) {
		const position = index + shift;
		shifted[index] = position >= 0 && position < source.length ? source[position] : 0;
	}

	return shifted;
}
