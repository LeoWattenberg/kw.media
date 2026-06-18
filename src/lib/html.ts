const namedEntities: Record<string, string> = {
	amp: '&',
	apos: "'",
	hellip: '...',
	laquo: '«',
	raquo: '»',
	quot: '"',
	rsquo: "'",
	lsquo: "'",
	rdquo: '"',
	ldquo: '"',
	ndash: '-',
	mdash: '-',
	nbsp: ' ',
};

export function decodeHtml(value: string): string {
	return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
		if (entity[0] === '#') {
			const isHex = entity[1]?.toLowerCase() === 'x';
			const codePoint = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
			return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : _;
		}

		return namedEntities[entity.toLowerCase()] ?? _;
	});
}

export function stripHtml(value: string): string {
	return decodeHtml(value)
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<[^>]*>/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function prepareContentHtml(value: string): string {
	return decodeHtml(value)
		.replace(/href="https:\/\/kw\.media(\/[^"]*)"/g, 'href="$1"')
		.replace(/href='https:\/\/kw\.media(\/[^']*)'/g, "href='$1'")
		.replace(/<script[\s\S]*?<\/script>/gi, '');
}
