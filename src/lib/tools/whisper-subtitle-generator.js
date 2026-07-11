import { toSrt, toVtt } from './offline-subtitle-studio.js';

export const WHISPER_RUNTIME_URL = 'https://cdn.jsdelivr.net/npm/whisper.cpp@1.0.3/whisper.js';
export const WHISPER_WORKER_URL = 'https://cdn.jsdelivr.net/npm/whisper.cpp@1.0.3/libwhisper.worker.js';
export const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base-q5_1.bin';
export const WHISPER_MODEL_SIZE = 59_707_625;

export function createWhisperTranscriber({ workerUrl, onLog = () => {}, onProgress = () => {}, onPhase = () => {} } = {}) {
	if (typeof Worker === 'undefined') throw new Error('Web Workers are not supported in this browser.');
	const worker = new Worker(workerUrl || '/whisper-transcription-worker.js');
	const pending = new Map();
	let requestId = 0;

	worker.addEventListener('message', ({ data }) => {
		if (data.type === 'log') return onLog(data.line);
		if (data.type === 'progress') return onProgress(data.received, data.total, data.cached);
		if (data.type === 'phase') return onPhase(data.phase);
		const request = pending.get(data.id);
		if (!request) return;
		pending.delete(data.id);
		if (data.type === 'error') request.reject(new Error(data.message));
		else request.resolve(data.lines);
	});
	worker.addEventListener('error', (event) => {
		const error = new Error(event.message || 'The Whisper worker stopped unexpectedly.');
		for (const request of pending.values()) request.reject(error);
		pending.clear();
	});

	return {
		transcribe(audio, language = 'auto', translate = false) {
			const id = ++requestId;
			const samples = audio instanceof Float32Array ? audio : new Float32Array(audio);
			const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
			worker.postMessage({
				type: 'transcribe', id, audio: samples, language, translate,
				runtimeUrl: WHISPER_RUNTIME_URL, pthreadWorkerUrl: WHISPER_WORKER_URL,
				modelUrl: WHISPER_MODEL_URL, modelSize: WHISPER_MODEL_SIZE,
			}, [samples.buffer]);
			return result;
		},
		dispose() {
			worker.terminate();
			for (const request of pending.values()) request.reject(new Error('The Whisper worker was disposed.'));
			pending.clear();
		},
	};
}

export async function ensureWhisperIsolation(baseUrl = '/') {
	if (!('serviceWorker' in navigator) || !globalThis.isSecureContext) return false;
	const scriptUrl = new URL(`${baseUrl}whisper-coi-serviceworker.js`, location.origin).href;
	const scope = new URL('.', location.href).href;
	const registrations = await navigator.serviceWorker.getRegistrations();
	await Promise.all(registrations
		.filter((registration) => {
			const activeScript = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL;
			return activeScript === scriptUrl && registration.scope !== scope;
		})
		.map((registration) => registration.unregister()));
	const registration = await navigator.serviceWorker.register(scriptUrl, { scope: new URL(scope).pathname });
	await waitForServiceWorker(registration);
	return globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
}

function waitForServiceWorker(registration) {
	if (registration.active) return Promise.resolve();
	const worker = registration.installing || registration.waiting;
	if (!worker) return Promise.resolve();
	return new Promise((resolve, reject) => {
		worker.addEventListener('statechange', () => {
			if (worker.state === 'activated') resolve();
			if (worker.state === 'redundant') reject(new Error('The isolation service worker could not be activated.'));
		});
	});
}

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

function parseTimestamp(value) {
	const [hours, minutes, seconds] = String(value).replace(',', '.').split(':').map(Number);
	return hours * 3600 + minutes * 60 + seconds;
}
