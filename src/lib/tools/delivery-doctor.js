/*
 * A repair is a target container plus a repair mode, and the pair decides the
 * codecs. The container is what the visitor asked for, so it is never traded for
 * an easier one: the mode says what should happen to the streams, and the table
 * below says which codecs that container can hold. WebM therefore leaves as VP9
 * with Opus — the only families its muxer accepts — while MP4, MOV, and MKV keep
 * H.264 with AAC.
 *
 * Every plan is a list of attempts, run in order until one exits cleanly. The
 * first attempt is the cheapest that could work, because a stream copy is both
 * lossless and a fraction of the encoding time, and the last attempt is the
 * encode the muxer is guaranteed to accept. A source whose streams the container
 * cannot hold — VP8 into MP4, H.264 into WebM — therefore still comes back in the
 * container that was requested.
 */

const FASTSTART = ['-movflags', '+faststart'];

/* H.264 with AAC: what MP4, MOV, and MKV take, and the fallback for anything the
   panel does not know about. `-map 0` keeps every stream of the source. */
const H264_PLAN = {
	map: ['-map', '0', '-map_metadata', '0'],
	video: ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'],
	audio: ['-c:a', 'aac', '-b:a', '160k'],
	subtitles: ['-c:s', 'copy'],
	extra: [],
};

/* WebM carries video and audio and nothing else, so the repair maps exactly those
   rather than handing the muxer a stream it has to reject. */
const WEBM_PLAN = {
	map: ['-map', '0:v?', '-map', '0:a?', '-map_metadata', '0'],
	video: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '34', '-deadline', 'good', '-cpu-used', '5', '-pix_fmt', 'yuv420p'],
	audio: ['-c:a', 'libopus', '-b:a', '160k', '-ar', '48000'],
	subtitles: [],
	extra: [],
};

const CONTAINER_PLANS = {
	mp4: { ...H264_PLAN, extra: FASTSTART },
	mkv: H264_PLAN,
	mov: { ...H264_PLAN, extra: FASTSTART },
	webm: WEBM_PLAN,
};

/* The containers the panel offers, in the order the select lists them. */
export const REPAIR_CONTAINERS = [
	{ value: 'mp4', label: 'MP4' },
	{ value: 'mkv', label: 'MKV' },
	{ value: 'mov', label: 'MOV' },
	{ value: 'webm', label: 'WebM' },
];

/* The repair modes, in the order the select lists them. Their labels are
   translated in the component; these are the values the plans are keyed by. */
export const REPAIR_MODES = ['copy', 'audio', 'web'];

function repairPlan(container) {
	return CONTAINER_PLANS[String(container || '').trim().toLowerCase()] || H264_PLAN;
}

function repairCodecAttempts(container, mode) {
	const plan = repairPlan(container);
	const encode = [...plan.video, ...plan.audio];
	/* The web mode is a re-encode by definition: it exists to replace codecs the
	   source picked with the ones the container delivers best. */
	if (String(mode) === 'web') return [encode];
	/* The audio mode only re-encodes the sound, so the picture is copied while the
	   container can hold it and re-encoded when it cannot. */
	if (String(mode) === 'audio') return [['-c:v', 'copy', ...plan.audio, ...plan.subtitles], encode];
	return [['-c', 'copy'], encode];
}

export function buildRepairAttempts(container, mode, { input, output }) {
	const plan = repairPlan(container);
	return repairCodecAttempts(container, mode).map((codecs) => [
		'-i', input,
		...plan.map,
		...codecs,
		...plan.extra,
		'-y', output,
	]);
}
