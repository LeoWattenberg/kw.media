// Turns request-form answers into an email draft. Mail clients expect CRLF line breaks in
// mailto bodies (RFC 6068), so every line break is normalised to CRLF before encoding.
const CRLF = '\r\n';

function textValue(value) {
	return typeof value === 'string' ? value.trim().replace(/\r?\n/g, CRLF) : '';
}

export function requestFieldLines(fields, values) {
	const lines = [];

	for (const field of fields) {
		const value = values[field.name];

		if (field.type === 'checkbox') {
			if (value === true) {
				lines.push(`[x] ${field.label}`);
			}
			continue;
		}

		const text = textValue(value);

		if (!text) {
			continue;
		}

		lines.push(field.type === 'textarea' ? `${field.label}${CRLF}${text}` : `${field.label}: ${text}`);
	}

	return lines;
}

export function formatRequestBody(fields, values) {
	return requestFieldLines(fields, values).join(CRLF + CRLF);
}

// "{name}" placeholders take the trimmed field value; separators left dangling by an
// empty value ("Channel Check – ") are dropped.
export function formatRequestSubject(template, values) {
	return template
		.replace(/\{(\w+)\}/g, (_, name) => textValue(values[name]).replace(/\s+/g, ' '))
		.replace(/[\s–—:|-]+$/u, '')
		.trim();
}

export function buildRequestMailto({ email, subject, body }) {
	return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function formatRequestCopy({ email, subject, body }) {
	return [`To: ${email}`, `Subject: ${subject}`, '', body].join(CRLF);
}
