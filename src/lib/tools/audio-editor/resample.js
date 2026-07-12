/**
 * Bounded, stateful linear resampler for recordings and streamed renders. It
 * retains only the interpolation boundary between chunks and preserves the
 * exact long-term frame ratio across arbitrary chunk sizes.
 */
export function createStreamingLinearResampler(inputSampleRate, outputSampleRate, channelCount) {
	const inputRate = Math.max(1, Math.round(inputSampleRate));
	const outputRate = Math.max(1, Math.round(outputSampleRate));
	const channels = Math.max(1, Math.floor(channelCount));
	const step = inputRate / outputRate;
	let totalInputFrames = 0;
	let totalOutputFrames = 0;
	let nextInputPosition = 0;
	let carryStartFrame = 0;
	let carry = emptyChannels(channels);
	let lastSamples = new Float32Array(channels);

	return { push, finish };

	function push(inputChannels) {
		if (!Array.isArray(inputChannels) || inputChannels.length !== channels) throw new RangeError('Recording channel count changed.');
		const frameCount = inputChannels[0]?.length || 0;
		if (inputChannels.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
			throw new RangeError('Audio chunks must contain equally sized Float32 channels.');
		}
		if (!frameCount) return emptyChannels(channels);
		for (let channel = 0; channel < channels; channel += 1) lastSamples[channel] = inputChannels[channel][frameCount - 1];
		if (inputRate === outputRate) {
			totalInputFrames += frameCount;
			totalOutputFrames += frameCount;
			return inputChannels;
		}

		const carryLength = carry[0].length;
		const baseFrame = carryLength ? carryStartFrame : totalInputFrames;
		const combined = Array.from({ length: channels }, (_, channel) => {
			const values = new Float32Array(carryLength + frameCount);
			values.set(carry[channel]);
			values.set(inputChannels[channel], carryLength);
			return values;
		});
		totalInputFrames += frameCount;
		const capacity = Math.max(0, Math.ceil((combined[0].length + 1) * outputRate / inputRate));
		const output = Array.from({ length: channels }, () => new Float32Array(capacity));
		let written = 0;
		const endFrameExclusive = baseFrame + combined[0].length;
		while (Math.floor(nextInputPosition) + 1 < endFrameExclusive) {
			const firstFrame = Math.floor(nextInputPosition);
			const fraction = nextInputPosition - firstFrame;
			const firstIndex = firstFrame - baseFrame;
			for (let channel = 0; channel < channels; channel += 1) {
				const first = combined[channel][firstIndex];
				const second = combined[channel][firstIndex + 1];
				output[channel][written] = first + (second - first) * fraction;
			}
			written += 1;
			nextInputPosition += step;
		}
		totalOutputFrames += written;
		const keepIndex = Math.max(0, Math.min(combined[0].length - 1, Math.floor(nextInputPosition) - baseFrame));
		carryStartFrame = baseFrame + keepIndex;
		carry = combined.map((values) => values.slice(keepIndex));
		return output.map((values) => values.slice(0, written));
	}

	function finish(requestedOutputFrames = null) {
		if (!totalInputFrames) return emptyChannels(channels);
		const naturalExpectedFrames = Math.round(totalInputFrames * outputRate / inputRate);
		const expectedFrames = requestedOutputFrames == null
			? naturalExpectedFrames
			: Math.max(totalOutputFrames, Math.round(requestedOutputFrames));
		const interpolationFrames = Math.max(0, Math.min(naturalExpectedFrames, expectedFrames) - totalOutputFrames);
		const remaining = Math.max(0, expectedFrames - totalOutputFrames);
		totalOutputFrames += remaining;
		return Array.from({ length: channels }, (_, channel) => {
			const output = new Float32Array(remaining);
			output.fill(lastSamples[channel], 0, interpolationFrames);
			return output;
		});
	}
}

function emptyChannels(channelCount) {
	return Array.from({ length: channelCount }, () => new Float32Array(0));
}
