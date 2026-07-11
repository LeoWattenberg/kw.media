let runtime = null;
let runtimePromise = null;
let loadedModelUrl = '';
let activeLog = () => {};

self.addEventListener('message', (event) => {
	if (event.data?.type !== 'transcribe') return;
	void transcribe(event.data);
});

async function transcribe({ id, audio, language, translate, runtimeUrl, pthreadWorkerUrl, modelUrl, modelSize }) {
	try {
		activeLog = (line) => {
			self.postMessage({ type: 'log', id, line: String(line) });
		};
		const whisper = await loadRuntime(runtimeUrl, pthreadWorkerUrl);
		await loadModel(whisper, modelUrl, modelSize, id);
		self.postMessage({ type: 'phase', id, phase: 'transcribing' });
		const code = whisper.full_default(audio, language, Boolean(translate));
		if (code !== 0) throw new Error(`whisper.cpp exited with code ${code}`);
		self.postMessage({ type: 'result', id, lines: currentLogs });
	} catch (error) {
		self.postMessage({ type: 'error', id, message: error?.message || String(error) });
	} finally {
		activeLog = () => {};
		currentLogs = [];
	}
}

let currentLogs = [];

async function loadRuntime(runtimeUrl, pthreadWorkerUrl) {
	if (runtime) return runtime;
	if (!runtimePromise) {
		runtimePromise = (async () => {
			const [runtimeResponse, workerResponse] = await Promise.all([
				fetch(runtimeUrl, { mode: 'cors' }),
				fetch(pthreadWorkerUrl, { mode: 'cors' }),
			]);
			if (!runtimeResponse.ok || !workerResponse.ok) throw new Error('The whisper.cpp runtime could not be loaded.');
			const [runtimeSource, workerSource] = await Promise.all([runtimeResponse.text(), workerResponse.text()]);
			const runtimeBlob = new Blob([runtimeSource], { type: 'text/javascript' });
			const scriptUrl = URL.createObjectURL(runtimeBlob);
			const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
			try {
				self.importScripts(scriptUrl);
			} finally {
				URL.revokeObjectURL(scriptUrl);
			}
			if (typeof self.whisper_factory !== 'function') throw new Error('The whisper.cpp factory is unavailable.');
			runtime = await self.whisper_factory({
				print: (line) => { currentLogs.push(String(line)); activeLog(line); },
				printErr: (line) => { currentLogs.push(String(line)); activeLog(line); },
				locateFile: (name) => name === 'libwhisper.worker.js' ? workerUrl : name,
				mainScriptUrlOrBlob: runtimeBlob,
			});
			return runtime;
		})().catch((error) => {
			runtimePromise = null;
			throw error;
		});
	}
	return runtimePromise;
}

async function loadModel(whisper, modelUrl, modelSize, id) {
	if (loadedModelUrl === modelUrl) return;
	const cache = 'caches' in self ? await caches.open('kwm-whisper-models-v2') : null;
	let response = cache ? await cache.match(modelUrl) : null;
	const cached = Boolean(response);
	if (!response) {
		response = await fetch(modelUrl, { mode: 'cors' });
		if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
		if (cache) void cache.put(modelUrl, response.clone()).catch(() => {});
	}
	const total = Number(response.headers.get('content-length')) || modelSize;
	const bytes = await readBytes(response, (received) => self.postMessage({ type: 'progress', id, received, total, cached }));
	whisper.FS_createDataFile('/', 'whisper.bin', bytes, true, true);
	if (!whisper.init('whisper.bin')) throw new Error('The Whisper model could not be initialized.');
	loadedModelUrl = modelUrl;
}

async function readBytes(response, onProgress) {
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		onProgress(bytes.length);
		return bytes;
	}
	const reader = response.body.getReader();
	const chunks = [];
	let received = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		onProgress(received);
	}
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}
