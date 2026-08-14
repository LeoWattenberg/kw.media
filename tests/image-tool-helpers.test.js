import test from 'node:test';
import assert from 'node:assert/strict';

import { baseName, fileExtension, lowerFileExtension } from '../src/lib/tools/media-file.js';
import {
	buildScrubMediaArgs,
	imageExtension,
	mediaContainerMime,
	metadataOutputProfile,
} from '../src/lib/tools/metadata-privacy-scrubber.js';

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
