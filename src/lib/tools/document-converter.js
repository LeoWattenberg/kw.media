export function detectInputFormat(fileName) {
	const lower = String(fileName || '').toLowerCase();
	if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
	if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
	if (lower.endsWith('.txt')) return 'markdown';
	if (lower.endsWith('.tex')) return 'latex';
	if (lower.endsWith('.rst')) return 'rst';
	if (lower.endsWith('.adoc')) return 'asciidoc';
	if (lower.endsWith('.docx')) return 'docx';
	if (lower.endsWith('.odt')) return 'odt';
	if (lower.endsWith('.rtf')) return 'rtf';
	if (lower.endsWith('.epub')) return 'epub';
	return 'markdown';
}

export function isBinaryInput(file, inputFormat) {
	const type = String(file?.type || '');
	return ['docx', 'odt', 'epub'].includes(inputFormat)
		|| [
			'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
			'application/vnd.oasis.opendocument.text',
			'application/epub+zip',
		].includes(type);
}

export function buildOutputName(sourceName, extension) {
	const base = String(sourceName || '').replace(/\.[^.]+$/, '') || 'converted-document';
	return `${base}${extension}`;
}
