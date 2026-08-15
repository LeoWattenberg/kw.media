/*
 * The crop box the vertical reframer hands FFmpeg. A stream that reports no
 * dimensions — an audio-only or broken file — has no box to cut, and `null` keeps
 * an impossible `crop=0:0:0:0` filter out of the render.
 */
export function verticalCropRect(width, height, ratio, center = 0.5) {
	const sourceWidth = Number(width);
	const sourceHeight = Number(height);
	const [ratioWidth, ratioHeight] = String(ratio ?? '').split(':').map(Number);
	const targetRatio = ratioWidth / ratioHeight;
	if (!(sourceWidth > 0) || !(sourceHeight > 0) || !Number.isFinite(targetRatio) || targetRatio <= 0) return null;

	let w = sourceWidth;
	let h = Math.round(w / targetRatio);
	if (h > sourceHeight) { h = sourceHeight; w = Math.round(h * targetRatio); }
	const focus = Number.isFinite(Number(center)) ? Number(center) : 0.5;
	return {
		x: Math.round(Math.max(0, Math.min(sourceWidth - w, focus * sourceWidth - w / 2))),
		y: Math.round(Math.max(0, (sourceHeight - h) / 2)),
		w,
		h,
	};
}
