/**
 * Outbound commercial links have to declare themselves. Google asks for rel="sponsored"
 * on affiliate links specifically, and treating them as ordinary editorial links is a
 * link-scheme problem rather than a missed optimisation.
 *
 * Only links that are genuinely affiliate are marked: an amzn.to short link always is,
 * and an Amazon product URL is only when it carries an associates `tag` parameter. A
 * plain Amazon link cited as a reference stays a normal followed link.
 */
const anchor = /<a\b([^>]*)>/gi;
const hrefAttribute = /\bhref\s*=\s*("([^"]*)"|'([^']*)')/i;
const relAttribute = /\brel\s*=\s*("([^"]*)"|'([^']*)')/i;

const sponsoredRel = ['sponsored', 'nofollow', 'noopener'];

function isAffiliate(href: string): boolean {
	let url: URL;

	try {
		url = new URL(href);
	} catch {
		return false;
	}

	const host = url.hostname.toLowerCase();

	if (host === 'amzn.to' || host === 'www.amzn.to') {
		return true;
	}

	const isAmazon = host === 'amazon.com' || host.endsWith('.amazon.com') || /(^|\.)amazon\.[a-z]{2}(\.[a-z]{2})?$/.test(host);
	return isAmazon && url.searchParams.has('tag');
}

export function markAffiliateLinks(html: string): string {
	return html.replace(anchor, (tag, attributes: string) => {
		const href = hrefAttribute.exec(attributes);
		const value = href?.[2] ?? href?.[3];

		if (!value || !isAffiliate(value)) {
			return tag;
		}

		const existing = relAttribute.exec(attributes);
		const tokens = new Set((existing?.[2] ?? existing?.[3] ?? '').split(/\s+/).filter(Boolean));
		for (const token of sponsoredRel) {
			tokens.add(token);
		}

		const rel = `rel="${[...tokens].join(' ')}"`;
		const updated = existing
			? attributes.replace(relAttribute, rel)
			: `${attributes.trimEnd()} ${rel}`;

		return `<a${updated}>`;
	});
}
