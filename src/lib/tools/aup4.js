import { Aup4Error, checkAup4MemoryLimit, convertAup4BytesToAup3 } from './aup4-project.js';
import { resolveAudacityMemoryLimits } from './audacity-project-runtime.js';

export { AUP3_USER_VERSION, AUP4_USER_VERSION, Aup4Error, inspectAup4Header, convertAup4BytesToAup3 } from './aup4-project.js';

export async function convertAup4FileToAup3(file, options = {}) {
	if (!file || typeof file.arrayBuffer !== 'function') throw new TypeError('An AUP4 file is required.');
	checkAup4MemoryLimit(Number(file.size), options);
	if (options.signal?.aborted) throw new Aup4Error('The AUP4 conversion was cancelled.', 'ABORTED');
	const buffer = await file.arrayBuffer();
	const output = typeof Worker === 'function' && !options.SQL
		? await convertInWorker(buffer, options)
		: await convertAup4BytesToAup3(buffer, options);
	return new Blob([output], { type: 'application/octet-stream' });
}

export function aup4ToAup3OutputName(name) {
	const base = String(name || '').trim().replace(/\.aup4$/i, '') || 'audacity-project';
	return `${base}.aup3`;
}

function convertInWorker(buffer, options) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./aup4-worker.js', import.meta.url), { type: 'module' });
		let settled = false;
		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			options.signal?.removeEventListener('abort', abort);
			worker.terminate();
			callback(value);
		};
		const abort = () => finish(reject, new Aup4Error('The AUP4 conversion was cancelled.', 'ABORTED'));
		worker.onmessage = ({ data }) => {
			if (data?.type === 'result') finish(resolve, new Uint8Array(data.buffer));
			else if (data?.type === 'error') finish(reject, new Aup4Error(data.message, data.code));
			else if (data?.type === 'warning' && !settled) options.onWarning?.(data.warning);
		};
		worker.onerror = (event) => finish(reject, new Aup4Error(event.message || 'The AUP4 conversion worker failed.', 'WORKER_ERROR'));
		if (options.signal?.aborted) return abort();
		options.signal?.addEventListener('abort', abort, { once: true });
		worker.postMessage({ type: 'convert', buffer, memoryLimits: resolveAudacityMemoryLimits(options) }, [buffer]);
	});
}
