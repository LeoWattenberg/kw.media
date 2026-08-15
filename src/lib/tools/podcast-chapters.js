/*
 * The chapter editor muxes with `-c copy`, so the container it writes has to be
 * able to hold the stream that is already in the source file and to carry
 * chapters. Offering anything else only buys the visitor a raw
 * "FFmpeg exited with code 1", which is why the list is derived from the source.
 */
const CONTAINER_LABELS = { m4a: 'M4A', mp3: 'MP3', mp4: 'MP4', mkv: 'MKV' };

/* Matroska takes every stream these tools can produce, so it is the honest fallback. */
const CONTAINERS_BY_SOURCE = {
	mp3: ['mp3', 'mkv'],
	m4a: ['m4a', 'mp4', 'mkv'],
	mp4: ['mp4', 'mkv'],
	other: ['mkv'],
};

/* Without a media file nothing is muxed at all, so nothing is illegal yet. */
const ALL_CONTAINERS = ['m4a', 'mp3', 'mp4', 'mkv'];

/* A last chapter has no successor to end at, so an unknown media length is guessed. */
export const ASSUMED_LAST_CHAPTER_SECONDS = 60;

export function muxContainers(file) {
	if (!file) {
		return [...ALL_CONTAINERS];
	}

	return [...CONTAINERS_BY_SOURCE[sourceKind(file)]];
}

export function muxContainerOptions(file) {
	return muxContainers(file).map((value) => ({ value, label: CONTAINER_LABELS[value] }));
}

export function defaultMuxContainer(file, preferred) {
	const containers = muxContainers(file);
	return containers.includes(preferred) ? preferred : containers[0];
}

function sourceKind(file) {
	const type = String(file && file.type ? file.type : '').toLowerCase();
	const match = String(file && file.name ? file.name : '').toLowerCase().match(/\.([a-z0-9]+)$/);
	const extension = match ? match[1] : '';

	if (type === 'audio/mpeg' || type === 'audio/mp3' || extension === 'mp3') return 'mp3';
	if (type === 'audio/mp4' || type === 'audio/x-m4a' || type === 'audio/aac' || extension === 'm4a' || extension === 'aac') return 'm4a';
	if (type === 'video/mp4' || type === 'video/quicktime' || extension === 'mp4' || extension === 'm4v' || extension === 'mov') return 'mp4';
	return 'other';
}

function lastChapterStart(chapters) {
	const list = Array.isArray(chapters) ? chapters : [];
	return list.length ? Number(list[list.length - 1].start) || 0 : 0;
}

export function usesAssumedEnd(chapters, mediaDuration) {
	const duration = Number(mediaDuration);
	return !(Number.isFinite(duration) && duration > lastChapterStart(chapters));
}

export function lastChapterEnd(chapters, mediaDuration) {
	return usesAssumedEnd(chapters, mediaDuration)
		? lastChapterStart(chapters) + ASSUMED_LAST_CHAPTER_SECONDS
		: Number(mediaDuration);
}

export function buildFfmetadata(chapters, mediaDuration) {
	const list = Array.isArray(chapters) ? chapters : [];
	const lines = [';FFMETADATA1'];

	for (let index = 0; index < list.length; index += 1) {
		const start = Math.round(list[index].start * 1000);
		const next = index + 1 < list.length ? list[index + 1].start : lastChapterEnd(list, mediaDuration);
		const end = Math.round(next * 1000) - 1;
		lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${start}`, `END=${Math.max(start + 1, end)}`, `title=${escapeMetadata(list[index].title)}`);
	}

	return lines.join('\n') + '\n';
}

/* FFmetadata treats =, ;, # and \ as special, so a raw title loses those characters when read back. */
function escapeMetadata(title) {
	return String(title).replace(/([=;#\\])/g, '\\$1').replace(/\n/g, ' ');
}
