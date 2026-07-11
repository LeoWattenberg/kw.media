export function parseCues(source, format = 'auto') {
	const normalized = String(source || '').replace(/\r/g, '').trim();
	if (!normalized) return [];
	const isVtt = format === 'vtt' || (format === 'auto' && /^WEBVTT/m.test(normalized));
	const body = isVtt ? normalized.replace(/^WEBVTT[^\n]*\n+/, '').trim() : normalized;

	return body.split(/\n{2,}/).map((block) => {
		const lines = block.split('\n').filter(Boolean);
		const timeIndex = lines.findIndex((line) => line.includes('-->'));
		if (timeIndex < 0) return null;
		const [startRaw, endRaw] = lines[timeIndex].split('-->').map((part) => part.trim().split(/\s+/)[0]);
		const start = parseTime(startRaw);
		const end = parseTime(endRaw);
		if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
		return { start, end, text: lines.slice(timeIndex + 1).join('\n').trim() };
	}).filter(Boolean);
}

export function parseTime(value) {
	const match = String(value).replace(',', '.').match(/(?:(\d+):)?(\d{2}):(\d{2})(?:\.(\d{1,3}))?/);
	if (!match) return NaN;
	const hours = Number(match[1] || 0);
	const minutes = Number(match[2] || 0);
	const seconds = Number(match[3] || 0);
	const ms = Number((match[4] || '0').padEnd(3, '0'));
	return hours * 3600 + minutes * 60 + seconds + ms / 1000;
}

export function offsetCues(cues, offsetSeconds) {
	const offset = Number(offsetSeconds || 0);
	return cues.map((cue) => ({
		...cue,
		start: Math.max(0, cue.start + offset),
		end: Math.max(0, cue.end + offset),
	})).filter((cue) => cue.end > cue.start);
}

export function toSrt(cues) {
	return cues.map((cue, index) => `${index + 1}\n${formatTime(cue.start, ',')} --> ${formatTime(cue.end, ',')}\n${cue.text}`).join('\n\n') + '\n';
}

export function toVtt(cues) {
	return `WEBVTT\n\n${cues.map((cue) => `${formatTime(cue.start, '.')} --> ${formatTime(cue.end, '.')}\n${cue.text}`).join('\n\n')}\n`;
}

export function formatTime(seconds, decimal) {
	const totalMs = Math.round(seconds * 1000);
	const ms = totalMs % 1000;
	const totalSeconds = (totalMs - ms) / 1000;
	const s = totalSeconds % 60;
	const totalMinutes = (totalSeconds - s) / 60;
	const m = totalMinutes % 60;
	const h = (totalMinutes - m) / 60;
	return `${pad(h)}:${pad(m)}:${pad(s)}${decimal}${String(ms).padStart(3, '0')}`;
}

function pad(value) {
	return String(value).padStart(2, '0');
}
