import { Aup3Error, decodeAup3Database } from './aup3.js';

const SQLITE_HEADER = Uint8Array.from([
	0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
	0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);
const MAX_DATABASE_BYTES = 128 * 1024 * 1024;

let sqlJsPromise;

/**
 * Read and dry-mix an AUP3 file entirely in the browser.
 *
 * @param {{ name?: string, size?: number, arrayBuffer: () => Promise<ArrayBuffer> }} file
 * @param {{ onProgress?: Function, signal?: AbortSignal, SQL?: { Database: Function } }} [options]
 */
export async function decodeAup3File(file, options = {}) {
	if (!file || typeof file.arrayBuffer !== 'function') {
		throw new TypeError('An AUP3 file is required.');
	}
	if (Number(file.size) > MAX_DATABASE_BYTES) {
		throw new Aup3Error('This AUP3 project is too large to load safely in this browser.', 'PROJECT_TOO_LARGE');
	}
	progress(options.onProgress, 0, 'opening');
	const buffer = await file.arrayBuffer();
	if (typeof Worker === 'function' && !options.SQL) {
		return decodeInWorker(buffer, { fileName: file.name, onProgress: options.onProgress, signal: options.signal });
	}
	return decodeAup3Bytes(new Uint8Array(buffer), { ...options, fileName: file.name });
}

/**
 * Decode an in-memory AUP3 database. Tests and non-browser callers may inject
 * an initialized sql.js module through `SQL`.
 *
 * @param {ArrayBuffer | ArrayBufferView | number[]} input
 * @param {{ fileName?: string, onProgress?: Function, SQL?: { Database: Function } }} [options]
 */
export async function decodeAup3Bytes(input, options = {}) {
	const bytes = toBytes(input);
	if (bytes.byteLength > MAX_DATABASE_BYTES) {
		throw new Aup3Error('This AUP3 project is too large to load safely in this browser.', 'PROJECT_TOO_LARGE');
	}
	if (!hasSqliteHeader(bytes)) {
		throw new Aup3Error('This file is not a SQLite-based Audacity AUP3 project.', 'NOT_AUP3');
	}
	const SQL = options.SQL || await loadSqlJs();
	let database;
	try {
		database = new SQL.Database(bytes);
	} catch (error) {
		throw new Aup3Error('The AUP3 project database could not be opened.', 'INVALID_DATABASE', { cause: error });
	}
	try {
		return await decodeAup3Database(database, {
			fileName: options.fileName,
			onProgress: options.onProgress,
		});
	} finally {
		database.close();
	}
}

export function isAup3FileName(name) {
	return /\.aup3$/i.test(String(name || '').trim());
}

export function aup3OutputName(name) {
	const base = String(name || '').trim().replace(/\.aup3$/i, '') || 'audacity-project';
	return `${base}.wav`;
}

async function loadSqlJs() {
	if (!sqlJsPromise) {
		sqlJsPromise = Promise.all([
			import('sql.js'),
			import('sql.js/dist/sql-wasm-browser.wasm?url'),
		]).then(([module, wasm]) => module.default({ locateFile: () => wasm.default }));
	}
	try {
		return await sqlJsPromise;
	} catch (error) {
		sqlJsPromise = undefined;
		throw error;
	}
}

function decodeInWorker(buffer, { fileName, onProgress, signal }) {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./aup3-worker.js', import.meta.url), { type: 'module' });
		let settled = false;
		const finish = (callback, value) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener('abort', abort);
			worker.terminate();
			callback(value);
		};
		const abort = () => finish(reject, new Aup3Error('The AUP3 conversion was cancelled.', 'ABORTED'));
		worker.onmessage = (event) => {
			if (event.data?.type === 'progress') {
				progress(onProgress, event.data.progress, event.data.phase);
				return;
			}
			if (event.data?.type === 'result') {
				finish(resolve, {
					...event.data.result,
					channels: event.data.result.channels.map((channel) => new Float32Array(channel)),
				});
				return;
			}
			if (event.data?.type === 'error') {
				finish(reject, new Aup3Error(event.data.message || 'The AUP3 project could not be decoded.', event.data.code));
			}
		};
		worker.onerror = (event) => finish(reject, new Aup3Error(event.message || 'The AUP3 decoder worker failed.', 'WORKER_ERROR'));
		if (signal?.aborted) {
			abort();
			return;
		}
		signal?.addEventListener('abort', abort, { once: true });
		worker.postMessage({ type: 'decode', buffer, fileName }, [buffer]);
	});
}

function hasSqliteHeader(bytes) {
	if (bytes.byteLength < SQLITE_HEADER.length) return false;
	return SQLITE_HEADER.every((value, index) => bytes[index] === value);
}

function toBytes(value) {
	if (value instanceof Uint8Array) return value;
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Array.isArray(value)) return Uint8Array.from(value);
	throw new TypeError('Binary AUP3 data is required.');
}

function progress(callback, value, phase) {
	if (typeof callback === 'function') callback({ progress: value, phase });
}
