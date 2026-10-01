import { decodeAup3Bytes, decodeAup3File } from './aup3-browser.js';
import { Aup4Error } from './aup4.js';

/** Use the shared Audacity decoder and worker with AUP4 version validation. */
export async function decodeAup4File(file, options = {}) {
	try {
		return await decodeAup3File(file, { ...options, sourceFormat: 'aup4' });
	} catch (error) {
		throw aup4Error(error);
	}
}

export async function decodeAup4Bytes(input, options = {}) {
	try {
		return await decodeAup3Bytes(input, { ...options, sourceFormat: 'aup4' });
	} catch (error) {
		throw aup4Error(error);
	}
}

export function isAup4FileName(name) {
	return /\.aup4$/i.test(String(name || '').trim());
}

export function aup4OutputName(name) {
	const base = String(name || '').trim().replace(/\.aup4$/i, '') || 'audacity-project';
	return `${base}.wav`;
}

function aup4Error(error) {
	if (error instanceof Aup4Error) return error;
	if (error instanceof TypeError) return new TypeError(error.message.replaceAll('AUP3', 'AUP4'), { cause: error });
	return new Aup4Error(String(error?.message || error).replaceAll('AUP3', 'AUP4'),
		error?.code === 'NOT_AUP3' ? 'NOT_AUP4' : error?.code || 'AUP4_ERROR', { cause: error });
}
