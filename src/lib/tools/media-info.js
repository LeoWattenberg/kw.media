export function normalizeResult(result) {
	if (typeof result === 'string') {
		return JSON.parse(result);
	}

	return result && typeof result === 'object' ? result : { media: { track: [] } };
}

export function formatResolution(video) {
	if (!video.Width || !video.Height) {
		return '';
	}

	return `${video.Width} x ${video.Height}`;
}

export function formatDuration(value) {
	const seconds = Number(value);

	if (!Number.isFinite(seconds) || seconds <= 0) {
		return value ? String(value) : '';
	}

	const hours = Math.floor(seconds / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const wholeSeconds = Math.floor(seconds % 60);
	const milliseconds = Math.round((seconds % 1) * 1000);
	const parts = hours > 0
		? [hours, String(minutes).padStart(2, '0'), String(wholeSeconds).padStart(2, '0')]
		: [minutes, String(wholeSeconds).padStart(2, '0')];
	const suffix = milliseconds > 0 ? `.${String(milliseconds).padStart(3, '0')}` : '';
	return `${parts.join(':')}${suffix}`;
}

export function formatBitRate(value) {
	const bits = Number(value);

	if (!Number.isFinite(bits) || bits <= 0) {
		return value ? String(value) : '';
	}

	if (bits >= 1000000) {
		return `${trimNumber(bits / 1000000)} Mb/s`;
	}

	return `${trimNumber(bits / 1000)} kb/s`;
}

export function formatFrameRate(value) {
	const frameRate = Number(value);

	if (!Number.isFinite(frameRate) || frameRate <= 0) {
		return value ? String(value) : '';
	}

	return `${trimNumber(frameRate)} fps`;
}

export function formatChannels(value) {
	const channels = Number(value);

	if (!Number.isFinite(channels) || channels <= 0) {
		return value ? String(value) : '';
	}

	return `${channels}`;
}

export function formatSamplingRate(value) {
	const rate = Number(value);

	if (!Number.isFinite(rate) || rate <= 0) {
		return value ? String(value) : '';
	}

	if (rate >= 1000) {
		return `${trimNumber(rate / 1000)} kHz`;
	}

	return `${rate} Hz`;
}

export function formatNumericBytes(value) {
	const bytes = Number(value);
	return Number.isFinite(bytes) && bytes >= 0 ? formatBytes(bytes) : String(value);
}

export function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) {
		return '0 B';
	}

	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	const value = bytes / 1024 ** index;
	return `${trimNumber(value)} ${units[index]}`;
}

export function trimNumber(value) {
	return Number(value.toFixed(value >= 10 ? 1 : 2)).toString();
}
