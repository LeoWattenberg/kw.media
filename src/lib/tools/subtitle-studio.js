import { toSrt } from './offline-subtitle-studio.js';
import { buildSubtitleAss } from './subtitle-burner.js';

/*
 * Everything the studio settles before FFmpeg starts: hard subs are always burned
 * into MP4 and need a styled ASS file, soft subs keep the chosen container and are
 * muxed from SRT. Name and MIME type follow from that container, so the download
 * cannot describe a different file than the one the run writes.
 */
export function planSubtitleOutput({ mode = 'soft', container = 'mkv', cues = [], style = {}, name = '' } = {}) {
	const burn = mode === 'hard';
	const outputContainer = burn ? 'mp4' : (container || 'mkv');
	return {
		mode: burn ? 'hard' : 'soft',
		container: outputContainer,
		subtitleFormat: burn ? 'ass' : 'srt',
		subtitles: burn ? buildSubtitleAss(cues, style) : toSrt(cues),
		name: subtitleStudioOutputName(name, burn ? 'hard' : 'soft', outputContainer),
		mime: subtitleStudioMime(burn ? 'hard' : 'soft', outputContainer),
	};
}

export function softSubtitleArgs(input, subtitles, output, container = 'mkv') {
	const args = ['-i', input, '-i', subtitles, '-map', '0', '-map', '1:0', '-c', 'copy'];

	if (container === 'mp4') {
		args.push('-c:s', 'mov_text', '-movflags', '+faststart');
	} else {
		args.push('-c:s', 'srt');
	}

	args.push('-metadata:s:s:0', 'language=und', '-y', output);
	return args;
}

export function subtitleStudioOutputName(name, mode, container = 'mkv') {
	const base = String(name || '').replace(/\.[^.]+$/, '') || 'media';
	return mode === 'hard' ? `${base}-hard-subtitles.mp4` : `${base}-soft-subtitles.${container}`;
}

export function subtitleStudioMime(mode, container = 'mkv') {
	if (mode === 'hard' || container === 'mp4') return 'video/mp4';
	return 'video/x-matroska';
}
