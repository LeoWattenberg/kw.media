import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import initSqlJs from 'sql.js';
import { parseAup3BinaryXml } from '../src/lib/tools/aup3.js';
import { decodeAup3Bytes } from '../src/lib/tools/aup3-browser.js';
import { convertAup4BytesToAup3 } from '../src/lib/tools/aup4.js';
import { decodeAup4Bytes } from '../src/lib/tools/aup4-browser.js';
import { createAup3Fixture } from './aup3-fixture.js';
import { createAup4Fixture } from './aup4-fixture.js';

const SQL = await initSqlJs();
const fixture = (name) => readFile(new URL(`./fixtures/${name}`, import.meta.url));

test('synthetic projects use Audacity schema, bounded sequences, and real waveform summaries', async () => {
	for (const create of [createAup3Fixture, createAup4Fixture]) {
		const bytes = await create({ SQL });
		const database = new SQL.Database(bytes);
		try {
			assert.deepEqual(database.exec('PRAGMA integrity_check')[0].values, [['ok']]);
			const columns = database.exec('PRAGMA table_info(sampleblocks)')[0].values;
			for (const name of ['summin', 'summax', 'sumrms']) assert.equal(columns.find((column) => column[1] === name)[2], 'REAL');
			const [dictionary, document] = database.exec('SELECT dict, doc FROM project')[0].values[0];
			const project = parseAup3BinaryXml(dictionary, document);
			assert.equal(project.attributes.xmlns, 'http://audacity.sourceforge.net/xml/');
			assert.ok(['1.3.0', '2.0.0'].includes(project.attributes.version));
			const track = project.children.find((node) => node.name === 'wavetrack');
			assert.equal(track.attributeRecords.find((record) => record.name === 'gain').type, 10);
			const sequence = track.children.find((node) => node.name === 'waveclip').children.find((node) => node.name === 'sequence');
			assert.ok(sequence.attributes.maxsamples >= 1024 && sequence.attributes.maxsamples <= 64 * 1024 * 1024);
			assert.equal(sequence.attributes.effectivesampleformat, sequence.attributes.sampleformat);
			assert.equal(sequence.children[0].attributes.length, 4);
			const [minimum, maximum, rms, summary256, summary64k] = database.exec('SELECT summin, summax, sumrms, summary256, summary64k FROM sampleblocks')[0].values[0];
			assert.equal(minimum, -0.5);
			assert.equal(maximum, 0.75);
			assert.equal(rms, Math.sqrt((0.25 ** 2 + 0.5 ** 2 + 0.75 ** 2) / 4));
			assert.equal(summary256.byteLength, 256 * 12);
			assert.equal(summary64k.byteLength, 12);
			for (const summary of [summary256, summary64k]) {
				const view = new DataView(summary.buffer, summary.byteOffset, summary.byteLength);
				assert.equal(view.getFloat32(0, true), minimum);
				assert.equal(view.getFloat32(4, true), maximum);
				assert.ok(Math.abs(view.getFloat32(8, true) - rms) < 1e-7);
			}
		} finally {
			database.close();
		}
	}
});

test('native Audacity 3.7.9 project renders both nonzero stereo channels and its clip gap exactly', async () => {
	const source = await fixture('audacity-3.7.9-stereo-tones.aup3');
	assert.equal(createHash('sha256').update(source).digest('hex'), '450ff25285f65132a6c3528e954b481885a1ee8312b871402039d84e50d6d2ec');
	assertTones(await decodeAup3Bytes(source, { SQL }));
	const structured = await decodeAup3Bytes(source, { SQL, structured: true });
	assert.equal(structured.tracks.length, 1);
	assert.deepEqual(structured.tracks[0].clips.map((clip) => [clip.name, clip.startSeconds, clip.endSeconds]), [
		['First tone', 0, 0.05], ['Second tone', 0.15, 0.2],
	]);
});

test('native Audacity 4.0.1 project keeps audible channels, clip timing, and sampleblocks after downgrade', async () => {
	const source = await fixture('audacity-4.0.1-stereo-tones.aup4');
	const untouched = Uint8Array.from(source);
	assert.equal(createHash('sha256').update(source).digest('hex'), '49c98a73d97b8f4b81c3b7d6d98837d44b322a6849be639badf1d6feb77f1e78');
	assertTones(await decodeAup4Bytes(source, { SQL }));
	const converted = await convertAup4BytesToAup3(source, { SQL });
	assert.deepEqual(Uint8Array.from(source), untouched, 'Converting a Node Buffer must leave its source bytes unchanged.');
	assertTones(await decodeAup3Bytes(converted, { SQL }));
	const original = new SQL.Database(source);
	const downgraded = new SQL.Database(converted);
	try {
		const [dictionary, document] = original.exec('SELECT dict, doc FROM project')[0].values[0];
		const project = parseAup3BinaryXml(dictionary, document);
		assert.equal(project.attributes.version, '2.0.0');
		assert.equal(project.attributes.audacityversion, '4.0.1');
		for (const track of project.children.filter((node) => node.name === 'wavetrack')) {
			assert.deepEqual(track.attributeRecords.filter((record) => record.name === 'gain').map(({ type, value }) => [type, value]), [[4, 20], [10, 1]]);
		}
		assert.deepEqual(downgraded.exec('PRAGMA integrity_check')[0].values, [['ok']]);
		assert.deepEqual(downgraded.exec('SELECT * FROM sampleblocks ORDER BY blockid')[0].values, original.exec('SELECT * FROM sampleblocks ORDER BY blockid')[0].values);
	} finally {
		original.close();
		downgraded.close();
	}
});

function assertTones(decoded) {
	assert.equal(decoded.sampleRate, 48_000);
	assert.equal(decoded.channels.length, 2);
	assert.equal(decoded.metadata.trackCount, 1);
	assert.equal(decoded.metadata.durationSeconds, 0.2);
	for (const [channel, samples] of decoded.channels.entries()) {
		assert.equal(samples.length, 9600);
		const frequency = channel === 0 ? 1000 : 2000;
		const amplitude = channel === 0 ? 8192 : 4096;
		for (let frame = 0; frame < samples.length; frame += 1) {
			const sourceFrame = frame < 2400 ? frame : frame >= 7200 ? frame - 4800 : -1;
			const expected = sourceFrame < 0 ? 0 : Math.round(amplitude * Math.sin(2 * Math.PI * frequency * sourceFrame / 48_000)) / 32768;
			assert.ok(Math.abs(samples[frame] - expected) < 1e-7, `channel ${channel}, frame ${frame}: ${samples[frame]} versus ${expected}`);
		}
	}
}
