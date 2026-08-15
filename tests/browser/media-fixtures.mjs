// Shared uploads for the browser tests. They live here rather than in one spec because
// more than one tool needs the same input to prove the same thing about it.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const fixturePath = (name) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

export const fixtureUpload = (name, mimeType) => ({ name, mimeType, buffer: readFileSync(fixturePath(name)) });

// Chromium ships no AVI demuxer, so this stands in for every container the picker
// advertises that the <video> element cannot read: real MJPEG frames — the committed
// JPEG fixture, repeated — that ffmpeg decodes without complaint. Five seconds of them,
// so a GIF made from the whole clip is longer than the three-second default trim window.
export const createAviUpload = ({ frames = 50, fps = 10, width = 96, height = 64 } = {}) => {
	const frame = readFileSync(fixturePath('tiny-photo.jpg'));
	const chunk = (id, body) => {
		const header = Buffer.alloc(8);
		header.write(id, 0, 'latin1');
		header.writeUInt32LE(body.length, 4);
		// RIFF chunks start on even offsets, and the JPEG length is odd.
		return Buffer.concat(body.length % 2 ? [header, body, Buffer.alloc(1)] : [header, body]);
	};
	const list = (type, body) => {
		const header = Buffer.alloc(12);
		header.write('LIST', 0, 'latin1');
		header.writeUInt32LE(body.length + 4, 4);
		header.write(type, 8, 'latin1');
		return Buffer.concat([header, body]);
	};

	const avih = Buffer.alloc(56);
	avih.writeUInt32LE(Math.round(1e6 / fps), 0);
	avih.writeUInt32LE(frame.length * fps, 4);
	avih.writeUInt32LE(0x10, 12); // AVIF_HASINDEX
	avih.writeUInt32LE(frames, 16);
	avih.writeUInt32LE(1, 24); // one stream
	avih.writeUInt32LE(frame.length, 28);
	avih.writeUInt32LE(width, 32);
	avih.writeUInt32LE(height, 36);

	const strh = Buffer.alloc(56);
	strh.write('vids', 0, 'latin1');
	strh.write('MJPG', 4, 'latin1');
	strh.writeUInt32LE(1, 20); // dwScale
	strh.writeUInt32LE(fps, 24); // dwRate
	strh.writeUInt32LE(frames, 32); // dwLength
	strh.writeUInt32LE(frame.length, 36);
	strh.writeUInt16LE(width, 52);
	strh.writeUInt16LE(height, 54);

	const strf = Buffer.alloc(40); // BITMAPINFOHEADER
	strf.writeUInt32LE(40, 0);
	strf.writeInt32LE(width, 4);
	strf.writeInt32LE(height, 8);
	strf.writeUInt16LE(1, 12);
	strf.writeUInt16LE(24, 14);
	strf.write('MJPG', 16, 'latin1');
	strf.writeUInt32LE(width * height * 3, 20);

	const index = Buffer.alloc(16 * frames);
	const pictures = [];
	let offset = 4; // idx1 offsets count from the 'movi' fourcc
	for (let position = 0; position < frames; position += 1) {
		pictures.push(chunk('00dc', frame));
		index.write('00dc', position * 16, 'latin1');
		index.writeUInt32LE(0x10, position * 16 + 4); // AVIIF_KEYFRAME
		index.writeUInt32LE(offset, position * 16 + 8);
		index.writeUInt32LE(frame.length, position * 16 + 12);
		offset += 8 + frame.length + (frame.length % 2);
	}

	const body = Buffer.concat([
		Buffer.from('AVI ', 'latin1'),
		list('hdrl', Buffer.concat([chunk('avih', avih), list('strl', Buffer.concat([chunk('strh', strh), chunk('strf', strf)]))])),
		list('movi', Buffer.concat(pictures)),
		chunk('idx1', index),
	]);
	const riff = Buffer.alloc(8);
	riff.write('RIFF', 0, 'latin1');
	riff.writeUInt32LE(body.length, 4);

	return { name: 'mjpeg-clip.avi', mimeType: 'video/x-msvideo', buffer: Buffer.concat([riff, body]) };
};
