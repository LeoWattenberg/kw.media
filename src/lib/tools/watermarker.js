/*
 * The browser cannot read the dimensions of every container the watermarker accepts (AVI, WMV and
 * some MOV files never fire loadedmetadata), so those runs take their size from the PNG frame
 * FFmpeg decodes instead. Canvas also exports a single frame, so an animated GIF has to say so.
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

/** True when the GIF carries more than one image descriptor, which the canvas export flattens. */
export function isAnimatedGif(source) {
	const bytes = toBytes(source);

	if (!bytes || bytes.length < 14) {
		return false;
	}

	const header = readAscii(bytes, 0, 6);

	if (header !== 'GIF87a' && header !== 'GIF89a') {
		return false;
	}

	let offset = 13 + colorTableBytes(bytes[10]);
	let frames = 0;

	while (offset < bytes.length) {
		const block = bytes[offset];

		if (block === 0x2c) {
			frames += 1;

			if (frames > 1) {
				return true;
			}

			offset += 10 + colorTableBytes(bytes[offset + 9]);
			offset = skipSubBlocks(bytes, offset + 1);
		} else if (block === 0x21) {
			offset = skipSubBlocks(bytes, offset + 2);
		} else {
			/* Trailer (0x3b) or a byte no reader would follow. */
			break;
		}
	}

	return false;
}
