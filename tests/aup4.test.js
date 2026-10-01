import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import initSqlJs from 'sql.js';
import {
	AUP3_USER_VERSION,
	AUP4_USER_VERSION,
	aup4ToAup3OutputName,
	convertAup4BytesToAup3,
	convertAup4FileToAup3,
	inspectAup4Header,
} from '../src/lib/tools/aup4.js';
import {
	aup4OutputName,
	decodeAup4Bytes,
	decodeAup4File,
	isAup4FileName,
} from '../src/lib/tools/aup4-browser.js';
import { decodeAup3Bytes } from '../src/lib/tools/aup3-browser.js';
import { parseAup3BinaryXml, rewriteAup4ProjectForAup3 } from '../src/lib/tools/aup3.js';
import { createAup3Fixture } from './aup3-fixture.js';
import { createAup4Fixture } from './aup4-fixture.js';
import { AUP4_NATIVE_RICH_SHA256, aup4NativeRichFixture } from './aup4-native-fixture.js';

const SQL = await initSqlJs();

test('uses the current Audacity 4 and Audacity 3 SQLite versions', () => {
	assert.equal(AUP4_USER_VERSION, 0x04000001);
	assert.equal(AUP3_USER_VERSION, 0x03070000);
});

test('AUP4 to AUP3 preserves audio, project metadata, autosave, and the source bytes', async () => {
	const source = await createAup4Fixture({ SQL, autosave: true });
	const original = source.slice();
	const converted = await convertAup4BytesToAup3(source, { SQL });

	assert.ok(converted instanceof Uint8Array);
	assert.notEqual(converted.buffer, source.buffer);
	assert.deepEqual(source, original);
	assert.equal(headerView(converted).getUint32(60, false), 0x03070000);
	assert.equal(headerView(converted).getUint32(68, false), 0x41554459);
	assert.deepEqual(sqlRows(converted, 'PRAGMA integrity_check'), [['ok']]);
	assert.deepEqual(sqlRows(converted, 'SELECT * FROM sampleblocks'), sqlRows(source, 'SELECT * FROM sampleblocks'));
	assert.deepEqual(sqlRows(converted, 'SELECT type, name, sql FROM sqlite_master'), sqlRows(source, 'SELECT type, name, sql FROM sqlite_master'));
	for (const table of ['project', 'autosave']) {
		const before = projectXml(source, table);
		const after = projectXml(converted, table);
		assert.equal(before.attributes.version, '2.0.0');
		assert.equal(after.attributes.version, '1.3.0');
		before.attributes.version = '1.3.0';
		assert.deepEqual(after, before);
	}
	const decoded = await decodeAup3Bytes(converted, { SQL });
	assert.deepEqual(Array.from(decoded.channels[0]), [0.25, -0.5, 0.75, 0]);
	assert.equal(decoded.metadata.source, 'autosave');
});

test('conversion respects binary views with a nonzero byte offset', async () => {
	const source = await createAup4Fixture({ SQL });
	const enclosing = new Uint8Array(source.byteLength + 17).fill(0xa5);
	enclosing.set(source, 9);
	const converted = await convertAup4BytesToAup3(new DataView(enclosing.buffer, 9, source.byteLength), { SQL });
	assert.deepEqual(converted, await convertAup4BytesToAup3(source, { SQL }));
	assert.equal(enclosing[0], 0xa5);
	assert.equal(enclosing.at(-1), 0xa5);
	assert.equal(headerView(enclosing.subarray(9)).getUint32(60, false), 0x04000001);
});

test('file conversion returns a readable AUP3 Blob and preserves the source file', async () => {
	const source = await createAup4Fixture({ SQL });
	const blob = new Blob([source], { type: 'application/octet-stream' });
	Object.defineProperty(blob, 'name', { value: 'session.aup4' });
	const converted = await convertAup4FileToAup3(blob, { SQL });

	assert.ok(converted instanceof Blob);
	assert.deepEqual(new Uint8Array(await converted.arrayBuffer()), await convertAup4BytesToAup3(source, { SQL }));
	assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), source);
	assert.equal(headerView(source).getUint32(60, false), 0x04000001);
});

test('rejects other project formats and malformed AUP4 databases before conversion', async () => {
	const valid = await createAup4Fixture({ SQL });
	const invalid = [
		new Uint8Array(),
		new TextEncoder().encode('not an Audacity database'),
		valid.slice(0, 99),
		patchHeader(valid, 0, 0),
		patchHeader(valid, 68, 0),
		patchHeader(valid, 68, 0x41555034),
		patchHeader(valid, 60, 0),
		patchHeader(valid, 60, 0x03050000),
		patchHeader(valid, 60, 0x04000002),
		patchHeader(valid, 60, 0x05000000),
		patchHeader(valid, 16, 0, 2),
		patchHeader(valid, 16, 1023, 2),
		valid.slice(0, -1),
	];
	for (const [index, bytes] of invalid.entries()) {
		const before = bytes.slice();
		await assert.rejects(convertAup4BytesToAup3(bytes, { SQL }), `invalid input ${index}`);
		assert.deepEqual(bytes, before, `invalid input ${index} is unchanged`);
		await assert.rejects(decodeAup4Bytes(bytes, { SQL }), `invalid audio input ${index}`);
	}
	await assert.rejects(convertAup4BytesToAup3('session.aup4', { SQL }), TypeError);
	await assert.rejects(convertAup4FileToAup3(null), TypeError);
	await assert.rejects(decodeAup4File(null));
});

test('rejects an AUP3 database even when it has an AUP4 filename', async () => {
	const source = await createAup3Fixture({ SQL });
	await assert.rejects(decodeAup4Bytes(source, { SQL, fileName: 'renamed.aup4' }));
	await assert.rejects(convertAup4BytesToAup3(source, { SQL }));
});

test('validates SQLite page sizes and authoritative page counts from a partial header', async () => {
	const source = await createAup4Fixture({ SQL });
	assert.deepEqual(inspectAup4Header(source.subarray(0, 100), { fileSize: source.byteLength }), {
		userVersion: 0x04000001, pageSize: 4096,
	});
	const wrongPageCount = patchHeader(source, 28, headerView(source).getUint32(28, false) + 1);
	assert.throws(() => inspectAup4Header(wrongPageCount), (error) => error.code === 'INVALID_DATABASE');
	const database = new SQL.Database(source);
	let largePages;
	try {
		database.run('PRAGMA page_size = 65536');
		database.run('VACUUM');
		largePages = database.export();
	} finally {
		database.close();
	}
	assert.equal(headerView(largePages).getUint16(16, false), 1);
	assert.deepEqual(inspectAup4Header(largePages), { userVersion: 0x04000001, pageSize: 65536 });
	assert.deepEqual(sqlRows(await convertAup4BytesToAup3(largePages, { SQL }), 'PRAGMA integrity_check'), [['ok']]);
});

test('rejects SQLite lookalikes with no Audacity project tables', async () => {
	const database = new SQL.Database();
	let source;
	try {
		database.run('PRAGMA application_id = 0x41554459');
		database.run('PRAGMA user_version = 0x04000001');
		database.run('CREATE TABLE unrelated (value TEXT)');
		source = database.export();
	} finally {
		database.close();
	}
	await assert.rejects(convertAup4BytesToAup3(source, { SQL }), (error) => error.code === 'NOT_AUP4');
	await assert.rejects(decodeAup4Bytes(source, { SQL }));
});

test('accepts both current AUP4 SQLite versions and projects already using the AUP3 XML version', async () => {
	for (const userVersion of [0x04000000, 0x04000001]) {
		for (const projectVersion of ['2.0.0', '1.3.0']) {
			const source = await createAup4Fixture({ SQL, userVersion, projectVersion });
			assert.deepEqual(inspectAup4Header(source), { userVersion, pageSize: 4096 });
			const converted = await convertAup4BytesToAup3(source, { SQL });
			assert.equal(headerView(converted).getUint32(60, false), 0x03070000);
			assert.equal(projectXml(converted).attributes.version, '1.3.0');
			assert.deepEqual(Array.from((await decodeAup4Bytes(source, { SQL })).channels[0]), [0.25, -0.5, 0.75, 0]);
		}
	}
});

test('rejects future SQLite and embedded XML project versions clearly', async () => {
	const futureHeader = await createAup4Fixture({ SQL, userVersion: 0x04000002 });
	await assert.rejects(
		convertAup4BytesToAup3(futureHeader, { SQL }),
		(error) => error.code === 'UNSUPPORTED_AUP4_VERSION',
	);
	for (const projectVersion of ['2.1.0', '4.0.0']) {
		const futureXml = await createAup4Fixture({ SQL, projectVersion });
		await assert.rejects(
			convertAup4BytesToAup3(futureXml, { SQL }),
			(error) => error.code === 'UNSUPPORTED_AUP4_VERSION',
		);
	}
});

test('retains unknown tables and their opaque data while downgrading the project', async () => {
	const database = new SQL.Database(await createAup4Fixture({ SQL }));
	let source;
	try {
		database.run('CREATE TABLE extension_data (name TEXT, payload BLOB)');
		database.run('INSERT INTO extension_data VALUES (?, ?)', ['third-party', Uint8Array.of(0, 1, 128, 255)]);
		source = database.export();
	} finally {
		database.close();
	}
	const converted = await convertAup4BytesToAup3(source, { SQL });
	assert.deepEqual(sqlRows(converted, 'SELECT * FROM extension_data'), sqlRows(source, 'SELECT * FROM extension_data'));
});

test('reads native thumbnail BLOB attributes and strips them for Audacity 3 compatibility', async () => {
	const source = await createAup4Fixture({ SQL, autosave: true, thumbnailData: [0, 16, 128, 255] });
	assert.deepEqual(projectXml(source).children.at(-1).attributes.data, Uint8Array.of(0, 16, 128, 255));
	const converted = await convertAup4BytesToAup3(source, { SQL });
	for (const table of ['project', 'autosave']) {
		const thumbnail = projectXml(converted, table).children.at(-1);
		assert.equal(thumbnail.name, 'thumbnail');
		assert.equal(thumbnail.attributes.data, undefined);
	}
	assert.deepEqual(sqlRows(converted, 'SELECT * FROM sampleblocks'), sqlRows(source, 'SELECT * FROM sampleblocks'));
	assert.deepEqual((await decodeAup4Bytes(source, { SQL })).channels, (await decodeAup3Bytes(converted, { SQL })).channels);
});

test('preserves AUP4 clip timing when clip tempo differs or tempo sync is disabled', async () => {
	for (const [clip, expectedFrames, expectedStretch] of [
		[{ stretchRatio: 1.5, rawAudioTempo: 60, clipTempo: 90 }, 4, 2],
		[{ stretchRatio: 1.5, rawAudioTempo: 60, clipStretchToMatchTempo: false }, 6, 3],
		[{ rawAudioTempo: 60, clipStretchToMatchTempo: false }, 4, 2],
	]) {
		const source = await createAup4Fixture({
			SQL, projectTempo: 120,
			tracks: [{ clips: [{ samples: [0.25, -0.5, 0.75, 0], ...clip }] }],
		});
		const original = await decodeAup4Bytes(source, { SQL });
		assert.equal(original.channels[0].length, expectedFrames);
		const converted = await convertAup4BytesToAup3(source, { SQL });
		const after = await decodeAup3Bytes(converted, { SQL });
		assert.equal(projectXml(converted).children[0].children[0].attributes.clipStretchRatio, expectedStretch);
		assert.equal(after.channels[0].length, expectedFrames);
		assert.deepEqual(after.channels, original.channels);
	}
});

test('downgrades UTF-16 and UTF-32 XML while preserving raw records and local name scopes', () => {
	for (const charSize of [2, 4]) {
		const names = ['project', 'version', 'waveclip', 'rawAudioTempo', 'clipStretchToMatchTempo', 'time_signature_tempo', 'thumbnail', 'data'];
		const dictionary = Uint8Array.from([
			0, charSize,
			...names.flatMap((name, index) => [15, ...littleEndian(index + 1, 2), ...littleEndian(encodedText(name, charSize).length, 2), ...encodedText(name, charSize)]),
		]);
		const raw = new TextEncoder().encode('<?xml version="1.0"?>');
		const prefix = Uint8Array.from([12, ...littleEndian(raw.length, 4), ...raw]);
		const localName = encodedText('customNote', charSize);
		const localValue = encodedText('Unberührt öäü 🎧', charSize);
		const version = encodedText('2.0.0', charSize);
		const document = Uint8Array.from([
			...prefix, 1, ...littleEndian(1, 2),
			3, ...littleEndian(2, 2), ...littleEndian(version.length, 4), ...version,
			4, ...littleEndian(6, 2), ...littleEndian(120, 4),
			1, ...littleEndian(3, 2),
			4, ...littleEndian(4, 2), ...littleEndian(60, 4),
			5, ...littleEndian(5, 2), 0,
			13, 15, ...littleEndian(99, 2), ...littleEndian(localName.length, 2), ...localName,
			3, ...littleEndian(99, 2), ...littleEndian(localValue.length, 4), ...localValue, 14,
			2, ...littleEndian(3, 2),
			1, ...littleEndian(7, 2),
			16, ...littleEndian(8, 2), ...littleEndian(4, 4), 0, 16, 128, 255,
			2, ...littleEndian(7, 2), 2, ...littleEndian(1, 2),
		]);
		const before = document.slice();
		const rewritten = rewriteAup4ProjectForAup3(dictionary, document);
		assert.deepEqual(document, before);
		assert.deepEqual(rewritten.subarray(0, prefix.length), prefix);
		const project = parseAup3BinaryXml(dictionary, rewritten);
		assert.equal(project.attributes.version, '1.3.0');
		assert.equal(project.children[0].attributes.clipStretchRatio, 2);
		assert.equal(project.children[0].attributes.customNote, 'Unberührt öäü 🎧');
		assert.equal(project.children[0].attributes.rawAudioTempo, 60);
		assert.equal(project.children[0].attributes.clipStretchToMatchTempo, undefined);
		assert.equal(project.children[1].attributes.data, undefined);
	}
});

test('opens and downgrades a pinned native Audacity 4 project with multiple clips and tempo state', async () => {
	const source = aup4NativeRichFixture();
	assert.equal(createHash('sha256').update(source).digest('hex'), AUP4_NATIVE_RICH_SHA256);
	const before = source.slice();
	const original = await decodeAup4Bytes(source, { SQL, structured: true });
	assert.equal(original.tracks.length, 2);
	assert.equal(original.tracks.reduce((count, track) => count + track.clips.length, 0), 5);
	assert.ok(original.tracks.every((track) => track.clips.every((clip) => clip.channels[0].length > 0)));
	assert.deepEqual(sqlRows(source, 'SELECT sampleformat FROM sampleblocks'), [[0x0004000f]]);
	const converted = await convertAup4BytesToAup3(source, { SQL });
	assert.deepEqual(source, before);
	assert.deepEqual(sqlRows(converted, 'PRAGMA integrity_check'), [['ok']]);
	assert.deepEqual(sqlRows(converted, 'SELECT * FROM sampleblocks'), sqlRows(source, 'SELECT * FROM sampleblocks'));
	assert.equal(headerView(converted).getUint32(60, false), 0x03070000);
	assert.equal(projectXml(converted).attributes.version, '1.3.0');
	const decoded = await decodeAup3Bytes(converted, { SQL, structured: true });
	assert.equal(decoded.tracks.length, 2);
	for (const [trackIndex, track] of original.tracks.entries()) {
		for (const [clipIndex, clip] of track.clips.entries()) {
			const result = decoded.tracks[trackIndex].clips[clipIndex];
			assert.equal(result.startSeconds, clip.startSeconds);
			assert.equal(result.sourceStart, clip.sourceStart);
			assert.equal(result.stretch, clip.stretch);
			assert.equal(result.pitchCents, clip.pitchCents);
			assert.deepEqual(result.channels, clip.channels);
		}
	}
});

test('decodes AUP4 audio through the shared Audacity reader without modifying its header', async () => {
	const source = await createAup4Fixture({
		SQL,
		sampleRate: 48_000,
		tracks: [
			{ name: 'Left', channel: 0, linked: true, gain: 0.5, clips: [{ samples: [0, 0.5, -0.5, 1] }] },
			{ name: 'Right', channel: 1, gain: 0.5, clips: [{ samples: [1, -1, 0.25, -0.25] }] },
			{ name: 'Muted', mute: true, clips: [{ samples: [1, 1, 1, 1] }] },
		],
	});
	const before = source.slice();
	const progress = [];
	const decoded = await decodeAup4Bytes(source, {
		SQL,
		fileName: 'live.set.2.AUP4',
		onProgress: (event) => progress.push(event.progress),
	});
	assert.equal(decoded.sampleRate, 48_000);
	assert.equal(decoded.metadata.title, 'live.set.2');
	assert.equal(decoded.metadata.trackCount, 2);
	assert.deepEqual(Array.from(decoded.channels[0]), [0, 0.25, -0.25, 0.5]);
	assert.deepEqual(Array.from(decoded.channels[1]), [0.5, -0.5, 0.125, -0.125]);
	assert.deepEqual(decoded.warnings, []);
	assert.equal(progress.at(-1), 1);
	assert.deepEqual(source, before);

	const file = new Blob([source]);
	Object.defineProperty(file, 'name', { value: 'live.set.2.AUP4' });
	const fromFile = await decodeAup4File(file, { SQL });
	assert.equal(fromFile.metadata.title, 'live.set.2');
	assert.deepEqual(fromFile.channels, decoded.channels);
});

test('AUP4 decoding retains the shared reader’s missing-block and memory-limit safeguards', async () => {
	const missing = await createAup4Fixture({
		SQL,
		tracks: [{ clips: [{ samples: [0.5], missingBlock: true }] }],
	});
	await assert.rejects(
		decodeAup4Bytes(missing, { SQL }),
		(error) => error.code === 'MISSING_SAMPLE_BLOCK',
	);
	const source = await createAup4Fixture({ SQL });
	await assert.rejects(
		decodeAup4Bytes(source, { SQL, memoryLimits: { databaseBytes: source.byteLength - 1 } }),
		(error) => error.code === 'PROJECT_TOO_LARGE',
	);
	let read = false;
	await assert.rejects(
		decodeAup4File({ size: source.byteLength, arrayBuffer() { read = true; return source.buffer; } }, {
			SQL,
			memoryLimits: { databaseBytes: source.byteLength - 1 },
		}),
		(error) => error.code === 'PROJECT_TOO_LARGE',
	);
	assert.equal(read, false);
	await assert.rejects(
		convertAup4FileToAup3({ size: source.byteLength, arrayBuffer() { read = true; return source.buffer; } }, {
			SQL,
			memoryLimits: { databaseBytes: source.byteLength - 1 },
		}),
		(error) => error.code === 'PROJECT_TOO_LARGE',
	);
	assert.equal(read, false);
});

test('cancellation rejects file conversion before reading the project', async () => {
	const controller = new AbortController();
	controller.abort();
	let read = false;
	await assert.rejects(
		convertAup4FileToAup3({ size: 1, arrayBuffer() { read = true; return new ArrayBuffer(1); } }, {
			SQL, signal: controller.signal,
		}),
		(error) => error.code === 'ABORTED',
	);
	assert.equal(read, false);
});

test('recognizes AUP4 filenames and preserves all but the final suffix in output names', () => {
	assert.equal(isAup4FileName('session.AUP4'), true);
	assert.equal(isAup4FileName('  live.set.2.aup4  '), true);
	assert.equal(isAup4FileName('session.aup3'), false);
	assert.equal(isAup4FileName('session.aup4.wav'), false);
	assert.equal(isAup4FileName(''), false);
	for (const [name, base] of [['session.AUP4', 'session'], ['  live.set.2.aup4  ', 'live.set.2'], ['', 'audacity-project']]) {
		assert.equal(aup4OutputName(name), `${base}.wav`);
		assert.equal(aup4ToAup3OutputName(name), `${base}.aup3`);
	}
});

function headerView(bytes) {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function patchHeader(source, offset, value, width = 4) {
	const bytes = source.slice();
	if (width === 2) headerView(bytes).setUint16(offset, value, false);
	else headerView(bytes).setUint32(offset, value, false);
	return bytes;
}

function sqlRows(bytes, query) {
	const database = new SQL.Database(bytes);
	try {
		return database.exec(query)[0]?.values || [];
	} finally {
		database.close();
	}
}

function projectXml(bytes, table = 'project') {
	const [dictionary, document] = sqlRows(bytes, `SELECT dict, doc FROM ${table}`)[0];
	return parseAup3BinaryXml(dictionary, document);
}

function littleEndian(value, width) {
	const bytes = new Uint8Array(width);
	const view = new DataView(bytes.buffer);
	if (width === 2) view.setUint16(0, value, true);
	else view.setUint32(0, value, true);
	return Array.from(bytes);
}

function encodedText(text, charSize) {
	const values = charSize === 2
		? Array.from({ length: text.length }, (_, index) => text.charCodeAt(index))
		: Array.from(text, (character) => character.codePointAt(0));
	return values.flatMap((value) => littleEndian(value, charSize));
}
