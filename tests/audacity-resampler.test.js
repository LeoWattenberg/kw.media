import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudacitySampleReader } from '../src/lib/tools/audacity-resampler.js';

test('Audacity resampling keeps unity-rate source samples exact', () => {
	const samples = Float32Array.from([1.25, -0.8, 0.125, -1, 0.75]);
	const read = createAudacitySampleReader(samples, 1, 1, 4);
	assert.deepEqual(Array.from({ length: 5 }, (_, index) => read(index)), [0, samples[1], samples[2], samples[3], 0]);
});

test('Audacity resampling supports fractional positions even when its source step is unity', () => {
	const samples = Float32Array.from({ length: 1_024 }, (_, index) => Math.sin(index * 0.3));
	const read = createAudacitySampleReader(samples, 1);
	for (let index = 100; index < 900; index += 1) assert.ok(Math.abs(read(index + 0.5) - Math.sin((index + 0.5) * 0.3)) < 1e-5);
});

test('Audacity resampling preserves passband amplitude at integer and fractional ratios', () => {
	for (const [sourceRate, outputRate, frequency] of [
		[48_000, 24_000, 9_000],
		[48_000, 16_000, 6_000],
		[48_000, 44_100, 15_000],
		[44_100, 48_000, 15_000],
		[8_000, 48_000, 2_000],
	]) {
		const sourceStep = sourceRate / outputRate;
		const samples = Float32Array.from({ length: Math.round(sourceRate / 10) }, (_, index) => Math.sin(2 * Math.PI * frequency * index / sourceRate));
		const read = createAudacitySampleReader(samples, sourceStep);
		const outputLength = Math.round(samples.length / sourceStep);
		let squaredError = 0;
		let count = 0;
		for (let index = 512; index < outputLength - 512; index += 1) {
			const expected = Math.sin(2 * Math.PI * frequency * index / outputRate);
			const error = read(index * sourceStep) - expected;
			squaredError += error * error;
			count += 1;
		}
		assert.ok(count > 0);
		const rmsError = Math.sqrt(squaredError / count);
		assert.ok(rmsError < 0.001, `${sourceRate} -> ${outputRate} at ${frequency} Hz has RMS error ${rmsError}`);
	}
});

test('Audacity resampling rejects out-of-band tones instead of folding them into the passband', () => {
	for (const [sourceRate, outputRate, frequency] of [
		[48_000, 24_000, 12_000],
		[48_000, 24_000, 18_000],
		[48_000, 24_000, 23_999],
		[48_000, 44_100, 23_000],
		[48_000, 8_000, 6_000],
	]) {
		const sourceStep = sourceRate / outputRate;
		const samples = Float32Array.from({ length: sourceRate / 4 }, (_, index) => Math.cos(2 * Math.PI * frequency * index / sourceRate));
		const read = createAudacitySampleReader(samples, sourceStep);
		const outputLength = Math.round(samples.length / sourceStep);
		let squaredMagnitude = 0;
		let count = 0;
		for (let index = 256; index < outputLength - 256; index += 1) {
			const sample = read(index * sourceStep);
			squaredMagnitude += sample * sample;
			count += 1;
		}
		const rms = Math.sqrt(squaredMagnitude / count);
		assert.ok(rms < 0.001, `${sourceRate} -> ${outputRate} at ${frequency} Hz has alias RMS ${rms}`);
	}
});

test('Audacity resampling keeps DC gain and excludes hidden trimmed samples at boundaries', () => {
	const dc = new Float32Array(2_048).fill(0.25);
	for (const sourceStep of [0.5, 1.088435374, 2, 6]) {
		const read = createAudacitySampleReader(dc, sourceStep);
		assert.ok(Math.abs(read(1_024) - 0.25) < 1e-6);
		const hidden = new Float32Array(2_048).fill(1_000);
		hidden.fill(0, 512, 1_536);
		const readTrimmed = createAudacitySampleReader(hidden, sourceStep, 512, 1_536);
		for (const position of [512, 512.25, 1_535, 1_535.75]) assert.equal(readTrimmed(position), 0);
	}
});

test('Audacity resampling bounds filter storage when downsampling by very large ratios', () => {
	const samples = new Float32Array(4_096).fill(1);
	const read = createAudacitySampleReader(samples, 1_000_000);
	assert.ok(Number.isFinite(read(0)));
	assert.ok(Number.isFinite(read(2_000)));
});
