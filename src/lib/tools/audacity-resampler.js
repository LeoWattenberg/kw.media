// A symmetric, 128-zero-crossing Blackman-Harris windowed sinc. Downsampling
// widens the input support and lowers the cutoff together, keeping the same
// stop-band rejection at every ratio. A small guard band prevents frequencies
// at the destination Nyquist limit from folding into the audible band.
const KERNEL_RADIUS = 64;
const KERNEL_RESOLUTION = 1_024;
const CUTOFF_MARGIN = 0.95;
let kernelTable;

/**
 * Read a trimmed sequence at fractional source positions with a low-pass
 * filter. The table uses a fixed 512 KiB, even for very large downsample ratios;
 * source taps outside the visible clip are silence, never hidden trimmed audio.
 * Audacity uses libsoxr; this browser filter is not a bit-identical replacement.
 */
export function createAudacitySampleReader(samples, sourceStep, start = 0, end = samples.length) {
	if (sourceStep === 1) {
		let fractionalReader;
		return (position) => {
			// Keep aligned unity samples exact. A stretched clip can have unity
			// step with a fractional starting phase, which still needs filtering.
			const index = Math.round(position);
			if (Math.abs(position - index) < 1e-9) return index >= start && index < end ? samples[index] : 0;
			fractionalReader ||= createFilteredSampleReader(samples, sourceStep, start, end);
			return fractionalReader(position);
		};
	}
	return createFilteredSampleReader(samples, sourceStep, start, end);
}

export function getAudacityResamplingRadius(sourceStep) {
	return KERNEL_RADIUS / (Math.min(1, 1 / sourceStep) * CUTOFF_MARGIN);
}

function createFilteredSampleReader(samples, sourceStep, start, end) {
	const cutoff = Math.min(1, 1 / sourceStep) * CUTOFF_MARGIN;
	const radius = getAudacityResamplingRadius(sourceStep);
	const table = getKernelTable();
	const weight = (distance) => {
		const tablePosition = Math.abs(distance) * cutoff * KERNEL_RESOLUTION;
		const index = Math.floor(tablePosition);
		if (index >= table.length - 1) return 0;
		const fraction = tablePosition - index;
		return cutoff * (table[index] + fraction * (table[index + 1] - table[index]));
	};
	const readFiltered = (position) => {
		let sum = 0;
		const first = Math.max(start, Math.ceil(position - radius));
		const last = Math.min(end - 1, Math.floor(position + radius));
		for (let index = first; index <= last; index += 1) sum += samples[index] * weight(index - position);
		return sum;
	};
	if (Number.isInteger(sourceStep) && Number.isFinite(radius) && radius <= 4_096) {
		// Integer decimation always uses the same phase. Cache its coefficients
		// once, rather than computing a kernel lookup for every output sample.
		const extent = Math.ceil(radius);
		const coefficients = new Float64Array(2 * extent + 1);
		for (let offset = -extent; offset <= extent; offset += 1) coefficients[offset + extent] = weight(offset);
		return (position) => {
			if (!Number.isInteger(position)) return readFiltered(position);
			let sum = 0;
			const first = Math.max(start, position - extent);
			const last = Math.min(end - 1, position + extent);
			for (let index = first; index <= last; index += 1) sum += samples[index] * coefficients[index - position + extent];
			return sum;
		};
	}
	return readFiltered;
}

function getKernelTable() {
	if (kernelTable) return kernelTable;
	kernelTable = new Float64Array(KERNEL_RADIUS * KERNEL_RESOLUTION + 1);
	for (let index = 0; index < kernelTable.length; index += 1) {
		const distance = index / KERNEL_RESOLUTION;
		const angle = Math.PI * distance / KERNEL_RADIUS;
		const window = 0.35875 + 0.48829 * Math.cos(angle) + 0.14128 * Math.cos(2 * angle) + 0.01168 * Math.cos(3 * angle);
		const sinc = distance === 0 ? 1 : Math.sin(Math.PI * distance) / (Math.PI * distance);
		kernelTable[index] = sinc * window;
	}
	return kernelTable;
}
