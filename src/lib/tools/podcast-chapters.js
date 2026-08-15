/*
 * Every container the editor advertises is offered for every source: the tool writes
 * the container that was asked for instead of hiding the ones a stream copy cannot
 * reach. The source decides the route, not the menu — where its streams fit the chosen
 * container they are copied, which is lossless and quick, and where they do not they
 * are re-encoded into a codec that container accepts.
 */
const CONTAINER_LABELS = { m4a: 'M4A', mp3: 'MP3', mp4: 'MP4', mkv: 'MKV' };

const MUX_CONTAINERS = ['m4a', 'mp3', 'mp4', 'mkv'];

/* Which sources a container swallows untouched. Matroska takes every stream these tools meet. */
const COPYABLE_SOURCES = {
	m4a: ['m4a', 'mp4'],
	mp3: ['mp3'],
	mp4: ['m4a', 'mp4'],
	mkv: ['m4a', 'mp3', 'mp4', 'other'],
};

/* The container a source already sits in, so the one it reaches without re-encoding. */
const NATIVE_CONTAINERS = { m4a: 'm4a', mp3: 'mp3', mp4: 'mp4', other: 'mkv' };

const VIDEO_EXTENSIONS = new Set(['3gp', 'avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'ogv', 'ts', 'webm', 'wmv']);

/* A last chapter has no successor to end at, so an unknown media length is guessed. */
export const ASSUMED_LAST_CHAPTER_SECONDS = 60;

export function muxContainers() {
	return [...MUX_CONTAINERS];
}

export function muxContainerOptions() {
	return MUX_CONTAINERS.map((value) => ({ value, label: CONTAINER_LABELS[value] }));
}

/*
 * Nothing is illegal any more, so a choice the visitor made is never overruled. Without
 * one, the tool starts at the container the source can be copied into.
 */
export function defaultMuxContainer(file, preferred) {
	if (MUX_CONTAINERS.includes(preferred)) {
		return preferred;
	}

	return file ? NATIVE_CONTAINERS[sourceKind(file)] : MUX_CONTAINERS[0];
}

/*
 * How the file gets into the container: 'copy' where the container takes the source's
 * streams as they are, 'transcode' where it cannot. Where a copy is possible it is
 * still only an attempt — a muxer that refuses one odd stream must not cost the
 * visitor the container they picked, so the re-encode stays queued behind it.
 */
export function muxModes(file, container) {
	const target = defaultMuxContainer(file, container);
	return COPYABLE_SOURCES[target].includes(sourceKind(file)) ? ['copy', 'transcode'] : ['transcode'];
}

/* The FFmpeg runs to try in order, each one carrying what the status has to report about it. */
export function muxAttempts(file, container, { input, meta, output }) {
	const target = defaultMuxContainer(file, container);

	return muxModes(file, target).map((mode) => ({
		mode,
		container: target,
		label: CONTAINER_LABELS[target],
		codec: mode === 'copy' ? '' : transcodeCodec(file, target),
		args: [
			'-i', input,
			'-i', meta,
			/* Global metadata stays with the source; only the chapters come from the ffmetadata input. */
			'-map_metadata', '0',
			'-map_chapters', '1',
			...(mode === 'copy' ? copyArgs(target) : transcodeArgs(file, target)),
			'-y', output,
		],
	}));
}

function copyArgs(container) {
	const args = ['-map', '0', '-c', 'copy'];
	if (container === 'mp4' || container === 'm4a') args.push('-movflags', '+faststart');
	return args;
}

/*
 * MP3 and M4A are audio containers, so a video source loses its picture rather than the
 * container it asked for. The audio map stays strict on purpose: with a trailing '?'
 * FFmpeg falls back to picking streams itself and quietly encodes the video instead.
 */
function transcodeArgs(file, container) {
	if (container === 'mp3') return ['-map', '0:a', '-c:a', 'libmp3lame', '-b:a', '192k'];
	if (container === 'mkv') return ['-map', '0', '-c:v', 'copy', '-c:a', 'flac'];
	if (container === 'mp4' && sourceHasVideo(file)) {
		return ['-map', '0', '-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
	}

	return ['-map', '0:a', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'];
}

function transcodeCodec(file, container) {
	if (container === 'mp3') return 'MP3';
	if (container === 'mkv') return 'FLAC';
	return container === 'mp4' && sourceHasVideo(file) ? 'H.264 + AAC' : 'AAC';
}

function sourceHasVideo(file) {
	return fileType(file).startsWith('video/') || VIDEO_EXTENSIONS.has(fileExtension(file));
}

function sourceKind(file) {
	const type = fileType(file);
	const extension = fileExtension(file);

	if (type === 'audio/mpeg' || type === 'audio/mp3' || extension === 'mp3') return 'mp3';
	if (type === 'audio/mp4' || type === 'audio/x-m4a' || type === 'audio/aac' || extension === 'm4a' || extension === 'aac') return 'm4a';
	if (type === 'video/mp4' || type === 'video/quicktime' || extension === 'mp4' || extension === 'm4v' || extension === 'mov') return 'mp4';
	return 'other';
}

function fileType(file) {
	return String(file && file.type ? file.type : '').toLowerCase();
}

function fileExtension(file) {
	const match = String(file && file.name ? file.name : '').toLowerCase().match(/\.([a-z0-9]+)$/);
	return match ? match[1] : '';
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
