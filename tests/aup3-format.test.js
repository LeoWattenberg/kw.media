import assert from 'node:assert/strict';
import test from 'node:test';
import initSqlJs from 'sql.js';
import {
	decodeAup3ProjectStructure,
	parseAup3BinaryXml,
	renderAup3Project,
	rewriteAup4ProjectForAup3,
} from '../src/lib/tools/aup3.js';
import { decodeAup3Bytes } from '../src/lib/tools/aup3-browser.js';
import { decodeAup4Bytes } from '../src/lib/tools/aup4-browser.js';
import { convertAup4BytesToAup3, convertAup4FileToAup3 } from '../src/lib/tools/aup4.js';
import { createAup3Fixture } from './aup3-fixture.js';
import { createAup4Fixture } from './aup4-fixture.js';

const SQL = await initSqlJs();
const INT = 4;
const DOUBLE = 10;
const STRING = 3;
const samples = Float32Array.of(0.25, -0.5, 0.75, 0);
const loadBlock = () => ({ sampleFormat: 0x0004000f, samples: new Uint8Array(samples.buffer) });

test('keeps ordered and typed duplicate gain records and separates volume from spectrogram gain', async () => {
	for (const gains of [
		[['gain', INT, 20], ['gain', DOUBLE, 0.5]],
		[['gain', DOUBLE, 0.5], ['gain', INT, 20]],
		[['gain', INT, 20]],
	]) {
		const { dictionary, document } = encodeProject(gains);
		const project = parseAup3BinaryXml(dictionary, document);
		const track = project.children[0];
		assert.deepEqual(track.attributeRecords.filter((record) => record.name === 'gain'),
			gains.map(([name, type, value]) => ({ name, type, value })));
		const volume = gains.some(([, type]) => type === DOUBLE) ? 0.5 : 1;
		const rendered = await renderAup3Project(project, loadBlock);
		assert.deepEqual(Array.from(rendered.channels[0]), Array.from(samples, (sample) => sample * volume));
		const structured = await decodeAup3ProjectStructure(project, loadBlock);
		assert.equal(structured.tracks[0].gain, volume);
		assert.equal(structured.tracks[0].spectrogram.gain, 20);
		assert.equal(structured.tracks[0].spectrogram.range, 90);
		assert.deepEqual(structured.tracks[0].opaqueExtensions.aup3Track.attributeRecords, track.attributeRecords);
	}
});

test('AUP4 downgrade preserves every duplicate gain record and renders the actual volume', async () => {
	const xml = encodeProject([['gain', INT, 24], ['gain', DOUBLE, 0.5]]);
	const source = await replaceXml(await createAup4Fixture({ SQL, autosave: true }), xml);
	const converted = await convertAup4BytesToAup3(source, { SQL });
	for (const table of ['project', 'autosave']) {
		const before = projectXml(source, table).children[0].attributeRecords;
		const after = projectXml(converted, table).children[0].attributeRecords;
		assert.deepEqual(after, before);
	}
	assert.deepEqual(Array.from((await decodeAup4Bytes(source, { SQL })).channels[0]), [0.125, -0.25, 0.375, 0]);
	assert.deepEqual(Array.from((await decodeAup3Bytes(converted, { SQL })).channels[0]), [0.125, -0.25, 0.375, 0]);
});

test('AUP4 conversion preserves Buffer input and surrounding bytes for both embedded XML versions', async () => {
	for (const projectVersion of ['1.3.0', '2.0.0']) {
		const fixture = await createAup4Fixture({ SQL, projectVersion });
		for (const subview of [false, true]) {
			const enclosing = Buffer.alloc(fixture.length + (subview ? 19 : 0), 0xa5);
			const offset = subview ? 7 : 0;
			enclosing.set(fixture, offset);
			const source = enclosing.subarray(offset, offset + fixture.length);
			const before = Uint8Array.from(enclosing);
			const converted = await convertAup4BytesToAup3(source, { SQL });
			assert.deepEqual(Uint8Array.from(enclosing), before, `${projectVersion} ${subview ? 'subview' : 'whole buffer'} must remain unchanged`);
			assert.equal(converted.constructor, Uint8Array);
			assert.notEqual(converted.buffer, source.buffer);
			assert.equal(new DataView(converted.buffer, converted.byteOffset).getUint32(60, false), 0x03070000);
			assert.equal(projectXml(converted).attributes.version, '1.3.0');
			assert.equal(projectXml(source).attributes.version, projectVersion);
		}
	}
});

test('AUP3 and AUP4 decoders preserve Buffer subviews and their surrounding bytes', async () => {
	for (const [create, decode] of [[createAup3Fixture, decodeAup3Bytes], [createAup4Fixture, decodeAup4Bytes]]) {
		const fixture = await create({ SQL });
		const enclosing = Buffer.alloc(fixture.length + 19, 0xa5);
		enclosing.set(fixture, 7);
		const source = enclosing.subarray(7, 7 + fixture.length);
		const before = Uint8Array.from(enclosing);
		for (const structured of [false, true]) {
			const decoded = await decode(source, { SQL, structured });
			assert.equal(decoded.sampleRate, 48_000);
			assert.deepEqual(Uint8Array.from(enclosing), before);
		}
	}
});

test('decoders reject future embedded XML versions even with a currently supported SQLite header', async () => {
	for (const projectVersion of ['2.1.0', '4.0.0']) {
		const source = await createAup4Fixture({ SQL, projectVersion });
		for (const structured of [false, true]) {
			await assert.rejects(decodeAup4Bytes(source, { SQL, structured }),
				(error) => error.code === 'UNSUPPORTED_PROJECT_VERSION');
			await assert.rejects(decodeAup3Bytes(source, { SQL, structured }),
				(error) => error.code === 'UNSUPPORTED_PROJECT_VERSION');
		}
	}
});

test('downgrade reports unsupported later tempo editing once across saved and autosave documents', async () => {
	for (const clip of [
		{ stretchRatio: 1.5, rawAudioTempo: 60, clipTempo: 90 },
		{ stretchRatio: 1.5, rawAudioTempo: 60, clipStretchToMatchTempo: false },
	]) {
		const source = await createAup4Fixture({
			SQL, autosave: true, projectTempo: 120,
			tracks: [{ clips: [{ samples: Array.from(samples), ...clip }] }],
		});
		const warnings = [];
		const converted = await convertAup4BytesToAup3(source, { SQL, onWarning: (warning) => warnings.push(warning) });
		assert.deepEqual(warnings, [{ code: 'AUP4_TEMPO_EDITING_CHANGED' }]);
		const original = await decodeAup4Bytes(source, { SQL, structured: true });
		const after = await decodeAup3Bytes(converted, { SQL, structured: true });
		assert.equal(after.tracks[0].clips[0].stretch, original.tracks[0].clips[0].stretch);
		assert.equal(after.tracks[0].clips[0].startSeconds, original.tracks[0].clips[0].startSeconds);
		assert.deepEqual(after.tracks[0].clips[0].channels, original.tracks[0].clips[0].channels);
		warnings.length = 0;
		const file = await convertAup4FileToAup3(new Blob([source]), { SQL, onWarning: (warning) => warnings.push(warning) });
		assert.ok(file.size > 0);
		assert.deepEqual(warnings, [{ code: 'AUP4_TEMPO_EDITING_CHANGED' }]);
	}
});

test('project-following tempo clips retain their raw tempo and need no compatibility warning', async () => {
	const source = await createAup4Fixture({
		SQL, projectTempo: 120,
		tracks: [{ clips: [{ samples: Array.from(samples), stretchRatio: 1.5, rawAudioTempo: 60, clipTempo: 120, clipStretchToMatchTempo: true }] }],
	});
	const warnings = [];
	const converted = await convertAup4BytesToAup3(source, { SQL, onWarning: (warning) => warnings.push(warning) });
	assert.deepEqual(warnings, []);
	const project = projectXml(converted);
	const clip = project.children[0].children[0];
	assert.equal(clip.attributes.rawAudioTempo, 60);
	assert.equal(clip.attributes.clipStretchRatio, 1.5);
	project.attributes.time_signature_tempo = 240;
	const updated = await decodeAup3ProjectStructure(project, loadBlock);
	assert.equal(updated.tracks[0].clips[0].stretch, 0.375);
});

test('direct binary XML rewrite emits a tempo warning while preserving duplicate attribute order', () => {
	const xml = encodeProject([['gain', INT, 20], ['gain', DOUBLE, 0.5]], [['rawAudioTempo', DOUBLE, 60], ['clipTempo', DOUBLE, 90]]);
	const warnings = [];
	const output = rewriteAup4ProjectForAup3(xml.dictionary, xml.document, { onWarning: (warning) => warnings.push(warning) });
	assert.deepEqual(warnings, [{ code: 'AUP4_TEMPO_EDITING_CHANGED' }]);
	assert.deepEqual(parseAup3BinaryXml(xml.dictionary, output).children[0].attributeRecords,
		parseAup3BinaryXml(xml.dictionary, xml.document).children[0].attributeRecords);
});

test('direct binary XML rewriting preserves Buffer document subviews', () => {
	const xml = encodeProject([['gain', DOUBLE, 0.5]]);
	const enclosing = Buffer.alloc(xml.document.length + 19, 0xa5);
	const dictionary = Buffer.from(xml.dictionary);
	enclosing.set(xml.document, 7);
	const document = enclosing.subarray(7, 7 + xml.document.length);
	const before = Uint8Array.from(enclosing);
	const output = rewriteAup4ProjectForAup3(dictionary, document);
	assert.deepEqual(Uint8Array.from(enclosing), before);
	assert.equal(parseAup3BinaryXml(dictionary, document).attributes.version, '2.0.0');
	assert.equal(parseAup3BinaryXml(dictionary, output).attributes.version, '1.3.0');
});

function encodeProject(gainRecords, tempoRecords = []) {
	const node = (name, records, children = []) => ({ name, records, children });
	const project = node('project', [['version', STRING, '2.0.0'], ['audacityversion', STRING, '4.0.1'], ['rate', DOUBLE, 48_000], ['time_signature_tempo', DOUBLE, 120]], [
		node('wavetrack', [['name', STRING, 'Typed gains'], ['rate', DOUBLE, 48_000], ['channel', INT, 0], ['range', INT, 90], ...gainRecords], [
			node('waveclip', [['offset', DOUBLE, 0], ...tempoRecords], [
				node('sequence', [['maxsamples', INT, 1024], ['sampleformat', INT, 0x0004000f], ['numsamples', INT, samples.length]], [
					node('waveblock', [['start', INT, 0], ['blockid', INT, 1]]),
				]),
			]),
		]),
	]);
	const names = new Map();
	const collect = (node) => {
		for (const name of [node.name, ...node.records.map(([name]) => name)]) if (!names.has(name)) names.set(name, names.size + 1);
		for (const child of node.children) collect(child);
	};
	collect(project);
	const dictionary = [0, 1];
	for (const [name, id] of names) {
		const encoded = utf8(name);
		dictionary.push(15, ...integer(id, 2), ...integer(encoded.length, 2), ...encoded);
	}
	const document = [];
	const write = (node) => {
		document.push(1, ...integer(names.get(node.name), 2));
		for (const [name, type, value] of node.records) {
			document.push(type, ...integer(names.get(name), 2));
			if (type === STRING) {
				const encoded = utf8(value);
				document.push(...integer(encoded.length, 4), ...encoded);
			} else if (type === INT) document.push(...integer(value, 4));
			else if (type === DOUBLE) {
				const bytes = new Uint8Array(8);
				new DataView(bytes.buffer).setFloat64(0, value, true);
				document.push(...bytes, ...integer(8, 4));
			}
		}
		for (const child of node.children) write(child);
		document.push(2, ...integer(names.get(node.name), 2));
	};
	write(project);
	return { dictionary: Uint8Array.from(dictionary), document: Uint8Array.from(document) };
}

function integer(value, length) {
	const bytes = new Uint8Array(length);
	const view = new DataView(bytes.buffer);
	if (length === 2) view.setUint16(0, value, true);
	else view.setInt32(0, value, true);
	return Array.from(bytes);
}

function utf8(value) { return Array.from(new TextEncoder().encode(value)); }

function replaceXml(bytes, { dictionary, document }) {
	const database = new SQL.Database(bytes);
	try {
		for (const table of ['project', 'autosave']) {
			if (!database.exec(`SELECT name FROM sqlite_master WHERE name = '${table}'`).length) continue;
			database.run(`UPDATE ${table} SET dict = ?, doc = ?`, [dictionary, document]);
		}
		return database.export();
	} finally { database.close(); }
}

function projectXml(bytes, table = 'project') {
	const database = new SQL.Database(bytes);
	try {
		const [dictionary, document] = database.exec(`SELECT dict, doc FROM ${table}`)[0].values[0];
		return parseAup3BinaryXml(dictionary, document);
	} finally { database.close(); }
}
