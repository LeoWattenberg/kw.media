export function createTrials(count, random = Math.random) {
	const normalizedCount = Math.max(0, Math.floor(Number(count) || 0));
	return Array.from({ length: normalizedCount }, () => ({
		xIs: random() < 0.5 ? 'A' : 'B',
	}));
}

export function chanceProbability(correct, total) {
	const normalizedTotal = Math.max(0, Math.floor(Number(total) || 0));
	const normalizedCorrect = Math.max(0, Math.floor(Number(correct) || 0));
	let probability = 0;

	for (let successes = normalizedCorrect; successes <= normalizedTotal; successes += 1) {
		probability += combination(normalizedTotal, successes) * (0.5 ** normalizedTotal);
	}

	return probability;
}

export function combination(total, successes) {
	const normalizedTotal = Math.max(0, Math.floor(Number(total) || 0));
	const normalizedSuccesses = Math.max(0, Math.floor(Number(successes) || 0));

	if (normalizedSuccesses > normalizedTotal) {
		return 0;
	}

	const k = Math.min(normalizedSuccesses, normalizedTotal - normalizedSuccesses);
	let result = 1;

	for (let index = 1; index <= k; index += 1) {
		result = result * (normalizedTotal - k + index) / index;
	}

	return result;
}

export function formatProbability(value) {
	if (value < 0.1 && value > 0) {
		return '<0.1';
	}

	return value.toFixed(value >= 10 ? 1 : 2);
}

export function formatTime(seconds) {
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return '0:00';
	}

	const minutes = Math.floor(seconds / 60);
	const wholeSeconds = Math.floor(seconds % 60);
	return `${minutes}:${String(wholeSeconds).padStart(2, '0')}`;
}

export function fileExtension(name) {
	const match = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
	return match ? match[0] : '.audio';
}
