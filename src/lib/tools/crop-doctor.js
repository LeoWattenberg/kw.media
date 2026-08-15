/*
 * Frame measurement for the black bar remover. Each scan walks in from one edge
 * while the sampled rows and columns stay below the darkness threshold, so a
 * frame that carries no content above it lets every scan run to the midpoint.
 * That is not a tiny crop, it is an unmeasurable frame: `empty` reports it so the
 * even() rounding cannot turn the collapsed midpoint into a 2x2 export.
 */
const UNMEASURABLE = { x: 0, y: 0, w: 0, h: 0, empty: true };

export function detectCrop(imageData, limit) {
	const width = Number(imageData?.width) || 0;
	const height = Number(imageData?.height) || 0;
	const data = imageData?.data;
	const threshold = Number(limit) || 0;
	if (width < 2 || height < 2 || !data) return { ...UNMEASURABLE };

	const dark = (x, y) => { const i = (y * width + x) * 4; return data[i] < threshold && data[i + 1] < threshold && data[i + 2] < threshold; };
	const rowDark = (y) => { let hits = 0; for (let x = 0; x < width; x += 8) if (dark(x, y)) hits++; return hits / Math.ceil(width / 8) > 0.92; };
	const colDark = (x) => { let hits = 0; for (let y = 0; y < height; y += 8) if (dark(x, y)) hits++; return hits / Math.ceil(height / 8) > 0.92; };
	let top = 0, bottom = height - 1, left = 0, right = width - 1;
	while (top < height / 2 && rowDark(top)) top++;
	while (bottom > height / 2 && rowDark(bottom)) bottom--;
	while (left < width / 2 && colDark(left)) left++;
	while (right > width / 2 && colDark(right)) right--;
	if (right <= left || bottom <= top) return { ...UNMEASURABLE };

	const even = (v) => Math.max(2, Math.floor(v / 2) * 2);
	return { x: even(left), y: even(top), w: even(right - left + 1), h: even(bottom - top + 1), empty: false };
}
