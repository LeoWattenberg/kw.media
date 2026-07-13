import test from 'node:test';
import assert from 'node:assert/strict';

import {
	buildProjectGraph,
	createAudioEditorEngine,
	getProjectDurationFrames,
} from '../src/lib/tools/audio-editor/engine.js';
import { createRecordingController } from '../src/lib/tools/audio-editor/recording.js';
import { StreamingRecorderProcessor } from '../src/lib/tools/audio-editor/recording-worklet.js';
import { RenderCaptureProcessor } from '../src/lib/tools/audio-editor/render-capture-worklet.js';
import { DynamicsProcessor } from '../src/lib/tools/audio-editor/dynamics-worklet.js';
import { createStreamingLinearResampler } from '../src/lib/tools/audio-editor/resample.js';
import { createProjectStore } from '../src/lib/tools/audio-editor/storage.js';
import { createWavStreamEncoder, encodeWav } from '../src/lib/tools/audio-editor/wav.js';

function concatenateFloat32(parts) {
	const output = new Float32Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

test('WAV encoder writes valid PCM and float headers and supports chunk emission', async () => {
	const pcm = encodeWav([Float32Array.from([-1, 0, 1])], {
		sampleRate: 48000,
		bitDepth: 16,
		dither: false,
	});
	const view = new DataView(pcm.buffer);
	assert.equal(textAt(pcm, 0, 4), 'RIFF');
	assert.equal(textAt(pcm, 8, 4), 'WAVE');
	assert.equal(view.getUint16(20, true), 1);
	assert.equal(view.getUint16(22, true), 1);
	assert.equal(view.getUint32(24, true), 48000);
	assert.equal(view.getUint16(34, true), 16);
	assert.equal(view.getUint32(40, true), 6);
	assert.equal(view.getInt16(44, true), -32768);
	assert.equal(view.getInt16(46, true), 0);
	assert.equal(view.getInt16(48, true), 32767);

	const floating = encodeWav([Float32Array.of(0.25, 1.25)], { float: true, dither: false });
	assert.equal(new DataView(floating.buffer).getUint16(20, true), 3);
	assert.equal(new DataView(floating.buffer).getFloat32(44, true), 0.25);
	assert.equal(new DataView(floating.buffer).getFloat32(48, true), 1.25);

});

test('streaming WAV encoder returns metadata without retaining PCM chunks', async () => {
	const emitted = [];
	const encoder = createWavStreamEncoder({
		totalFrames: 3,
		channelCount: 2,
		bitDepth: 24,
		dither: false,
		onChunk: (chunk, info) => emitted.push({ bytes: chunk.byteLength, ...info }),
	});
	encoder.write([Float32Array.of(0, 0), Float32Array.of(0, 0)]);
	encoder.write([Float32Array.of(0), Float32Array.of(0)]);
	const result = encoder.finalize();
	await encoder.settled();
	assert.equal(result.byteLength, 62);
	assert.equal(result.frames, 3);
	assert.deepEqual(emitted.map((entry) => entry.bytes), [44, 12, 6]);
	assert.deepEqual(emitted.map((entry) => entry.frameOffset), [0, 0, 2]);
	assert.throws(() => encoder.write([Float32Array.of(0), Float32Array.of(0)]), /finalized/);
});

test('streaming resampler is chunk-stable and pads requested tails with silence', () => {
	const input = Float32Array.from({ length: 480 }, (_, index) => Math.sin(index / 17));
	const oneShot = createStreamingLinearResampler(48_000, 44_100, 1);
	const oneShotParts = [oneShot.push([input])[0], oneShot.finish(500)[0]];
	const chunked = createStreamingLinearResampler(48_000, 44_100, 1);
	const chunkedParts = [
		chunked.push([input.subarray(0, 137)])[0],
		chunked.push([input.subarray(137, 391)])[0],
		chunked.push([input.subarray(391)])[0],
		chunked.finish(500)[0],
	];
	const expected = concatenateFloat32(oneShotParts);
	const actual = concatenateFloat32(chunkedParts);
	assert.equal(actual.length, 500);
	assert.deepEqual(actual, expected);
	assert.equal(actual.at(-1), 0);
	assert.equal(actual.at(-20), 0);
});

test('memory project store retains revisions and streams immutable source chunks', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `test-${Date.now()}-${Math.random()}` });
	assert.equal(store.backend, 'memory');
	await store.saveProject({ id: 'project-1', title: 'First', revision: 1, updatedAt: '2026-01-01' });
	await store.saveProject({ id: 'project-1', title: 'Second', revision: 2, updatedAt: '2026-01-02' });
	assert.equal((await store.loadProject('project-1')).title, 'Second');
	assert.equal((await store.loadProject('project-1', { revision: 1 })).title, 'First');
	assert.deepEqual((await store.listProjectRevisions('project-1')).map((entry) => entry.revision), [2, 1]);

	await store.saveSetting('monitor', false);
	await store.saveAnalysis('mix:1', { lufs: -14 });
	assert.equal(await store.loadSetting('monitor', true), false);
	assert.deepEqual(await store.loadAnalysis('mix:1'), { lufs: -14 });

	const writer = await store.beginSourceWrite('source-1', { sampleRate: 48000 });
	await writer.write([Float32Array.of(0, 0.5), Float32Array.of(1, -1)]);
	await writer.write([Float32Array.of(0.25), Float32Array.of(-0.25)]);
	const metadata = await writer.commit({ name: 'take.wav' });
	assert.equal(metadata.storage, 'indexeddb-chunks');
	assert.equal(metadata.frameLength, 3);
	assert.equal(metadata.channelCount, 2);
	const chunks = [];
	for await (const chunk of store.readSourceChunks('source-1')) chunks.push(chunk);
	assert.deepEqual(chunks.map((chunk) => chunk.frames), [2, 1]);
	assert.deepEqual([...chunks[0].channels[1]], [1, -1]);
	assert.deepEqual((await store.listSources()).map((source) => source.id), ['source-1']);
	const restored = await store.loadSourceAudioBuffer('source-1', {
		createBuffer: (channelCount, frameCount, sampleRate) => new MockAudioBuffer(channelCount, frameCount, sampleRate),
	});
	assert.deepEqual([...restored.getChannelData(0)], [0, 0.5, 0.25]);

	const abandoned = await store.beginSourceWrite('source-2');
	await abandoned.write([Float32Array.of(1)]);
	await abandoned.abort();
	assert.equal(await store.getSourceMetadata('source-2'), null);

	const copy = await store.duplicateProject('project-1', { id: 'project-2', title: 'Copy' });
	assert.equal(copy.id, 'project-2');
	assert.equal((await store.listProjects()).length, 2);
	await store.deleteSource('source-1');
	await assert.rejects(async () => {
		for await (const _chunk of store.readSourceChunks('source-1')) { /* consume */ }
	}, /could not be found/);
	await store.clear();
	assert.deepEqual(await store.listProjects(), []);
});

test('project store bounds durable manifest revisions while retaining recovery history', async () => {
	const store = createProjectStore({ indexedDB: null, databaseName: `revision-limit-${Date.now()}-${Math.random()}`, revisionLimit: 4 });
	for (let revision = 0; revision < 7; revision += 1) {
		await store.saveProject({ id: 'bounded', revision, updatedAt: `2026-01-${String(revision + 1).padStart(2, '0')}` });
	}
	assert.deepEqual((await store.listProjectRevisions('bounded')).map((entry) => entry.revision), [6, 5, 4, 3]);
});

test('source pruning preserves live history and retained revisions before removing metadata, peaks, and chunks', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `source-retention-${Date.now()}-${Math.random()}`,
		revisionLimit: 2,
	});
	const sourceIds = ['original', 'effect-1', 'effect-2', 'abandoned'];
	for (const sourceId of sourceIds) {
		const writer = await store.beginSourceWrite(sourceId, { sampleRate: 48_000, name: `${sourceId}.wav` });
		await writer.write([Float32Array.of(0.1, 0.2)]);
		await writer.commit();
		await store.saveAnalysis(`audio-editor-peaks-v1:${sourceId}`, { levels: [sourceId] });
	}
	const project = (revision, sourceId, extraSources = []) => ({
		id: 'retained-project',
		revision,
		updatedAt: `2026-07-13T00:00:0${revision}.000Z`,
		sources: [sourceId, ...extraSources].map((id) => ({ id, frameCount: 2, channelCount: 1 })),
		clips: [{ id: `clip-${revision}`, sourceId }],
	});
	const pruneNow = Date.now() + 2 * 24 * 60 * 60 * 1000;

	await store.saveProject(project(1, 'original', ['abandoned']));
	await store.saveProject(project(2, 'effect-1'));
	assert.equal((await store.getSourceMetadata('original')).pendingProjectUntil, undefined);
	assert.equal((await store.getSourceMetadata('effect-1')).pendingProjectUntil, undefined);
	assert.equal(typeof (await store.getSourceMetadata('effect-2')).pendingProjectUntil, 'string');
	let result = await store.pruneUnreferencedSources({
		protectedProjects: [project(3, 'effect-2')],
		minimumAgeMs: 0,
		now: pruneNow,
	});
	assert.deepEqual(result.deletedSourceIds, ['abandoned']);
	assert.equal(await store.getSourceMetadata('original') != null, true);
	assert.equal(await store.getSourceMetadata('effect-1') != null, true);
	assert.equal(await store.getSourceMetadata('effect-2') != null, true);
	assert.equal(await store.getSourceMetadata('abandoned'), null);
	assert.equal(await store.loadAnalysis('audio-editor-peaks-v1:abandoned'), null);
	assert.deepEqual((await store.loadProject('retained-project', { revision: 1 })).sources.map((source) => source.id), ['original']);

	await store.saveProject(project(3, 'effect-2'));
	assert.deepEqual((await store.listProjectRevisions('retained-project')).map((entry) => entry.revision), [3, 2]);
	result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: pruneNow });
	assert.deepEqual(result.deletedSourceIds, ['original']);
	assert.equal(await store.getSourceMetadata('original'), null);
	assert.equal(await store.loadAnalysis('audio-editor-peaks-v1:original'), null);
	await assert.rejects(async () => {
		for await (const _chunk of store.readSourceChunks('original')) { /* consume */ }
	}, /could not be found/);
	const retainedRevision = await store.loadProject('retained-project', { revision: 2 });
	assert.deepEqual(retainedRevision.sources.map((source) => source.id), ['effect-1']);
	const retainedAudio = await store.loadSourceAudioBuffer('effect-1', {
		createBuffer: (channelCount, frameCount, sampleRate) => new MockAudioBuffer(channelCount, frameCount, sampleRate),
	});
	assert.equal(retainedAudio.length, 2);

	await store.saveProject(project(4, 'effect-2'));
	result = await store.pruneUnreferencedSources({ minimumAgeMs: 0, now: pruneNow });
	assert.deepEqual(result.deletedSourceIds, ['effect-1']);
	assert.equal(await store.getSourceMetadata('effect-1'), null);
	assert.equal(await store.getSourceMetadata('effect-2') != null, true);
	assert.deepEqual((await store.loadProject('retained-project', { revision: 3 })).sources.map((source) => source.id), ['effect-2']);
});

test('source pruning durably protects unpublished sources and reports when abandoned writes become eligible', async () => {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: `source-grace-${Date.now()}-${Math.random()}`,
	});
	const writer = await store.beginSourceWrite('fresh-orphan', { sampleRate: 48_000 });
	await writer.write([Float32Array.of(0.25)]);
	const metadata = await writer.commit();
	const pendingProjectUntil = Date.parse(metadata.pendingProjectUntil);
	let result = await store.pruneUnreferencedSources({ minimumAgeMs: 5_000, now: pendingProjectUntil - 1 });
	assert.deepEqual(result.deletedSourceIds, []);
	assert.deepEqual(result.deferredSourceIds, ['fresh-orphan']);
	assert.equal(result.nextEligibleAt, pendingProjectUntil);
	assert.equal(await store.getSourceMetadata('fresh-orphan') != null, true);

	result = await store.pruneUnreferencedSources({ minimumAgeMs: 5_000, now: pendingProjectUntil });
	assert.deepEqual(result.deletedSourceIds, ['fresh-orphan']);
	assert.equal(result.nextEligibleAt, null);
	assert.equal(await store.getSourceMetadata('fresh-orphan'), null);
});

test('project store prefers OPFS for bounded source writes when it is available', async () => {
	const files = new Map();
	const sourceDirectory = {
		async getFileHandle(path, options = {}) {
			if (!files.has(path) && !options.create) throw new Error('missing');
			if (!files.has(path)) files.set(path, { blob: new Blob() });
			const entry = files.get(path);
			return {
				async createWritable() {
					const parts = [];
					return {
						async write(part) { parts.push(part); },
						async close() { entry.blob = new Blob(parts); },
						async abort() { parts.length = 0; },
					};
				},
				async getFile() { return entry.blob; },
			};
		},
		async removeEntry(path) {
			if (!files.delete(path)) throw new Error('missing');
		},
	};
	const root = { async getDirectoryHandle() { return sourceDirectory; } };
	const store = createProjectStore({
		indexedDB: null,
		databaseName: `opfs-${Date.now()}-${Math.random()}`,
		storageManager: { async getDirectory() { return root; } },
	});
	const writer = await store.beginSourceWrite('opfs-source', { sampleRate: 48000 });
	await writer.write([Float32Array.of(0.1, 0.2)]);
	await writer.write([Float32Array.of(0.3)]);
	const metadata = await writer.commit();
	assert.equal(metadata.storage, 'opfs');
	assert.equal(files.size, 1);
	const chunks = [];
	for await (const chunk of store.readSourceChunks('opfs-source')) chunks.push([...chunk.channels[0]]);
	assert.ok(Math.abs(chunks[0][0] - 0.1) < 1e-6);
	assert.ok(Math.abs(chunks[1][0] - 0.3) < 1e-6);
	await store.deleteSource('opfs-source');
	assert.equal(files.size, 0);
});

test('project store writes AudioBuffers in bounded source chunks', async () => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `buffer-${Date.now()}-${Math.random()}` });
	const buffer = new MockAudioBuffer(1, 5, 48000);
	buffer.getChannelData(0).set([1, 2, 3, 4, 5]);
	const metadata = await store.writeAudioBuffer('buffer-source', buffer, { name: 'buffer' }, { chunkFrames: 2 });
	assert.equal(metadata.chunkCount, 3);
	const frames = [];
	for await (const chunk of store.readSourceChunks('buffer-source')) frames.push(chunk.frames);
	assert.deepEqual(frames, [2, 2, 1]);
});

test('recording worklet emits bounded transferable chunks and monitor output', () => {
	const processor = new StreamingRecorderProcessor({ processorOptions: { channelCount: 1, chunkFrames: 128, monitor: true } });
	const messages = [];
	processor.port.postMessage = (message, transfer = []) => messages.push({ message, transfer });
	processor.port.onmessage({ data: { type: 'start', startFrame: 0, stopFrame: 128 } });
	const input = Float32Array.from({ length: 128 }, (_, index) => index / 128);
	const output = new Float32Array(128);
	processor.process([[input]], [[output]]);
	assert.deepEqual(output, input);
	const chunk = messages.find((entry) => entry.message.type === 'audio-chunk');
	assert.equal(chunk.message.frames, 128);
	assert.equal(chunk.message.channels[0].length, 128);
	assert.equal(chunk.transfer.length, 1);
	assert.equal(messages.at(-1).message.type, 'stopped');
});

test('dynamics worklet gates quiet input and look-ahead limits overshoot', () => {
	const previousSampleRate = globalThis.sampleRate;
	globalThis.sampleRate = 48_000;
	try {
		const gate = new DynamicsProcessor({ processorOptions: { type: 'gate', params: { threshold: -20, attack: 0, hold: 0, release: 0, rangeDb: -80 } } });
		const gated = [new Float32Array(8)];
		gate.process([[Float32Array.of(0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001, 0.001)]], [gated]);
		assert.ok(Math.max(...gated[0].map(Math.abs)) < 0.00001);

		const limiter = new DynamicsProcessor({ processorOptions: { type: 'limiter', params: { ceiling: -6, lookahead: 0.001, release: 0.05 } } });
		const input = new Float32Array(128).fill(1);
		const limited = [new Float32Array(128)];
		limiter.process([[input]], [limited]);
		const ceiling = 10 ** (-6 / 20);
		assert.ok(Math.max(...limited[0].map(Math.abs)) <= ceiling + 1e-6);
		assert.ok(limited[0].slice(0, 48).every((sample) => sample === 0));
	} finally {
		if (previousSampleRate === undefined) delete globalThis.sampleRate;
		else globalThis.sampleRate = previousSampleRate;
	}
});

test('realtime render worklet emits bounded stereo chunks at the requested frame range', () => {
	const previousFrame = globalThis.currentFrame;
	globalThis.currentFrame = 0;
	try {
		const processor = new RenderCaptureProcessor({ processorOptions: { startFrame: 64, totalFrames: 160, chunkFrames: 128 } });
		const messages = [];
		processor.port.postMessage = (message, transfer = []) => messages.push({ message, transfer });
		const left = Float32Array.from({ length: 128 }, (_, index) => index / 128);
		const right = Float32Array.from({ length: 128 }, (_, index) => -index / 128);
		assert.equal(processor.process([[left, right]], [[new Float32Array(128), new Float32Array(128)]]), true);
		globalThis.currentFrame = 128;
		assert.equal(processor.process([[left, right]], [[new Float32Array(128), new Float32Array(128)]]), false);
		const chunks = messages.filter(({ message }) => message.type === 'audio-chunk');
		assert.deepEqual(chunks.map(({ message }) => message.frames), [128, 32]);
		assert.equal(chunks[0].message.channels.length, 2);
		assert.equal(chunks[0].transfer.length, 2);
		assert.equal(messages.at(-1).message.type, 'done');
		assert.equal(messages.at(-1).message.frames, 160);
	} finally {
		if (previousFrame === undefined) delete globalThis.currentFrame;
		else globalThis.currentFrame = previousFrame;
	}
});

test('recording controller serializes writes and releases microphone resources', async () => {
	const posted = [];
	const node = new MockNode();
	node.port = {
		onmessage: null,
		start() {},
		postMessage(message) { posted.push(message); },
	};
	let moduleUrl = '';
	let trackStopped = false;
	const mediaSource = new MockNode();
	const context = {
		destination: new MockNode(),
		audioWorklet: { async addModule(url) { moduleUrl = url; } },
		createMediaStreamSource() { return mediaSource; },
	};
	const stream = { getTracks: () => [{ stop() { trackStopped = true; } }] };
	const writes = [];
	const controller = await createRecordingController({
		context,
		stream,
		workletUrl: '/recorder.js',
		nodeFactory: () => node,
		onChunk: async (chunk) => writes.push([...chunk.channels[0]]),
	});
	assert.equal(moduleUrl, '/recorder.js');
	controller.start({ startFrame: 10, stopFrame: 20 });
	node.port.onmessage({ data: { type: 'audio-chunk', frameStart: 10, frames: 2, channels: [Float32Array.of(0.5, -0.5)] } });
	const stopped = controller.stop();
	node.port.onmessage({ data: { type: 'stopped', frame: 20 } });
	assert.deepEqual(await stopped, { frame: 20 });
	assert.deepEqual(writes, [[0.5, -0.5]]);
	assert.deepEqual(posted.map((message) => message.type), ['start', 'stop']);
	await controller.dispose();
	assert.equal(trackStopped, true);
	assert.equal(mediaSource.disconnected, true);
});

test('Web Audio engine schedules canonical clips, transport, reverse, loop, and offline mix', async () => {
	const realtime = new MockAudioContext();
	const offlineContexts = [];
	const project = createProject();
	const source = new MockAudioBuffer(1, 48000, 48000);
	source.getChannelData(0).set([0.1, 0.2, 0.3]);
	const states = [];
	const engine = createAudioEditorEngine({
		audioContextFactory: () => realtime,
		offlineAudioContextFactory: (options) => {
			const context = new MockOfflineAudioContext(options);
			offlineContexts.push(context);
			return context;
		},
		onState: (state) => states.push(state),
		meterInterval: 1000,
	});
	engine.loadProject(project, new Map([['source-1', source]]));
	assert.equal(getProjectDurationFrames(project), 48000);
	await engine.play();
	assert.equal(realtime.bufferSources.length, 1);
	assert.deepEqual(realtime.bufferSources[0].started, [0, 0, 1]);
	realtime.currentTime = 0.5;
	assert.equal(engine.getPositionFrames(), 24000);
	engine.pause();
	assert.equal(engine.getState().positionFrame, 24000);
	engine.seek(12000);
	engine.setLoop({ enabled: true, startFrame: 12000, endFrame: 24000 });
	await engine.play();
	assert.equal(engine.getState().state, 'playing');
	engine.stop();

	project.clips[0].reversed = true;
	const rendered = await engine.renderMix({ startFrame: 0, endFrame: 24000, includeTail: true });
	assert.equal(rendered.numberOfChannels, 2);
	assert.ok(rendered.length > 24000);
	assert.equal(offlineContexts.length, 1);
	assert.ok(Math.abs(offlineContexts[0].bufferSources[0].buffer.getChannelData(0)[47999] - 0.1) < 1e-6);
	assert.ok(offlineContexts[0].nodeKinds.includes('biquad'));
	assert.ok(offlineContexts[0].nodeKinds.includes('compressor'));
	assert.ok(offlineContexts[0].nodeKinds.includes('delay'));
	assert.ok(states.includes('playing'));
	await engine.dispose();
	assert.equal(realtime.closed, true);
});

test('project graph meters pre-mute tracks and applies master processing', () => {
	const context = new MockAudioContext();
	const graph = buildProjectGraph(context, context.destination, createProject(), { metering: true });
	assert.equal(graph.trackInputs.size, 1);
	assert.equal(graph.trackAnalysers.size, 1);
	assert.ok(graph.masterAnalyser);
	assert.ok(context.nodeKinds.includes('stereo-panner'));
	assert.ok(context.nodeKinds.includes('convolver'));

	const dryContext = new MockAudioContext();
	const dryGraph = buildProjectGraph(dryContext, dryContext.destination, createProject(), {
		metering: false,
		includeTrackPan: false,
	});
	assert.equal(dryContext.nodeKinds.includes('stereo-panner'), false);
	assert.equal(dryGraph.trackInputs.size, 1);
});

function createProject() {
	return {
		id: 'project-1',
		sampleRate: 48000,
		clips: [{
			id: 'clip-1',
			sourceId: 'source-1',
			timelineStartFrame: 0,
			sourceStartFrame: 0,
			durationFrames: 48000,
			gain: 0.8,
			fadeInFrames: 100,
			fadeOutFrames: 100,
			reversed: false,
		}],
		tracks: [{
			id: 'track-1',
			clipIds: ['clip-1'],
			gain: 1,
			pan: -0.25,
			mute: false,
			solo: false,
			effects: [
				{ type: 'highpass', params: { frequency: 80 } },
				{ type: 'compressor', params: { threshold: -20 } },
				{ type: 'delay', params: { time: 0.1, feedback: 0.2, mix: 0.1 } },
			],
		}],
		master: {
			gain: 0.9,
			effects: [{ type: 'reverb', params: { duration: 0.5, mix: 0.1 } }],
		},
	};
}

class MockParam {
	constructor(value = 0) { this.value = value; this.events = []; }
	setValueAtTime(value, time) { this.value = value; this.events.push(['set', value, time]); }
	linearRampToValueAtTime(value, time) { this.value = value; this.events.push(['ramp', value, time]); }
}

class MockNode {
	constructor(kind = 'node') { this.kind = kind; this.connections = []; this.disconnected = false; }
	connect(node) { this.connections.push(node); return node; }
	disconnect() { this.disconnected = true; this.connections = []; }
}

class MockAudioBuffer {
	constructor(numberOfChannels, length, sampleRate) {
		this.numberOfChannels = numberOfChannels;
		this.length = length;
		this.sampleRate = sampleRate;
		this.duration = length / sampleRate;
		this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
	}
	getChannelData(index) { return this.channels[index]; }
}

class MockAudioContext {
	constructor(options = {}) {
		this.sampleRate = options.sampleRate || 48000;
		this.currentTime = 0;
		this.destination = new MockNode('destination');
		this.bufferSources = [];
		this.nodeKinds = [];
		this.state = 'running';
	}
	make(kind, properties = {}) {
		const node = Object.assign(new MockNode(kind), properties);
		this.nodeKinds.push(kind);
		return node;
	}
	createGain() { return this.make('gain', { gain: new MockParam(1) }); }
	createStereoPanner() { return this.make('stereo-panner', { pan: new MockParam(0) }); }
	createBiquadFilter() { return this.make('biquad', { frequency: new MockParam(), Q: new MockParam(), gain: new MockParam() }); }
	createDynamicsCompressor() {
		return this.make('compressor', {
			threshold: new MockParam(), knee: new MockParam(), ratio: new MockParam(), attack: new MockParam(), release: new MockParam(),
		});
	}
	createDelay() { return this.make('delay', { delayTime: new MockParam() }); }
	createConvolver() { return this.make('convolver', { buffer: null }); }
	createWaveShaper() { return this.make('waveshaper', { curve: null }); }
	createAnalyser() {
		return this.make('analyser', {
			fftSize: 256,
			getFloatTimeDomainData(values) { values.fill(0.25); },
		});
	}
	createBufferSource() {
		const node = this.make('buffer-source', {
			buffer: null,
			start: (when, offset, duration) => { node.started = [when, offset, duration]; },
			stop: () => { node.stopped = true; },
		});
		this.bufferSources.push(node);
		return node;
	}
	createBuffer(channels, length, sampleRate) { return new MockAudioBuffer(channels, length, sampleRate); }
	async resume() { this.state = 'running'; }
	async close() { this.state = 'closed'; this.closed = true; }
}

class MockOfflineAudioContext extends MockAudioContext {
	constructor(options) {
		super({ sampleRate: options.sampleRate });
		this.length = options.length;
		this.numberOfChannels = options.numberOfChannels;
	}
	async startRendering() { return new MockAudioBuffer(this.numberOfChannels, this.length, this.sampleRate); }
}

function textAt(bytes, offset, length) {
	return String.fromCharCode(...bytes.slice(offset, offset + length));
}
