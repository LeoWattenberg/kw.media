import { relative } from 'node:path';
import { readAllPosts } from './content-ai.mjs';

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const help = args.includes('--help') || args.includes('-h');

if (help) {
	console.log(`Usage:
node scripts/audit-titles.mjs [--json]

Lists posts whose <title> still needs a hand-written 'seoTitle' in frontmatter, either
because it exceeds the SERP length budget after the brand suffix is appended, or because
it carries ALL-CAPS emphasis that no automatic rule can recase correctly in German.

Mechanical artifacts (emoji, hashtags, trailing "| Category" segments) are already
stripped at build time and are not reported here.`);
	process.exit(0);
}

// Kept in sync with src/lib/seo-title.ts, which is the source of truth at build time.
const MAX_TITLE_LENGTH = 60;
const BRAND_SUFFIX_LENGTH = 26;
const MINIMUM_TRIMMED_LENGTH = 25;
const emoji = /\p{Extended_Pictographic}️?/gu;
const hashtag = /(^|\s)#[\p{L}\p{N}_]+/gu;
const allCapsWord = /\p{Lu}{5,}/u;

function collapse(value) {
	return value.replace(/\s{2,}/g, ' ').replace(/\s*[-–—:,|]\s*$/, '').trim();
}

function normalizeSeoTitle(title) {
	let result = collapse(title.replace(emoji, ' ').replace(hashtag, ' '));

	if (result.length + BRAND_SUFFIX_LENGTH > MAX_TITLE_LENGTH && result.includes('|')) {
		const head = collapse(result.split('|')[0] ?? '');
		if (head.length >= MINIMUM_TRIMMED_LENGTH) {
			result = head;
		}
	}

	return result;
}

const findings = [];

for (const post of readAllPosts()) {
	const { title, seoTitle } = post.frontmatter;
	if (!title || seoTitle) {
		continue;
	}

	const effective = normalizeSeoTitle(title);
	const total = effective.length + BRAND_SUFFIX_LENGTH;
	const reasons = [];

	if (total > MAX_TITLE_LENGTH) {
		reasons.push(`${total} chars with brand suffix`);
	}

	if (allCapsWord.test(effective)) {
		reasons.push('ALL-CAPS word');
	}

	if (reasons.length) {
		findings.push({
			filePath: relative(process.cwd(), post.filePath),
			path: post.frontmatter.path,
			title,
			effective,
			total,
			reasons,
		});
	}
}

findings.sort((a, b) => b.total - a.total);

if (jsonOutput) {
	console.log(JSON.stringify({ auditedTitles: findings.length, findings }, null, 2));
	process.exit(0);
}

if (!findings.length) {
	console.log('No post titles need an seoTitle override.');
	process.exit(0);
}

console.log(`${findings.length} post(s) would benefit from an 'seoTitle' in frontmatter:\n`);

for (const finding of findings) {
	console.log(`${finding.filePath}`);
	console.log(`  reasons: ${finding.reasons.join(', ')}`);
	console.log(`  title:   ${finding.title}`);
	if (finding.effective !== finding.title) {
		console.log(`  built:   ${finding.effective}`);
	}
	console.log('');
}

console.log(`Target ${MAX_TITLE_LENGTH - BRAND_SUFFIX_LENGTH} characters or fewer for 'seoTitle'.`);
