import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import {
	getAudacityMemoryLimits,
	resolveAudacityMemoryLimits,
} from '../src/lib/tools/audacity-project-runtime.js';
import {
	decodeAup3Bytes,
	decodeAup3File,
	requiresAup3LargeProjectConfirmation,
} from '../src/lib/tools/aup3-browser.js';
import { decodeAup3SampleBlock } from '../src/lib/tools/aup3.js';
import { decodeAup4Bytes, decodeAup4File } from '../src/lib/tools/aup4-browser.js';
import { convertAup4BytesToAup3, convertAup4FileToAup3 } from '../src/lib/tools/aup4.js';
import { AUP3_SAMPLE_FORMAT, createAup3Fixture } from './aup3-fixture.js';
import { createAup4Fixture } from './aup4-fixture.js';

const SQL = await initSqlJs();
const MEBIBYTE = 1024 * 1024;
const SAMPLES = [0.25, -0.5, 0.75, 0];

test('confirmation follows the device warning threshold and retains the old large profile', () => {
	for (const [options, threshold] of [
		[{ navigator: { deviceMemory: 8, userAgent: 'Desktop' } }, 256 * MEBIBYTE],
		[{ navigator: { deviceMemory: 4, userAgent: 'Desktop' } }, 128 * MEBIBYTE],
		[{ navigator: { deviceMemory: 8, userAgentData: { mobile: true } } }, 128 * MEBIBYTE],
		[{ allowLargeProject: true }, 512 * MEBIBYTE],
	]) {
		assert.equal(getAudacityMemoryLimits(options).databaseBytes, threshold);
		assert.equal(requiresAup3LargeProjectConfirmation(threshold, options), false);
		assert.equal(requiresAup3LargeProjectConfirmation(threshold + 1, options), true);
	}
});

test('confirmation overrides every advisory budget, including supplied budgets', () => {
	assert.deepEqual(resolveAudacityMemoryLimits({
		allowLargeProject: true,
		memoryLimits: { databaseBytes: 1, decodedAudioBytes: 1, mixBytes: 1 },
	}), {
		databaseBytes: Number.MAX_SAFE_INTEGER,
		decodedAudioBytes: Number.MAX_SAFE_INTEGER,
		mixBytes: Number.MAX_SAFE_INTEGER,
	});
});

test('resolved budgets survive worker handoff without the former maximum clamp', () => {
	const largerBudgets = {
		databaseBytes: 1024 * MEBIBYTE,
		decodedAudioBytes: 1536 * MEBIBYTE,
		mixBytes: 2048 * MEBIBYTE,
	};
	assert.deepEqual(resolveAudacityMemoryLimits({ memoryLimits: largerBudgets }), largerBudgets);
	const confirmedBudgets = resolveAudacityMemoryLimits({ allowLargeProject: true });
	assert.deepEqual(resolveAudacityMemoryLimits({ memoryLimits: confirmedBudgets }), confirmedBudgets);
	assert.deepEqual(resolveAudacityMemoryLimits({ memoryLimits: {
		databaseBytes: Number.MAX_VALUE,
		decodedAudioBytes: Number.MAX_VALUE,
		mixBytes: Number.MAX_VALUE,
	} }), confirmedBudgets);
});

for (const [format, makeFixture, decode] of [
	['AUP3', createAup3Fixture, decodeAup3Bytes],
	['AUP4', createAup4Fixture, decodeAup4Bytes],
]) {
	test(`${format} confirmation allows audio beyond each database, decoded-audio, and mix budget`, async (t) => {
		const source = await makeFixture({ SQL });
		for (const [budget, warningThreshold] of [
			['databaseBytes', source.byteLength - 1],
			['decodedAudioBytes', SAMPLES.length * Float32Array.BYTES_PER_ELEMENT - 1],
			['mixBytes', SAMPLES.length * Float32Array.BYTES_PER_ELEMENT - 1],
		]) {
			await t.test(budget, async () => {
				const memoryLimits = {
					databaseBytes: MEBIBYTE,
					decodedAudioBytes: MEBIBYTE,
					mixBytes: MEBIBYTE,
					[budget]: warningThreshold,
				};
				await assert.rejects(decode(source, { SQL, memoryLimits }),
					(error) => error.code === 'PROJECT_TOO_LARGE' && error.memoryLimitExceeded === true);
				const decoded = await decode(source, { SQL, memoryLimits, allowLargeProject: true });
				assert.equal(decoded.sampleRate, 48_000);
				assert.equal(decoded.channels.length, 1);
				assert.deepEqual(Array.from(decoded.channels[0]), SAMPLES);
			});
		}
	});
}

test('AUP4 to AUP3 confirmation preserves a valid project beyond the database budget', async () => {
	const source = await createAup4Fixture({ SQL, autosave: true });
	const original = source.slice();
	const memoryLimits = { databaseBytes: source.byteLength - 1 };
	await assert.rejects(convertAup4BytesToAup3(source, { SQL, memoryLimits }),
		(error) => error.code === 'PROJECT_TOO_LARGE' && error.memoryLimitExceeded === true);
	const converted = await convertAup4BytesToAup3(source, { SQL, memoryLimits, allowLargeProject: true });
	assert.deepEqual(source, original);
	const database = new SQL.Database(converted);
	try {
		assert.deepEqual(database.exec('PRAGMA integrity_check')[0].values, [['ok']]);
		assert.deepEqual(database.exec('PRAGMA user_version')[0].values, [[0x03070000]]);
		const sourceDatabase = new SQL.Database(source);
		try {
			assert.deepEqual(database.exec('SELECT * FROM sampleblocks')[0].values,
				sourceDatabase.exec('SELECT * FROM sampleblocks')[0].values);
		} finally {
			sourceDatabase.close();
		}
	} finally {
		database.close();
	}
	const decoded = await decodeAup3Bytes(converted, { SQL });
	assert.equal(decoded.metadata.source, 'autosave');
	assert.deepEqual(Array.from(decoded.channels[0]), SAMPLES);
});

test('confirmed file reads can attempt sizes above the former 512 MiB maximum', async (t) => {
	const aup3 = await createAup3Fixture({ SQL });
	const aup4 = await createAup4Fixture({ SQL });
	for (const [name, source, convert, readAudio] of [
		['AUP3 to WAV', aup3, decodeAup3File, async (output) => output],
		['AUP4 to WAV', aup4, decodeAup4File, async (output) => output],
		['AUP4 to AUP3', aup4, convertAup4FileToAup3,
			async (output) => decodeAup3Bytes(await output.arrayBuffer(), { SQL })],
	]) {
		await t.test(name, async () => {
			let reads = 0;
			// The advertised size exercises file checks without allocating 512 MiB.
			const file = {
				name: source === aup3 ? 'large.aup3' : 'large.aup4',
				size: 512 * MEBIBYTE + 1,
				async arrayBuffer() {
					reads += 1;
					return source.slice().buffer;
				},
			};
			assert.equal(requiresAup3LargeProjectConfirmation(file.size), true);
			await assert.rejects(convert(file, { SQL }),
				(error) => error.code === 'PROJECT_TOO_LARGE' && error.memoryLimitExceeded === true);
			assert.equal(reads, 0);
			const decoded = await readAudio(await convert(file, { SQL, allowLargeProject: true }));
			assert.equal(reads, 1);
			assert.deepEqual(Array.from(decoded.channels[0]), SAMPLES);
		});
	}
});

test('sample block allocation respects the supplied frame budget', () => {
	const bytes = new Float32Array(SAMPLES);
	assert.throws(() => decodeAup3SampleBlock(bytes, AUP3_SAMPLE_FORMAT.FLOAT32, { maxFrames: 3 }),
		(error) => error.code === 'PROJECT_TOO_LARGE' && error.memoryLimitExceeded === true);
	assert.deepEqual(Array.from(decodeAup3SampleBlock(bytes, AUP3_SAMPLE_FORMAT.FLOAT32, { maxFrames: 4 })), SAMPLES);
});

test('allocation failures do not request another memory-budget confirmation', (t) => {
	const bytes = new Float32Array(SAMPLES);
	const allocation = t.mock.method(globalThis, 'Float32Array', function () {
		throw new RangeError('Simulated browser allocation failure.');
	});
	try {
		assert.throws(() => decodeAup3SampleBlock(bytes, AUP3_SAMPLE_FORMAT.FLOAT32, { maxFrames: 4 }),
			(error) => error.code === 'PROJECT_TOO_LARGE' && !error.memoryLimitExceeded && error.cause instanceof RangeError);
	} finally {
		allocation.mock.restore();
	}
});

test('structural project failures remain errors after confirmation without prompting again', async (t) => {
	for (const [format, makeFixture, decode] of [
		['AUP3', createAup3Fixture, decodeAup3Bytes],
		['AUP4', createAup4Fixture, decodeAup4Bytes],
	]) {
		await t.test(`${format} invalid sample bytes`, async () => {
			const database = new SQL.Database(await makeFixture({ SQL }));
			let corrupted;
			try {
				database.run('UPDATE sampleblocks SET samples = ?', [Uint8Array.of(0)]);
				corrupted = database.export();
			} finally {
				database.close();
			}
			await assert.rejects(decode(corrupted, { SQL, allowLargeProject: true }),
				(error) => error.code === 'INVALID_SAMPLE_BLOCK' && !error.memoryLimitExceeded);
		});
		await t.test(`${format} unsafe mix frame count`, async () => {
			const source = await makeFixture({
				SQL,
				tracks: [{ clips: [{ samples: Array(256).fill(0.25), offset: Number.MAX_SAFE_INTEGER / 1000 }] }],
			});
			await assert.rejects(decode(source, { SQL, allowLargeProject: true }),
				(error) => error.code === 'PROJECT_TOO_LARGE' && !error.memoryLimitExceeded);
		});
	}
});
