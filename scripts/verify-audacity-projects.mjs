#!/usr/bin/env node
// Optional native compatibility check. Start Audacity 3 with mod-script-pipe
// enabled before running this script; ordinary Node/Playwright tests do not
// require Audacity, an X server, or its scripting module.
import assert from 'node:assert/strict';
import { closeSync, constants, openSync, readSync, writeSync } from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { decodeAup3Bytes } from '../src/lib/tools/aup3-browser.js';
import { convertAup4BytesToAup3 } from '../src/lib/tools/aup4.js';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputs = process.argv.slice(2);
const sources = inputs.length ? inputs.map((value) => path.resolve(value)) : [
	path.join(repository, 'tests/fixtures/audacity-3.7.9-stereo-tones.aup3'),
	path.join(repository, 'tests/fixtures/audacity-4.0.1-stereo-tones.aup4'),
];
const output = await mkdtemp(path.join(os.tmpdir(), 'kw-audacity-native-check-'));
const pipeDirectory = process.env.AUDACITY_PIPE_DIR || os.tmpdir();
const pipeSuffix = process.env.AUDACITY_PIPE_SUFFIX || process.getuid?.();
const pipeFlags = constants.O_RDWR | constants.O_NONBLOCK;
let toPipe;
let fromPipe;
let openedProjects = 0;

try {
	toPipe = openSync(path.join(pipeDirectory, `audacity_script_pipe.to.${pipeSuffix}`), pipeFlags);
	fromPipe = openSync(path.join(pipeDirectory, `audacity_script_pipe.from.${pipeSuffix}`), pipeFlags);
	const SQL = await initSqlJs();
	for (const [index, source] of sources.entries()) {
		const bytes = await readFile(source);
		const converted = source.toLowerCase().endsWith('.aup4') ? await convertAup4BytesToAup3(bytes, { SQL }) : bytes;
		const expected = await decodeAup3Bytes(converted, { SQL });
		const projectPath = path.join(output, `${index}-${path.parse(source).name}.aup3`);
		const wavPath = path.join(output, `${index}-${path.parse(source).name}.wav`);
		await writeFile(projectPath, converted);
		// Keep any existing project window alive, and give each input its own
		// empty window. Closing the last window can tear down the native command
		// handler while the pipe thread is preparing the next OpenProject2.
		await command('New:');
		openedProjects += 1;
		await command(`OpenProject2: Filename=${JSON.stringify(projectPath)}`);
		const tracks = await command('GetInfo: Type=Tracks');
		const clips = await command('GetInfo: Type=Clips');
		assert.ok(parseInfo(clips).length > 0, 'Audacity must load real audio clips.');
		await command('SelectAll:');
		await command(`SelectTime: Start=0 End=${expected.metadata.durationSeconds}`);
		await command(`Export2: Filename=${JSON.stringify(wavPath)} NumChannels=${expected.channels.length}`);
		const actual = readWav(await readFile(wavPath));
		assert.equal(actual.sampleRate, expected.sampleRate);
		assert.equal(actual.channels.length, expected.channels.length);
		let maximumError = 0;
		for (const [channel, samples] of actual.channels.entries()) {
			assert.equal(samples.length, expected.channels[channel].length);
			for (let frame = 0; frame < samples.length; frame += 1) maximumError = Math.max(maximumError, Math.abs(samples[frame] - expected.channels[channel][frame]));
		}
		// Native PCM16 export may apply noise-shaped dither to float source blocks.
		assert.ok(maximumError <= 12 / 32768, `Native export differs by ${maximumError}.`);
		const evidence = { source, projectPath, wavPath, sampleRate: actual.sampleRate, channels: actual.channels.length, frames: actual.channels[0].length, maximumError, tracks: parseInfo(tracks), clips: parseInfo(clips) };
		await writeFile(path.join(output, `${index}-evidence.json`), `${JSON.stringify(evidence, null, '\t')}\n`);
		console.log(`${path.basename(source)}: native reopen/export passed (${actual.channels.length} channels, ${actual.channels[0].length} frames, maximum sample error ${maximumError}).`);
	}
	console.log(`Native WAV files and evidence: ${output}`);
} finally {
	// Audacity 3.7.9 can retain a stale scripting command context immediately
	// after a project is closed. Finish all opens/exports before closing them.
	try {
		while (openedProjects > 0) {
			await command('Close:');
			openedProjects -= 1;
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	} finally {
		if (toPipe != null) closeSync(toPipe);
		if (fromPipe != null) closeSync(fromPipe);
	}
}

async function command(value) {
	writeSync(toPipe, `${value}\n`);
	const buffer = Buffer.alloc(64 * 1024);
	let response = '';
	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const count = readSync(fromPipe, buffer);
			if (count) response += buffer.toString('utf8', 0, count);
		} catch (error) {
			if (error.code !== 'EAGAIN') throw error;
		}
		if (response.includes('BatchCommand finished:')) {
			assert.ok(response.includes('BatchCommand finished: OK'), `${value}: ${response}`);
			return response;
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Audacity did not answer ${value}. Start Audacity 3 with mod-script-pipe enabled and dismiss any startup dialogs. Evidence directory: ${output}`);
}

function parseInfo(value) {
	return JSON.parse(value.slice(value.indexOf('['), value.lastIndexOf(']') + 1));
}

function readWav(bytes) {
	assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
	assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
	let format;
	let data;
	for (let offset = 12; offset + 8 <= bytes.length;) {
		const name = bytes.toString('ascii', offset, offset + 4);
		const length = bytes.readUInt32LE(offset + 4);
		const chunk = bytes.subarray(offset + 8, offset + 8 + length);
		if (name === 'fmt ') format = chunk;
		if (name === 'data') data = chunk;
		offset += 8 + length + (length & 1);
	}
	assert.ok(format && data, 'The native export must contain WAV format and audio chunks.');
	assert.equal(format.readUInt16LE(0), 1);
	assert.equal(format.readUInt16LE(14), 16);
	const channelCount = format.readUInt16LE(2);
	const frames = data.length / (channelCount * 2);
	const channels = Array.from({ length: channelCount }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) => data.readInt16LE((frame * channelCount + channel) * 2) / 32768));
	return { channels, sampleRate: format.readUInt32LE(4) };
}
