/*
 * Which repair modes a target container can actually hold. The WebM muxer only
 * accepts VP8, VP9, or AV1 video with Vorbis or Opus audio, while the web mode
 * writes H.264 plus AAC and the audio mode writes AAC, so both combinations can
 * only end as "FFmpeg exited with code 1". MP4, MOV, and MKV take every mode the
 * tool offers, and a stream copy stays available for WebM sources.
 */
const UNSUPPORTED_MODES = { webm: ['web', 'audio'] };

export function repairModeSupported(container, mode) {
	return !(UNSUPPORTED_MODES[String(container).toLowerCase()] || []).includes(String(mode));
}
