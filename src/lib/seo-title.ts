/** Roughly where Google stops rendering a title in the SERP. */
export const MAX_TITLE_LENGTH = 60;

/** Length of the " | Koytek Wattenberg Media" suffix BaseLayout appends. */
export const BRAND_SUFFIX_LENGTH = 26;

const emoji = /\p{Extended_Pictographic}️?/gu;
const hashtag = /(^|\s)#[\p{L}\p{N}_]+/gu;
const allCapsWord = /\p{Lu}{5,}/u;

/** Titles below this are too short to keep trimming, whatever else is wrong with them. */
const minimumTrimmedLength = 25;

/**
 * Post titles are imported verbatim from YouTube, where headline conventions differ from
 * search: emoji, hashtags and a trailing "| Category" segment all read as normal there,
 * and all three are triggers for Google rewriting the title itself.
 *
 * This performs only the mechanical trims, which are safe in both locales. Casing is
 * deliberately left alone — German capitalises nouns, so no automatic rule turns an
 * ALL-CAPS German headline into correct sentence case. Titles that need that judgement
 * are reported by `npm run audit:titles` and fixed by setting `seoTitle` in frontmatter.
 *
 * The on-page H1 keeps the original title; only the <title> element is normalised.
 */
export function normalizeSeoTitle(title: string): string {
	let result = title.replace(emoji, ' ').replace(hashtag, ' ');
	result = collapse(result);

	// "Real headline | Creator News" -> "Real headline", but only when the title is long
	// enough to need it and enough of it survives to still describe the page.
	if (result.length + BRAND_SUFFIX_LENGTH > MAX_TITLE_LENGTH && result.includes('|')) {
		const head = collapse(result.split('|')[0] ?? '');
		if (head.length >= minimumTrimmedLength) {
			result = head;
		}
	}

	return result;
}

function collapse(value: string): string {
	return value
		.replace(/\s{2,}/g, ' ')
		.replace(/\s*[-–—:,|]\s*$/, '')
		.trim();
}

/** Whether a title still needs a hand-written `seoTitle`, and why. */
export function titleWarnings(title: string): string[] {
	const warnings: string[] = [];
	const full = title.length + BRAND_SUFFIX_LENGTH;

	if (full > MAX_TITLE_LENGTH) {
		warnings.push(`${full} chars with brand suffix, over ${MAX_TITLE_LENGTH}`);
	}

	if (allCapsWord.test(title)) {
		warnings.push('contains an ALL-CAPS word');
	}

	return warnings;
}
