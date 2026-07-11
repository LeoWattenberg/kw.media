const germanPattern = /\b(aber|auch|auf|aus|bei|das|dass|dein|deine|deinen|der|die|ein|eine|einen|einer|euer|eure|fur|für|hat|hier|ich|ist|kann|konnen|können|mit|nicht|oder|sich|sind|uber|über|und|von|werden|wird|wir|zuschauer|untertitel|zum|zur)\b|[äöüß]/gi;
const englishPattern = /\b(also|and|are|can|for|from|has|have|here|how|into|not|of|on|that|the|their|there|these|this|to|was|were|will|with|you|your|viewers|subtitles)\b/gi;

export function languageScores(text) {
	return {
		de: countMatches(text, germanPattern),
		en: countMatches(text, englishPattern),
	};
}

export function detectTextLocale(text) {
	const scores = languageScores(text);
	const strongest = Math.max(scores.de, scores.en);
	const weakest = Math.min(scores.de, scores.en);

	if (strongest < 5 || strongest < weakest * 1.6) {
		return undefined;
	}

	return scores.de > scores.en ? 'de' : 'en';
}

export function assertTextLocale(text, expectedLocale, label = 'Text') {
	const detectedLocale = detectTextLocale(text);

	if (detectedLocale && detectedLocale !== expectedLocale) {
		throw new Error(`${label} looks ${detectedLocale}, expected ${expectedLocale}.`);
	}

	return detectedLocale;
}

function countMatches(text, pattern) {
	return (String(text ?? '').match(pattern) ?? []).length;
}
