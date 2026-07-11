import test from 'node:test';
import assert from 'node:assert/strict';

import {
	analyzeMediaFile,
	loadMediaInfo,
	resetMediaInfoBrowserState,
} from '../src/lib/tools/media-info-browser.js';
import {
	createWhisperTranscriber,
	decodeAudioFile,
	ensureWhisperIsolation,
} from '../src/lib/tools/whisper-subtitle-generator.js';

test('MediaInfo browser helpers load the exported factory and serialize file analysis', async () => {
	const analyzedChunks = [];
	const analyzer = {
		async analyzeData(size, readChunk) {
			analyzedChunks.push([...await readChunk(size, 0)]);
			return '{"media":{"track":[{"@type":"General"}]}}';
		},
	};
	const originalMediaInfo = globalThis.MediaInfo;
	globalThis.MediaInfo = {
		mediaInfoFactory: async (options) => {
			assert.equal(options.format, 'object');
			assert.match(options.locateFile('MediaInfoModule.wasm'), /mediainfo\.js@0\.3\.7/);
			assert.equal(options.locateFile('other.data'), 'other.data');
			return analyzer;
		},
	};

	try {
		assert.equal(await loadMediaInfo(), analyzer);
		const report = await analyzeMediaFile(new Blob([Uint8Array.of(1, 2, 3)]));
		assert.equal(report.media.track[0]['@type'], 'General');
		assert.deepEqual(analyzedChunks, [[1, 2, 3]]);
		await assert.rejects(analyzeMediaFile(new Blob(), { analyzeData: async () => { throw new Error('bad media'); } }), /bad media/);
		assert.deepEqual(await analyzeMediaFile(new Blob(), { analyzeData: async () => ({ media: { track: [] } }) }), { media: { track: [] } });
	} finally {
		setOptionalGlobal('MediaInfo', originalMediaInfo);
	}
});

test('MediaInfo loader supports script injection and reports browser loading failures', async () => {
	const originalDocument = globalThis.document;
	const originalMediaInfo = globalThis.MediaInfo;
	try {
		delete globalThis.MediaInfo;
		const listeners = {};
		globalThis.document = {
			querySelector: () => null,
			createElement: () => ({
				dataset: {},
				addEventListener: (type, listener) => { listeners[type] = listener; },
			}),
			head: {
				appendChild: () => {
					globalThis.MediaInfo = { default: async () => ({ analyzeData: async () => ({}) }) };
					queueMicrotask(listeners.load);
				},
			},
		};
		resetMediaInfoBrowserState();
		assert.equal(typeof (await loadMediaInfo()).analyzeData, 'function');

		delete globalThis.MediaInfo;
		delete globalThis.document;
		resetMediaInfoBrowserState();
		await assert.rejects(loadMediaInfo(), /only be loaded in a browser/);

		globalThis.document = {
			querySelector: () => null,
			createElement: () => ({ dataset: {}, addEventListener(type, listener) { if (type === 'error') this.fail = listener; } }),
			head: { appendChild: (script) => queueMicrotask(script.fail) },
		};
		resetMediaInfoBrowserState();
		await assert.rejects(loadMediaInfo(), /could not be loaded/);
	} finally {
		setOptionalGlobal('document', originalDocument);
		setOptionalGlobal('MediaInfo', originalMediaInfo);
	}
});

test('Whisper transcriber delegates work, progress, results, and errors to a worker', async () => {
	const originalWorker = globalThis.Worker;
	delete globalThis.Worker;
	assert.throws(() => createWhisperTranscriber(), /Web Workers/);

	class MockWorker {
		constructor(url) { this.url = url; this.listeners = {}; MockWorker.instance = this; }
		addEventListener(type, listener) { this.listeners[type] = listener; }
		postMessage(message, transfer) { this.message = message; this.transfer = transfer; }
		terminate() { this.terminated = true; }
		emit(type, data) { this.listeners[type]({ data, message: data?.message }); }
	}
	globalThis.Worker = MockWorker;
	const logs = [];
	const progress = [];
	const phases = [];

	try {
		const transcriber = createWhisperTranscriber({
			workerUrl: '/worker.js',
			onLog: (line) => logs.push(line),
			onProgress: (...values) => progress.push(values),
			onPhase: (phase) => phases.push(phase),
		});
		const first = transcriber.transcribe([0, 0.5], 'de', true);
		const { id } = MockWorker.instance.message;
		assert.equal(MockWorker.instance.url, '/worker.js');
		assert.equal(MockWorker.instance.message.audio instanceof Float32Array, true);
		assert.equal(MockWorker.instance.transfer.length, 1);
		MockWorker.instance.emit('message', { type: 'log', line: 'hello' });
		MockWorker.instance.emit('message', { type: 'progress', received: 5, total: 10, cached: false });
		MockWorker.instance.emit('message', { type: 'phase', phase: 'transcribing' });
		MockWorker.instance.emit('message', { type: 'result', id: -1, lines: [] });
		MockWorker.instance.emit('message', { type: 'result', id, lines: ['done'] });
		assert.deepEqual(await first, ['done']);
		assert.deepEqual(logs, ['hello']);
		assert.deepEqual(progress, [[5, 10, false]]);
		assert.deepEqual(phases, ['transcribing']);

		const second = transcriber.transcribe(new Float32Array([0]));
		MockWorker.instance.emit('message', { type: 'error', id: MockWorker.instance.message.id, message: 'worker failed' });
		await assert.rejects(second, /worker failed/);

		const third = transcriber.transcribe(new Float32Array([0]));
		MockWorker.instance.emit('error', { message: 'worker crashed' });
		await assert.rejects(third, /worker crashed/);
		transcriber.dispose();
		assert.equal(MockWorker.instance.terminated, true);
	} finally {
		setOptionalGlobal('Worker', originalWorker);
	}
});

test('Whisper isolation removes legacy scope and activates the current tool scope', async () => {
	const originals = snapshotGlobals(['navigator', 'location', 'isSecureContext', 'crossOriginIsolated']);
	let unregistered = false;
	let registeredScope = '';
	try {
		setOptionalGlobal('location', { origin: 'https://example.test', href: 'https://example.test/en/tools/whisper-subtitle-generator/' });
		setOptionalGlobal('isSecureContext', true);
		setOptionalGlobal('crossOriginIsolated', true);
		setOptionalGlobal('navigator', { serviceWorker: {
			getRegistrations: async () => [{
				active: { scriptURL: 'https://example.test/whisper-coi-serviceworker.js' },
				scope: 'https://example.test/',
				unregister: async () => { unregistered = true; },
			}],
			register: async (_url, { scope }) => { registeredScope = scope; return { active: {} }; },
		} });
		assert.equal(await ensureWhisperIsolation('/'), true);
		assert.equal(unregistered, true);
		assert.equal(registeredScope, '/en/tools/whisper-subtitle-generator/');

		setOptionalGlobal('crossOriginIsolated', false);
		globalThis.navigator.serviceWorker.getRegistrations = async () => [];
		globalThis.navigator.serviceWorker.register = async () => {
			const worker = { state: 'installing', addEventListener: (_type, listener) => queueMicrotask(() => { worker.state = 'activated'; listener(); }) };
			return { active: null, installing: worker };
		};
		assert.equal(await ensureWhisperIsolation('/'), false);

		setOptionalGlobal('navigator', {});
		assert.equal(await ensureWhisperIsolation('/'), false);
	} finally {
		restoreGlobals(originals);
	}
});

test('Whisper audio decoding closes its AudioContext and rejects unsupported browsers', async () => {
	const originals = snapshotGlobals(['AudioContext', 'webkitAudioContext']);
	let closed = false;
	try {
		globalThis.AudioContext = class {
			async decodeAudioData() {
				return { numberOfChannels: 1, sampleRate: 16000, getChannelData: () => Float32Array.from([0, 1]) };
			}
			async close() { closed = true; }
		};
		const decoded = await decodeAudioFile(new Blob([Uint8Array.of(1)]));
		assert.deepEqual([...decoded], [0, 1]);
		assert.equal(closed, true);
		delete globalThis.AudioContext;
		delete globalThis.webkitAudioContext;
		await assert.rejects(decodeAudioFile(new Blob()), /Web Audio/);
	} finally {
		restoreGlobals(originals);
	}
});

function setOptionalGlobal(name, value) {
	if (value === undefined) delete globalThis[name];
	else Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

function snapshotGlobals(names) {
	return Object.fromEntries(names.map((name) => [name, globalThis[name]]));
}

function restoreGlobals(values) {
	for (const [name, value] of Object.entries(values)) setOptionalGlobal(name, value);
}
