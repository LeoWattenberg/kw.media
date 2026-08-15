import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { baseName, fileExtension, lowerFileExtension } from '../src/lib/tools/media-file.js';
import {
	buildScrubMediaArgs,
	imageExtension,
	mediaContainerMime,
	metadataOutputProfile,
} from '../src/lib/tools/metadata-privacy-scrubber.js';
import { isAnimatedGif, readPngSize } from '../src/lib/tools/watermarker.js';

const fixture = (name) => readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)));

/*
 * Real GIF bytes: one 1x1 frame per image descriptor, each with the LZW stream a decoder expects
 * (clear code, one pixel, end of information). Only the number of descriptors decides animation.
 */
const gifBytes = ({ frames = 1, localTable = false, loop = false } = {}) => {
	const bytes = [
		0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
		0x01, 0x00, 0x01, 0x00,
		0x80, 0x00, 0x00,
		0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
	];

	if (loop) {
		bytes.push(0x21, 0xff, 0x0b, ...[...'NETSCAPE2.0'].map((character) => character.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00);
	}

	for (let index = 0; index < frames; index += 1) {
		bytes.push(0x21, 0xf9, 0x04, 0x00, 0x0a, 0x00, 0x00, 0x00);
		bytes.push(0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, localTable ? 0x80 : 0x00);
		/* A local colour table full of 0x2c bytes: a parser that does not skip it counts them as frames. */
		if (localTable) bytes.push(0x2c, 0x2c, 0x2c, 0x2c, 0x2c, 0x2c);
		bytes.push(0x01, 0x02, 0xc2, 0x00, 0x00);
	}

	bytes.push(0x3b);
	return Uint8Array.from(bytes);
};

/*
 * The Metadata Remover re-renders images through a canvas, and canvas.toBlob only
 * encodes PNG, JPEG and WebP: every other image type silently comes back as PNG.
 * The profile therefore has to name the bytes the canvas really writes, otherwise
 * the download is PNG data wearing a .gif/.avif/.bmp/.tiff extension.
 */
test('metadata scrubber profiles canvas-encodable images by the bytes the canvas writes', () => {
	assert.deepEqual(metadataOutputProfile({ name: 'shot.png', type: 'image/png' }), { isImage: true, extension: 'png', mimeType: 'image/png' });
	assert.deepEqual(metadataOutputProfile({ name: 'shot.jpeg', type: 'image/jpeg' }), { isImage: true, extension: 'jpg', mimeType: 'image/jpeg' });
	assert.deepEqual(metadataOutputProfile({ name: 'SHOT.JPG', type: 'image/jpeg' }), { isImage: true, extension: 'jpg', mimeType: 'image/jpeg' });
	assert.deepEqual(metadataOutputProfile({ name: 'shot.webp', type: 'image/webp' }), { isImage: true, extension: 'webp', mimeType: 'image/webp' });
	assert.deepEqual(metadataOutputProfile({ name: 'pasted', type: 'image/png' }), { isImage: true, extension: 'png', mimeType: 'image/png' });

	for (const [name, type] of [
		['anim.gif', 'image/gif'],
		['shot.avif', 'image/avif'],
		['scan.bmp', 'image/bmp'],
		['scan.tiff', 'image/tiff'],
		['photo.heic', 'image/heic'],
		['favicon.ico', 'image/x-icon'],
	]) {
		assert.deepEqual(
			metadataOutputProfile({ name, type }),
			{ isImage: true, extension: 'png', mimeType: 'image/png' },
			`${type} must be labelled as the PNG the canvas produces`,
		);
	}
});

/* SVG is accepted by the picker (accept="image/*"), so it must never reach FFmpeg. */
test('metadata scrubber keeps SVG out of the FFmpeg path', () => {
	const profile = metadataOutputProfile({ name: 'logo.svg', type: 'image/svg+xml' });

	assert.equal(profile.isImage, true);
	assert.deepEqual(profile, { isImage: true, extension: 'png', mimeType: 'image/png' });
});

test('metadata scrubber keeps media containers and builds stripping arguments for them', () => {
	assert.deepEqual(metadataOutputProfile({ name: 'clip.webm', type: 'video/webm' }), { isImage: false, extension: 'webm', mimeType: 'video/webm' });
	assert.deepEqual(metadataOutputProfile({ name: 'clip.MOV', type: 'video/quicktime' }), { isImage: false, extension: 'mov', mimeType: 'video/quicktime' });
	assert.deepEqual(metadataOutputProfile({ name: 'take', type: 'audio/wav' }), { isImage: false, extension: 'wav', mimeType: 'audio/wav' });
	assert.deepEqual(metadataOutputProfile({ name: 'note.txt', type: '' }), { isImage: false, extension: 'txt', mimeType: 'application/octet-stream' });
	assert.deepEqual(metadataOutputProfile({ name: 'unknown', type: '' }), { isImage: false, extension: 'bin', mimeType: 'application/octet-stream' });
	assert.deepEqual(metadataOutputProfile(undefined), { isImage: false, extension: 'bin', mimeType: 'application/octet-stream' });

	assert.deepEqual(buildScrubMediaArgs('in.mkv', 'out.mkv', 'mkv'), ['-i', 'in.mkv', '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-y', 'out.mkv']);
	assert.deepEqual(buildScrubMediaArgs('in.mov', 'out.mov', 'mov'), ['-i', 'in.mov', '-map', '0', '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy', '-movflags', '+faststart', '-y', 'out.mov']);
	assert.deepEqual(buildScrubMediaArgs('in.mp4', 'out.mp4', 'mp4').slice(-4), ['-movflags', '+faststart', '-y', 'out.mp4']);
});

/*
 * A file can arrive without a MIME type at all (a download without one, an unknown source), and the
 * classification used to read the type only: those images went to FFmpeg, where scrubbing fails.
 */
test('metadata scrubber classifies typeless files by their extension', () => {
	assert.deepEqual(metadataOutputProfile({ name: 'holiday.jpg', type: '' }), { isImage: true, extension: 'jpg', mimeType: 'image/jpeg' });
	assert.deepEqual(metadataOutputProfile({ name: 'holiday.JPEG', type: '' }), { isImage: true, extension: 'jpg', mimeType: 'image/jpeg' });
	assert.deepEqual(metadataOutputProfile({ name: 'sticker.WEBP', type: '' }), { isImage: true, extension: 'webp', mimeType: 'image/webp' });
	assert.deepEqual(metadataOutputProfile({ name: 'shot.png', type: '' }), { isImage: true, extension: 'png', mimeType: 'image/png' });

	for (const name of ['anim.gif', 'shot.avif', 'scan.bmp', 'scan.tif', 'scan.tiff', 'logo.svg', 'photo.heic', 'photo.heif', 'favicon.ico', 'frame.apng']) {
		assert.deepEqual(
			metadataOutputProfile({ name, type: '' }),
			{ isImage: true, extension: 'png', mimeType: 'image/png' },
			`${name} must reach the canvas and be labelled as the PNG it produces`,
		);
	}

	/* Media and unknown names keep the FFmpeg path, which is the only one that can strip their tags. */
	assert.deepEqual(metadataOutputProfile({ name: 'clip.mkv', type: '' }), { isImage: false, extension: 'mkv', mimeType: 'video/x-matroska' });
	assert.deepEqual(metadataOutputProfile({ name: 'take.wav', type: '' }), { isImage: false, extension: 'wav', mimeType: 'audio/wav' });
	assert.deepEqual(metadataOutputProfile({ name: 'talk.opus', type: '' }), { isImage: false, extension: 'opus', mimeType: 'audio/ogg' });
	assert.deepEqual(metadataOutputProfile({ name: 'download', type: '' }), { isImage: false, extension: 'bin', mimeType: 'application/octet-stream' });
	assert.deepEqual(metadataOutputProfile({ name: 'notes.xyz', type: '' }), { isImage: false, extension: 'xyz', mimeType: 'application/octet-stream' });
	/* An extension that names an Object member must not be read off the prototype. */
	assert.deepEqual(metadataOutputProfile({ name: 'notes.constructor', type: '' }), { isImage: false, extension: 'constructor', mimeType: 'application/octet-stream' });

	/* A declared type still decides: the name alone must not pull a video into the canvas. */
	assert.deepEqual(metadataOutputProfile({ name: 'clip.gif', type: 'video/mp4' }), { isImage: false, extension: 'gif', mimeType: 'video/mp4' });
	assert.deepEqual(metadataOutputProfile({ name: 'song.mp3', type: 'image/png' }), { isImage: true, extension: 'png', mimeType: 'image/png' });
});

test('metadata scrubber maps container extensions and canvas image types', () => {
	assert.equal(imageExtension('image/jpeg'), 'jpg');
	assert.equal(imageExtension('image/webp'), 'webp');
	assert.equal(imageExtension('image/png'), 'png');
	assert.equal(imageExtension('image/gif'), 'png');

	assert.equal(mediaContainerMime('wav'), 'audio/wav');
	assert.equal(mediaContainerMime('opus'), 'audio/ogg');
	assert.equal(mediaContainerMime('mkv'), 'video/x-matroska');
	assert.equal(mediaContainerMime('mp4'), 'video/mp4');
	assert.equal(mediaContainerMime('xyz'), 'application/octet-stream');
	assert.equal(mediaContainerMime(''), 'application/octet-stream');
});

/*
 * The watermarker cannot ask the browser for the size of an AVI, WMV or exotic MOV: those never
 * report one. FFmpeg decodes them anyway, so the first frame it writes carries the dimensions.
 */
test('watermarker reads the frame size out of the PNG FFmpeg writes', () => {
	assert.deepEqual(readPngSize(fixture('tiny-photo.png')), { width: 96, height: 64 });
	assert.deepEqual(readPngSize(new Uint8Array(fixture('tiny-photo.png'))), { width: 96, height: 64 });
	assert.deepEqual(readPngSize(Uint8Array.from(fixture('tiny-photo.png')).buffer), { width: 96, height: 64 });

	const png = Uint8Array.from(fixture('tiny-photo.png').subarray(0, 32));
	/* A 4K frame: the four IHDR bytes are big-endian, so a truncated read would report 0. */
	png.set([0x00, 0x00, 0x0f, 0x00], 16);
	png.set([0x00, 0x00, 0x08, 0x70], 20);
	assert.deepEqual(readPngSize(png), { width: 3840, height: 2160 });

	/* Anything that is not a PNG IHDR has to be reported as unreadable rather than as 0x0. */
	assert.equal(readPngSize(fixture('tiny-photo.jpg')), null);
	assert.equal(readPngSize(fixture('tiny-photo.webp')), null);
	assert.equal(readPngSize(fixture('tiny-photo.png').subarray(0, 20)), null);
	assert.equal(readPngSize(new Uint8Array(0)), null);
	assert.equal(readPngSize(null), null);
	assert.equal(readPngSize('not bytes'), null);

	const zeroed = Uint8Array.from(fixture('tiny-photo.png').subarray(0, 32));
	zeroed.set([0, 0, 0, 0], 16);
	assert.equal(readPngSize(zeroed), null);

	const renamedChunk = Uint8Array.from(fixture('tiny-photo.png').subarray(0, 32));
	renamedChunk.set([...'IDAT'].map((character) => character.charCodeAt(0)), 12);
	assert.equal(readPngSize(renamedChunk), null);
});

/* The canvas export keeps one frame, so an animated GIF has to be announced before the run. */
test('watermarker recognises an animated GIF by its image descriptors', () => {
	assert.equal(isAnimatedGif(gifBytes({ frames: 2 })), true);
	assert.equal(isAnimatedGif(gifBytes({ frames: 12, loop: true })), true);
	assert.equal(isAnimatedGif(gifBytes({ frames: 2, localTable: true })), true);

	assert.equal(isAnimatedGif(gifBytes()), false);
	assert.equal(isAnimatedGif(gifBytes({ loop: true })), false);
	/* The local colour table is full of 0x2c bytes: skipping it wrongly would claim animation. */
	assert.equal(isAnimatedGif(gifBytes({ localTable: true })), false);

	const gif87 = gifBytes({ frames: 2 });
	gif87.set([...'GIF87a'].map((character) => character.charCodeAt(0)), 0);
	assert.equal(isAnimatedGif(gif87), true);

	assert.equal(isAnimatedGif(fixture('tiny-photo.png')), false);
	assert.equal(isAnimatedGif(fixture('tiny-photo.webp')), false);
	assert.equal(isAnimatedGif(gifBytes({ frames: 2 }).subarray(0, 30)), false);
	assert.equal(isAnimatedGif(new Uint8Array(0)), false);
	assert.equal(isAnimatedGif(null), false);
});

/* The scrubbed download is named `${baseName(file.name)}-scrubbed.${extension}`. */
test('media file helpers split the names the scrubbed download is built from', () => {
	assert.equal(baseName('holiday photo.jpeg'), 'holiday photo');
	assert.equal(baseName('archive.tar.gz'), 'archive.tar');
	assert.equal(baseName('no-extension'), 'no-extension');
	assert.equal(baseName('.gitignore'), 'file');
	assert.equal(baseName('', 'image'), 'image');
	assert.equal(baseName(null), 'file');

	assert.equal(fileExtension('clip.MOV'), '.MOV');
	assert.equal(fileExtension('archive.tar.gz'), '.gz');
	assert.equal(fileExtension('no-extension'), '.bin');
	assert.equal(fileExtension('no-extension', '.mp4'), '.mp4');
	assert.equal(fileExtension(''), '.bin');

	assert.equal(lowerFileExtension('PHOTO.JPEG'), '.jpeg');
	assert.equal(lowerFileExtension('archive.tar.gz'), '.gz');
	assert.equal(lowerFileExtension('trailing.name!'), '.bin');
	assert.equal(lowerFileExtension('no-extension', '.png'), '.png');
});
