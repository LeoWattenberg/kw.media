/*
 * The browser cannot read the dimensions of every container the watermarker accepts (AVI, WMV and
 * some MOV files never fire loadedmetadata), so those runs take their size from the PNG frame
 * FFmpeg decodes instead. A canvas holds one frame, so an animated GIF is watermarked by FFmpeg
 * and written back as a GIF: the frame count here decides which of the two paths a file takes.
 */

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function toBytes(value) {
	if (value instanceof Uint8Array) {
		return value;
	}

	if (value instanceof ArrayBuffer) {
		return new Uint8Array(value);
	}

	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}

	return null;
}

function readAscii(bytes, start, end) {
	return String.fromCharCode(...bytes.subarray(start, end));
}

/** Width and height from a PNG IHDR header, or null when the bytes are not a PNG. */
export function readPngSize(source) {
	const bytes = toBytes(source);

	if (!bytes || bytes.length < 24) {
		return null;
	}

	for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
		if (bytes[index] !== PNG_SIGNATURE[index]) {
			return null;
		}
	}

	if (readAscii(bytes, 12, 16) !== 'IHDR') {
		return null;
	}

	const width = (bytes[16] << 24 | bytes[17] << 16 | bytes[18] << 8 | bytes[19]) >>> 0;
	const height = (bytes[20] << 24 | bytes[21] << 16 | bytes[22] << 8 | bytes[23]) >>> 0;
	return width && height ? { width, height } : null;
}

function colorTableBytes(packed) {
	return (packed & 0x80) ? 3 * 2 ** ((packed & 0x07) + 1) : 0;
}

function skipSubBlocks(bytes, start) {
	let offset = start;

	while (offset < bytes.length) {
		const size = bytes[offset];

		if (!size) {
			return offset + 1;
		}

		offset += size + 1;
	}

	return bytes.length;
}

/** Number of image descriptors in a GIF, which is the number of frames it plays. Zero for other bytes. */
export function countGifFrames(source) {
	const bytes = toBytes(source);

	if (!bytes || bytes.length < 14) {
		return 0;
	}

	const header = readAscii(bytes, 0, 6);

	if (header !== 'GIF87a' && header !== 'GIF89a') {
		return 0;
	}

	let offset = 13 + colorTableBytes(bytes[10]);
	let frames = 0;

	while (offset < bytes.length) {
		const block = bytes[offset];

		if (block === 0x2c) {
			frames += 1;
			offset += 10 + colorTableBytes(bytes[offset + 9]);
			offset = skipSubBlocks(bytes, offset + 1);
		} else if (block === 0x21) {
			offset = skipSubBlocks(bytes, offset + 2);
		} else {
			/* Trailer (0x3b) or a byte no reader would follow. */
			break;
		}
	}

	return frames;
}

/** True when the GIF carries more than one image descriptor, so it has to keep its frames. */
export function isAnimatedGif(source) {
	return countGifFrames(source) > 1;
}

/*
 * One pass over the animation: the still watermark is overlaid on every frame, the result is split
 * so a palette can be generated from the watermarked frames themselves, and paletteuse writes the
 * frames back through it. Without the palette pair FFmpeg would fall back to a fixed 256-colour
 * table and the watermark would band badly.
 */
export function buildAnimatedGifFilter() {
	return [
		'[0:v][1:v]overlay=0:0:format=auto[stamped]',
		'[stamped]split[colours][frames]',
		'[colours]palettegen=stats_mode=full[palette]',
		'[frames][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
	].join(';');
}

/** FFmpeg arguments that watermark every frame of a GIF and write a GIF back. */
export function buildAnimatedGifArgs(inputName, overlayName, outputName) {
	return [
		'-i', inputName,
		'-i', overlayName,
		'-filter_complex', buildAnimatedGifFilter(),
		'-loop', '0',
		'-gifflags', '+transdiff',
		'-y', outputName,
	];
}
