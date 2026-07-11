import { formatTime, parseCues } from './offline-subtitle-studio.js';

const ASS_HEADER = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{fontSize},&H00FFFFFF,&H0000FFFF,&H96000000,&H64000000,1,0,0,0,100,100,0,0,1,3,1,{alignment},70,70,{marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

export function buildSubtitleAss(source, options = {}) {
	const cues = Array.isArray(source) ? source : parseCues(source);
	const mode = options.mode || 'full';
	const alignment = Number(options.alignment || 2);
	const fontSize = clampInteger(options.fontSize, 28, 100, 58);
	const marginV = clampInteger(options.marginV, 40, 600, 180);
	const style = ASS_HEADER
		.replace('{fontSize}', String(fontSize))
		.replace('{alignment}', String(alignment))
		.replace('{marginV}', String(marginV));
	const lines = cues.flatMap((cue) => cueLines(cue, mode));
	return `${style}${lines.join('\n')}\n`;
}

export function assTimestamp(seconds) {
	const totalCentiseconds = Math.max(0, Math.round(Number(seconds || 0) * 100));
	const centiseconds = totalCentiseconds % 100;
	const wholeSeconds = (totalCentiseconds - centiseconds) / 100;
	const secondsPart = wholeSeconds % 60;
	const totalMinutes = (wholeSeconds - secondsPart) / 60;
	const minutes = totalMinutes % 60;
	const hours = (totalMinutes - minutes) / 60;
	return `${hours}:${String(minutes).padStart(2, '0')}:${String(secondsPart).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function cueLines(cue, mode) {
	const text = escapeAss(cue.text);
	if (!text) return [];
	if (mode === 'single') {
		const words = text.split(/\s+/).filter(Boolean);
		const duration = Math.max(0.01, cue.end - cue.start);
		return words.map((word, index) => dialogue(
			cue.start + duration * index / words.length,
			cue.start + duration * (index + 1) / words.length,
			word,
		));
	}

	if (mode === 'karaoke') {
		const words = text.split(/\s+/).filter(Boolean);
		const duration = Math.max(0.01, cue.end - cue.start);
		const karaoke = words.map((word, index) => {
			const next = cue.start + duration * (index + 1) / words.length;
			const previous = cue.start + duration * index / words.length;
			return `{\\k${Math.max(1, Math.round((next - previous) * 100))}}${word}`;
		}).join(' ');
		return [dialogue(cue.start, cue.end, karaoke)];
	}

	return [dialogue(cue.start, cue.end, text)];
}

function dialogue(start, end, text) {
	return `Dialogue: 0,${assTimestamp(start)},${assTimestamp(end)},Default,,0,0,0,,${text}`;
}

function escapeAss(value) {
	return String(value || '')
		.replaceAll('\\', '\\\\')
		.replaceAll('{', '\\{')
		.replaceAll('}', '\\}')
		.replace(/\r?\n/g, '\\N')
		.trim();
}

function clampInteger(value, minimum, maximum, fallback) {
	const parsed = Math.round(Number(value));
	return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

export function subtitleOutputName(name) {
	return `${String(name || '').replace(/\.[^.]+$/, '') || 'video'}-subtitled.mp4`;
}

export function subtitleBurnerArgs(input, subtitles, output) {
	return [
		'-i', input,
		'-vf', `subtitles=${subtitles}`,
		'-map', '0:v:0?', '-map', '0:a:0?',
		'-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast',
		'-c:a', 'aac', '-b:a', '128k',
		'-movflags', '+faststart', '-y', output,
	];
}

export { formatTime, parseCues };
