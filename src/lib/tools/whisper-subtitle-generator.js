import { toSrt, toVtt } from './offline-subtitle-studio.js';

export const WHISPER_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/whisper.cpp@1.0.3/whisper.js';
export const WHISPER_WORKER_URL = 'https://cdn.jsdelivr.net/npm/whisper.cpp@1.0.3/libwhisper.worker.js';
export const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-tiny.bin';
export const WHISPER_MODEL_SIZE = 77_691_713;

let runtimeAssetsPromise;

export function parseWhisperLog(lines) {
	const cues = [];
	const pattern = /\[(\d{2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[.,]\d{3})\]\s*(.+)/;

	for (const line of Array.isArray(lines) ? lines : String(lines || '').split(/\r?\n/)) {
		const match = String(line).replace(/\x1b\[[0-9;]*m/g, '').match(pattern);
		if (!match) continue;
		const text = match[3].replace(/\s+/g, ' ').trim();
		if (!text || /^\[[^\]]+\]$/.test(text)) continue;
		cues.push({ start: parseTimestamp(match[1]), end: parseTimestamp(match[2]), text });
	}

	return cues;
}

export function renderWhisperSubtitles(lines, format = 'srt') {
	const cues = parseWhisperLog(lines);
	return format === 'vtt' ? toVtt(cues) : toSrt(cues);
}

export function whisperSubtitleOutputName(sourceName, format = 'srt') {
	const base = String(sourceName || '').replace(/\.[^.]+$/, '') || 'generated-subtitles';
	return `${base}.${format === 'vtt' ? 'vtt' : 'srt'}`;
}

export function mixAndResampleAudio(channelData, sourceRate, targetRate = 16_000) {
	if (!Array.isArray(channelData) || !channelData.length || !sourceRate || !targetRate) {
		return new Float32Array();
	}

	const sourceLength = Math.min(...channelData.map((channel) => channel.length));
	const targetLength = Math.max(1, Math.floor(sourceLength * targetRate / sourceRate));
	const result = new Float32Array(targetLength);

	for (let index = 0; index < targetLength; index += 1) {
		const position = index * sourceRate / targetRate;
		const left = Math.min(sourceLength - 1, Math.floor(position));
		const right = Math.min(sourceLength - 1, left + 1);
		const fraction = position - left;
		let sample = 0;

		for (const channel of channelData) {
			sample += channel[left] + (channel[right] - channel[left]) * fraction;
		}

		result[index] = sample / channelData.length;
	}

	return result;
}

export async function decodeAudioFile(file) {
	const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
	if (!AudioContextClass) throw new Error('Web Audio is not supported in this browser.');
	const context = new AudioContextClass();

	try {
		const buffer = await context.decodeAudioData((await file.arrayBuffer()).slice(0));
		const channels = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index));
		return mixAndResampleAudio(channels, buffer.sampleRate);
	} finally {
		await context.close();
	}
}

export async function fetchWhisperModel(onProgress = () => {}) {
	const cache = 'caches' in globalThis ? await caches.open('kwm-whisper-models-v1') : null;
	let response = cache ? await cache.match(WHISPER_MODEL_URL) : null;
	const cached = Boolean(response);

	if (!response) {
		response = await fetch(WHISPER_MODEL_URL, { mode: 'cors' });
		if (!response.ok) throw new Error(`Model download failed (${response.status}).`);
		if (cache) void cache.put(WHISPER_MODEL_URL, response.clone()).catch(() => {});
	}

	const total = Number(response.headers.get('content-length')) || WHISPER_MODEL_SIZE;
	if (!response.body) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		onProgress(bytes.length, total, cached);
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
		onProgress(received, total, cached);
	}

	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

export async function createWhisperRuntime(onLog = () => {}) {
	if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
		throw new Error('The threaded whisper.cpp runtime requires cross-origin isolation.');
	}

	const assets = await loadRuntimeAssets();
	const module = await globalThis.whisper_factory({
		print: onLog,
		printErr: onLog,
		locateFile: (name) => name === 'libwhisper.worker.js' ? assets.workerUrl : name,
		mainScriptUrlOrBlob: assets.scriptBlob,
	});

	return module;
}

async function loadRuntimeAssets() {
	if (!runtimeAssetsPromise) {
		runtimeAssetsPromise = (async () => {
			const [scriptResponse, workerResponse] = await Promise.all([
				fetch(WHISPER_RUNTIME_URL, { mode: 'cors' }),
				fetch(WHISPER_WORKER_URL, { mode: 'cors' }),
			]);
			if (!scriptResponse.ok || !workerResponse.ok) throw new Error('The whisper.cpp CDN runtime could not be loaded.');

			const [scriptSource, workerSource] = await Promise.all([scriptResponse.text(), workerResponse.text()]);
			const scriptBlob = new Blob([scriptSource], { type: 'text/javascript' });
			const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));

			if (typeof globalThis.whisper_factory !== 'function') {
				const scriptUrl = URL.createObjectURL(scriptBlob);
				try {
					await loadClassicScript(scriptUrl);
				} finally {
					URL.revokeObjectURL(scriptUrl);
				}
			}

			if (typeof globalThis.whisper_factory !== 'function') throw new Error('The whisper.cpp factory is unavailable.');
			return { scriptBlob, workerUrl };
		})();
	}

	return runtimeAssetsPromise;
}

function loadClassicScript(url) {
	return new Promise((resolve, reject) => {
		const script = document.createElement('script');
		script.src = url;
		script.onload = () => { script.remove(); resolve(); };
		script.onerror = () => { script.remove(); reject(new Error('The whisper.cpp script could not be evaluated.')); };
		document.head.appendChild(script);
	});
}

function parseTimestamp(value) {
	const [hours, minutes, seconds] = String(value).replace(',', '.').split(':').map(Number);
	return hours * 3600 + minutes * 60 + seconds;
}
