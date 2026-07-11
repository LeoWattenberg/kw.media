import { jsPDF } from 'jspdf';

export const DOCUMENT_OUTPUT_PROFILES = [
	{ value: 'html', label: 'HTML', extension: '.html', mimeType: 'text/html; charset=utf-8', format: 'html', preview: 'html' },
	{ value: 'markdown', label: 'Markdown', extension: '.md', mimeType: 'text/markdown; charset=utf-8', format: 'markdown', preview: 'text' },
	{ value: 'plain', label: 'Plain text', extension: '.txt', mimeType: 'text/plain; charset=utf-8', format: 'plain', preview: 'text' },
	{ value: 'pdf', label: 'PDF', extension: '.pdf', mimeType: 'application/pdf', format: 'plain', preview: 'pdf', pdf: true },
	{ value: 'docx', label: 'DOCX', extension: '.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', format: 'docx', preview: 'html', binary: true },
	{ value: 'odt', label: 'ODT', extension: '.odt', mimeType: 'application/vnd.oasis.opendocument.text', format: 'odt', preview: 'html', binary: true },
	{ value: 'epub', label: 'EPUB', extension: '.epub', mimeType: 'application/epub+zip', format: 'epub', preview: 'html', binary: true },
	{ value: 'latex', label: 'LaTeX', extension: '.tex', mimeType: 'text/x-tex; charset=utf-8', format: 'latex', preview: 'latex' },
	{ value: 'rtf', label: 'RTF', extension: '.rtf', mimeType: 'text/rtf; charset=utf-8', format: 'rtf', preview: 'text' },
];

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

export function buildPandocOptions(profile, outputName) {
	const options = { to: profile.format };
	if (profile.binary) options['output-file'] = outputName;
	return options;
}

export function createTextPdf(text, title = 'Converted document') {
	const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
	const margin = 48;
	const lineHeight = 14;
	const pageHeight = pdf.internal.pageSize.getHeight();
	const pageWidth = pdf.internal.pageSize.getWidth();
	const lines = pdf.splitTextToSize(String(text || '').replace(/\t/g, '    '), pageWidth - margin * 2);
	let y = margin;

	pdf.setProperties({ title });
	pdf.setFont('helvetica', 'normal');
	pdf.setFontSize(10);

	for (const line of lines.length ? lines : ['']) {
		if (y > pageHeight - margin) {
			pdf.addPage();
			y = margin;
		}
		pdf.text(line, margin, y);
		y += lineHeight;
	}

	return new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' });
}
