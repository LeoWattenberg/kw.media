const MEBIBYTE = 1024 * 1024;
export const AUDACITY_LARGE_PROJECT_THRESHOLD_BYTES = 256 * MEBIBYTE;
// Advisory budgets used for warnings until the user confirms a larger attempt.
const MEMORY_PROFILES = Object.freeze({
	constrained: Object.freeze({ databaseBytes: 128 * MEBIBYTE, decodedAudioBytes: 256 * MEBIBYTE, mixBytes: 384 * MEBIBYTE }),
	standard: Object.freeze({ databaseBytes: 256 * MEBIBYTE, decodedAudioBytes: 384 * MEBIBYTE, mixBytes: 512 * MEBIBYTE }),
	large: Object.freeze({ databaseBytes: 512 * MEBIBYTE, decodedAudioBytes: 512 * MEBIBYTE, mixBytes: 768 * MEBIBYTE }),
});
// Confirmation permits an attempt beyond the advisory budgets. Keep finite
// bounds for the decoder's arithmetic; actual browser/WASM allocations can fail.
const ATTEMPT_MEMORY_LIMITS = Object.freeze({
	databaseBytes: Number.MAX_SAFE_INTEGER,
	decodedAudioBytes: Number.MAX_SAFE_INTEGER,
	mixBytes: Number.MAX_SAFE_INTEGER,
});

let sqlJsPromise;

export function getAudacityMemoryLimits(options = {}) {
	if (options.allowLargeProject) return MEMORY_PROFILES.large;
	const navigatorLike = options.navigator ?? globalThis.navigator;
	const deviceMemory = Number(navigatorLike?.deviceMemory);
	const mobile = Boolean(navigatorLike?.userAgentData?.mobile) || /Android|iPhone|iPad|iPod|Mobile/i.test(String(navigatorLike?.userAgent || ''));
	return mobile || (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4)
		? MEMORY_PROFILES.constrained
		: MEMORY_PROFILES.standard;
}

export async function loadSqlJs() {
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

export function resolveAudacityMemoryLimits(options = {}) {
	if (options.allowLargeProject) return ATTEMPT_MEMORY_LIMITS;
	const selected = options.memoryLimits || getAudacityMemoryLimits(options);
	return {
		databaseBytes: boundedLimit(selected.databaseBytes, MEMORY_PROFILES.standard.databaseBytes),
		decodedAudioBytes: boundedLimit(selected.decodedAudioBytes, MEMORY_PROFILES.standard.decodedAudioBytes),
		mixBytes: boundedLimit(selected.mixBytes, MEMORY_PROFILES.standard.mixBytes),
	};
}

function boundedLimit(value, fallback) {
	return Number.isFinite(value) && value >= 1 ? Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)) : fallback;
}
