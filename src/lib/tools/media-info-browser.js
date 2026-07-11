import { normalizeResult } from './media-info.js';

export const MEDIAINFO_VERSION = '0.3.7';
export const MEDIAINFO_SCRIPT_URL = `https://unpkg.com/mediainfo.js@${MEDIAINFO_VERSION}/dist/umd/index.min.js`;
export const MEDIAINFO_WASM_URL = `https://unpkg.com/mediainfo.js@${MEDIAINFO_VERSION}/dist/MediaInfoModule.wasm`;

let mediaInfoPromise;
let analysisQueue = Promise.resolve();

export function getMediaInfoFactory(candidate = globalThis.MediaInfo || globalThis.mediaInfoFactory || globalThis.MediaInfoFactory) {
	if (typeof candidate === 'function') return candidate;
	if (candidate && typeof candidate.mediaInfoFactory === 'function') return candidate.mediaInfoFactory;
	if (candidate && typeof candidate.default === 'function') return candidate.default;
	return null;
}

export async function loadMediaInfo() {
	if (!mediaInfoPromise) {
		mediaInfoPromise = (async () => {
			let factory = getMediaInfoFactory();
			if (!factory) {
				await loadBrowserScript(MEDIAINFO_SCRIPT_URL);
				factory = getMediaInfoFactory();
			}
			if (!factory) throw new Error('MediaInfo factory was not found.');
			return factory({
				format: 'object',
				locateFile: (name) => name.endsWith('.wasm') ? MEDIAINFO_WASM_URL : name,
			});
		})().catch((error) => {
			mediaInfoPromise = undefined;
			throw error;
		});
	}

	return mediaInfoPromise;
}

export function analyzeMediaFile(file, mediaInfo) {
	const run = async () => {
		const analyzer = mediaInfo || await loadMediaInfo();
		const result = await analyzer.analyzeData(file.size, async (size, offset) => (
			new Uint8Array(await file.slice(offset, offset + size).arrayBuffer())
		));
		return normalizeResult(result);
	};
	const result = analysisQueue.then(run, run);
	analysisQueue = result.catch(() => undefined);
	return result;
}

export function resetMediaInfoBrowserState() {
	mediaInfoPromise = undefined;
	analysisQueue = Promise.resolve();
}

function loadBrowserScript(src) {
	if (typeof document === 'undefined') throw new Error('MediaInfo can only be loaded in a browser.');
	return new Promise((resolve, reject) => {
		const existing = document.querySelector(`script[src="${src}"]`);
		if (existing?.dataset.loaded === 'true') return resolve();
		const script = existing || document.createElement('script');
		script.src = src;
		script.async = true;
		script.addEventListener('load', () => {
			script.dataset.loaded = 'true';
			resolve();
		}, { once: true });
		script.addEventListener('error', () => reject(new Error(`MediaInfo could not be loaded from ${src}.`)), { once: true });
		if (!existing) document.head.appendChild(script);
	});
}
