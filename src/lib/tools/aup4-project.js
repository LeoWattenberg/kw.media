import { rewriteAup4ProjectForAup3 } from './aup3.js';
import { loadSqlJs, resolveAudacityMemoryLimits } from './audacity-project-runtime.js';

// Audacity's schema versions, not its application release numbers. Both
// formats retain SQLite application_id 'AUDY'. Version definitions:
// https://github.com/audacity/audacity/blob/Audacity-3.7.9/libraries/lib-project/ProjectFormatVersion.cpp
// https://github.com/audacity/audacity/blob/Audacity-4.0.1/au3/libraries/au3-project/ProjectFormatVersion.cpp
export const AUP3_USER_VERSION = 0x03070000;
export const AUP4_USER_VERSION = 0x04000001;
const AUDACITY_APPLICATION_ID = 0x41554459;
const SQLITE_HEADER = new TextEncoder().encode('SQLite format 3\0');
const SQLITE_HEADER_BYTES = 100;

export class Aup4Error extends Error {
	constructor(message, code = 'AUP4_ERROR', options) {
		super(message, options);
		this.name = 'Aup4Error';
		this.code = code;
	}
}

/** Validate the known AUP4 schemas before attempting a compatible downgrade. */
export function inspectAup4Header(input, options = {}) {
	const bytes = toBytes(input);
	if (!SQLITE_HEADER.every((value, index) => bytes[index] === value)) {
		throw new Aup4Error('This file is not a SQLite-based Audacity AUP4 project.', 'NOT_AUP4');
	}
	if (bytes.byteLength < SQLITE_HEADER_BYTES) {
		throw new Aup4Error('The AUP4 database header is truncated.', 'INVALID_DATABASE');
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(68) !== AUDACITY_APPLICATION_ID) {
		throw new Aup4Error('This SQLite file is not an Audacity AUP4 project.', 'NOT_AUP4');
	}
	const userVersion = view.getUint32(60);
	if (userVersion < 0x04000000) {
		throw new Aup4Error('Choose an Audacity AUP4 project, rather than an AUP3 project.', 'NOT_AUP4');
	}
	if (![0x04000000, AUP4_USER_VERSION].includes(userVersion)) {
		throw new Aup4Error('This AUP4 project uses an unsupported database version.', 'UNSUPPORTED_AUP4_VERSION');
	}
	const encodedPageSize = view.getUint16(16);
	const pageSize = encodedPageSize === 1 ? 65536 : encodedPageSize;
	const fileSize = Number(options.fileSize ?? bytes.byteLength);
	const pageCount = view.getUint32(28);
	// A saved database has whole pages. Its recorded page count is authoritative
	// only when SQLite's change counter and version-valid-for fields match.
	const validPageCount = view.getUint32(24) === view.getUint32(92);
	if (pageSize < 512 || pageSize > 65536 || (pageSize & (pageSize - 1)) !== 0 ||
		fileSize < pageSize || fileSize % pageSize !== 0 ||
		(validPageCount && pageCount > 0 && pageCount * pageSize !== fileSize) ||
		![1, 2].includes(bytes[18]) || ![1, 2].includes(bytes[19])) {
		throw new Aup4Error('The AUP4 database has an invalid or incomplete page layout. Save and close the project first.', 'INVALID_DATABASE');
	}
	return { userVersion, pageSize };
}

/**
 * Preserve audio and editable project data while changing compatibility
 * versions, adapting XML 2.0.0 attributes in saved and autosave documents for
 * Audacity 3.7. onWarning receives compatibility warning codes after success.
 */
export async function convertAup4BytesToAup3(input, options = {}) {
	if (options.signal?.aborted) throw new Aup4Error('The AUP4 conversion was cancelled.', 'ABORTED');
	const bytes = toBytes(input);
	checkAup4MemoryLimit(bytes.byteLength, options);
	inspectAup4Header(bytes);
	const SQL = options.SQL || await loadSqlJs();
	if (options.signal?.aborted) throw new Aup4Error('The AUP4 conversion was cancelled.', 'ABORTED');
	let database;
	const warnings = new Map();
	try {
		database = new SQL.Database(bytes);
		const integrity = database.exec('PRAGMA quick_check');
		if (integrity[0]?.values?.length !== 1 || integrity[0].values[0][0] !== 'ok') {
			throw new Aup4Error('The AUP4 project database is damaged or incomplete.', 'INVALID_DATABASE');
		}
		const tables = new Set(database.exec("SELECT name FROM sqlite_master WHERE type = 'table'")[0]?.values.map(([name]) => name));
		if (!tables.has('project') || !tables.has('sampleblocks')) {
			throw new Aup4Error('This SQLite file has no Audacity project data.', 'NOT_AUP4');
		}
		let changed = false;
		let hasProject = false;
		for (const table of ['project', 'autosave']) {
			if (!tables.has(table)) continue;
			const rows = database.exec(`SELECT id, dict, doc FROM ${table}`)[0]?.values || [];
			for (const [id, dictionary, document] of rows) {
				if (!dictionary?.byteLength || !document?.byteLength) {
					if (table === 'autosave') continue;
					throw new Aup4Error('The AUP4 project description is empty.', 'INVALID_DATABASE');
				}
				if (table === 'project' && id === 1) hasProject = true;
				const rewritten = rewriteAup4ProjectForAup3(dictionary, document, {
					onWarning: (warning) => warnings.set(warning.code, warning),
				});
				if (rewritten.byteLength !== document.byteLength || rewritten.some((value, index) => value !== document[index])) {
					database.run(`UPDATE ${table} SET doc = ? WHERE id = ?`, [rewritten, id]);
					changed = true;
				}
			}
		}
		if (!hasProject) throw new Aup4Error('The AUP4 database has no saved project.', 'INVALID_DATABASE');
		if (changed) {
			database.run(`PRAGMA user_version = ${AUP3_USER_VERSION}`);
			const output = database.export();
			for (const warning of warnings.values()) options.onWarning?.(warning);
			return output;
		}
		const output = bytes.slice();
		new DataView(output.buffer).setUint32(60, AUP3_USER_VERSION);
		for (const warning of warnings.values()) options.onWarning?.(warning);
		return output;
	} catch (error) {
		if (error instanceof Aup4Error) throw error;
		throw new Aup4Error(String(error?.message || error).replaceAll('AUP3', 'AUP4'), error?.code || 'INVALID_DATABASE', { cause: error });
	} finally {
		database?.close();
	}
}

export function checkAup4MemoryLimit(size, options) {
	const limit = resolveAudacityMemoryLimits(options).databaseBytes;
	if (size > limit) {
		const error = new Aup4Error(`This AUP4 project exceeds the recommended ${Math.floor(limit / (1024 * 1024))} MB memory budget.`, 'PROJECT_TOO_LARGE');
		error.memoryLimitExceeded = true;
		throw error;
	}
}

function toBytes(value) {
	// Canonicalize subclasses such as Node Buffer: Buffer.slice() aliases its
	// source, while sql.js and our output path rely on Uint8Array.slice() copying.
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Array.isArray(value)) return Uint8Array.from(value);
	throw new TypeError('Binary AUP4 data is required.');
}
