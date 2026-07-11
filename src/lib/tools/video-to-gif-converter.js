export function normalizeGifSettings(raw, maxDuration = 20) {
	const start = clamp(Number(raw.start), 0, Math.max(0, maxDuration - 0.5));
	const duration = clamp(Number(raw.duration), 0.5, Math.min(20, Math.max(0.5, maxDuration - start)));
	return {
		start: roundToTenths(start),
		duration: roundToTenths(duration),
		fps: Math.round(clamp(Number(raw.fps), 6, 24)),
		width: Math.round(clamp(Number(raw.width), 240, 960)),
		colors: Math.round(clamp(Number(raw.colors), 32, 256)),
		loop: Boolean(raw.loop),
	};
}

export function buildGifFilter(settings) {
	return [
		`fps=${settings.fps},scale=${settings.width}:-1:flags=lanczos,split[s0][s1]`,
		`[s0]palettegen=max_colors=${settings.colors}:reserve_transparent=0[p]`,
		'[s1][p]paletteuse=dither=sierra2_4a',
	].join(';');
}

export function buildGifArgs(inputName, outputName, settings) {
	return [
		'-ss', String(settings.start),
		'-t', String(settings.duration),
		'-i', inputName,
		'-filter_complex', buildGifFilter(settings),
		'-loop', settings.loop ? '0' : '-1',
		'-gifflags', '+transdiff',
		'-y', outputName,
	];
}

export function clamp(value, min, max) {
	if (!Number.isFinite(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, value));
}

export function roundToTenths(value) {
	return Math.round(value * 10) / 10;
}

export function roundToHalf(value) {
	return Math.round(value * 2) / 2;
}

export function formatTime(seconds) {
	const totalSeconds = Math.max(0, Math.round(seconds));
	const minutes = Math.floor(totalSeconds / 60);
	const remainingSeconds = totalSeconds % 60;
	return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}
