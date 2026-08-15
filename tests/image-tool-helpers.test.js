import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { baseName, fileExtension, lowerFileExtension } from '../src/lib/tools/media-file.js';
import {
	buildScrubMediaArgs,
	imageExtension,
	imageScrubEngine,
	isAnimatedRaster,
	magickImageFormat,
	mediaContainerMime,
	metadataOutputProfile,
	stripSvgMetadata,
} from '../src/lib/tools/metadata-privacy-scrubber.js';
import {
	buildAnimatedGifArgs,
	buildAnimatedGifFilter,
	countGifFrames,
	isAnimatedGif,
	readPngSize,
} from '../src/lib/tools/watermarker.js';

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

/* A PNG becomes an APNG the moment an animation control chunk sits ahead of the image data. */
const apngBytes = () => {
	const png = fixture('tiny-photo.png');
	const control = Buffer.from([
		0x00, 0x00, 0x00, 0x08, 0x61, 0x63, 0x54, 0x4c,
		0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00,
	]);
	return Buffer.concat([png.subarray(0, 33), control, png.subarray(33)]);
};

/* An animated WebP is a RIFF container whose ANIM chunk follows the extended header. */
const animatedWebpBytes = () => {
	const chunk = (name, data) => {
		const header = Buffer.alloc(8);
		header.write(name, 0, 'latin1');
		header.writeUInt32LE(data.length, 4);
		return Buffer.concat([header, data, Buffer.alloc(data.length % 2)]);
	};
	const body = Buffer.concat([
		Buffer.from('WEBP', 'latin1'),
		chunk('VP8X', Buffer.from([0x02, 0x00, 0x00, 0x00, 0x5f, 0x00, 0x00, 0x3f, 0x00, 0x00])),
		chunk('ANIM', Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x00])),
	]);
	const header = Buffer.alloc(8);
	header.write('RIFF', 0, 'latin1');
	header.writeUInt32LE(body.length, 4);
	return Buffer.concat([header, body]);
};

/*
 * The scrubbed download keeps the format it arrived in. canvas.toBlob only writes PNG, JPEG and
 * WebP, so every other image is re-encoded by ImageMagick WASM with its profiles stripped; the
 * profile therefore names the source format, never the one that happened to be easy to write.
 */
test('metadata scrubber profiles every image as the format it arrived in', () => {
	assert.deepEqual(metadataOutputProfile({ name: 'shot.png', type: 'image/png' }), { isImage: true, extension: 'png', mimeType: 'image/png' });
	assert.deepEqual(metadataOutputProfile({ name: 'shot.jpeg', type: 'image/jpeg' }), { isImage: true, extension: 'jpg', mimeType: 'image/jpeg' });
	assert.deepEqual(metadataOutputProfile({ name: 'SHOT.JPG', type: 'image/jpeg' }), { isImage: true, extension: 'jpg', mimeType: 'image/jpeg' });
	assert.deepEqual(metadataOutputProfile({ name: 'shot.webp', type: 'image/webp' }), { isImage: true, extension: 'webp', mimeType: 'image/webp' });
	assert.deepEqual(metadataOutputProfile({ name: 'pasted', type: 'image/png' }), { isImage: true, extension: 'png', mimeType: 'image/png' });
	/* No name to read: the declared type alone still has to name the output. */
	assert.deepEqual(metadataOutputProfile({ name: 'pasted', type: 'image/gif' }), { isImage: true, extension: 'gif', mimeType: 'image/gif' });

	for (const [name, type, extension] of [
		['anim.gif', 'image/gif', 'gif'],
		['shot.avif', 'image/avif', 'avif'],
		['scan.bmp', 'image/bmp', 'bmp'],
		['scan.tiff', 'image/tiff', 'tiff'],
		['scan.tif', 'image/tiff', 'tiff'],
		['photo.heic', 'image/heic', 'heic'],
		['photo.heif', 'image/heif', 'heif'],
		['favicon.ico', 'image/x-icon', 'ico'],
		['frame.apng', 'image/apng', 'apng'],
		['layers.psd', 'image/vnd.adobe.photoshop', 'psd'],
	]) {
		assert.deepEqual(
			metadataOutputProfile({ name, type }),
			{ isImage: true, extension, mimeType: type },
			`${type} must come back as ${type}, not as something easier to write`,
		);
	}

	/* A format this table has never heard of still keeps its own extension rather than becoming a PNG. */
	assert.deepEqual(metadataOutputProfile({ name: 'render.exr', type: 'image/x-exr' }), { isImage: true, extension: 'exr', mimeType: 'image/x-exr' });
});

/* Each image format names the engine that can write it back and the coder ImageMagick reads it with. */
test('metadata scrubber routes every image to an engine that writes its own format', () => {
	assert.equal(imageScrubEngine('image/svg+xml'), 'svg');

	/*
	 * Including the three a canvas could re-draw: canvas.toBlob drops EXIF but cannot be told to
	 * drop a colour profile, and Chromium stamps its own onto the WebP it writes.
	 */
	for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff', 'image/heic', 'image/heif', 'image/x-icon', 'image/apng', 'image/vnd.adobe.photoshop', 'image/x-exr']) {
		assert.equal(imageScrubEngine(type), 'magick', `${type} has to reach ImageMagick, which is the only engine that writes it`);
	}

	assert.equal(magickImageFormat('image/gif'), 'GIF');
	assert.equal(magickImageFormat('image/tiff'), 'TIFF');
	assert.equal(magickImageFormat('image/bmp'), 'BMP');
	assert.equal(magickImageFormat('image/avif'), 'AVIF');
	assert.equal(magickImageFormat('image/apng'), 'APNG');
	assert.equal(magickImageFormat('image/x-icon'), 'ICO');
	assert.equal(magickImageFormat('image/vnd.microsoft.icon'), 'ICO');
	assert.equal(magickImageFormat('image/vnd.adobe.photoshop'), 'PSD');
	assert.equal(magickImageFormat('image/png'), 'PNG');
	/* ImageMagick spells its remaining coders like the uppercased extension, so an unknown type still gets one. */
	assert.equal(magickImageFormat('image/x-exr', 'exr'), 'EXR');
	assert.equal(magickImageFormat('', 'tga'), 'TGA');
});

/* SVG is XML rather than pixels: it is cleaned as text and must never reach FFmpeg or a canvas. */
test('metadata scrubber keeps SVG an SVG', () => {
	assert.deepEqual(metadataOutputProfile({ name: 'logo.svg', type: 'image/svg+xml' }), { isImage: true, extension: 'svg', mimeType: 'image/svg+xml' });
	assert.deepEqual(metadataOutputProfile({ name: 'logo.svg', type: '' }), { isImage: true, extension: 'svg', mimeType: 'image/svg+xml' });
	assert.equal(imageScrubEngine('image/svg+xml'), 'svg');
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

	for (const [name, extension, mimeType] of [
		['anim.gif', 'gif', 'image/gif'],
		['shot.avif', 'avif', 'image/avif'],
		['scan.bmp', 'bmp', 'image/bmp'],
		['scan.tif', 'tiff', 'image/tiff'],
		['scan.tiff', 'tiff', 'image/tiff'],
		['logo.svg', 'svg', 'image/svg+xml'],
		['photo.heic', 'heic', 'image/heic'],
		['photo.heif', 'heif', 'image/heif'],
		['favicon.ico', 'ico', 'image/x-icon'],
		['frame.apng', 'apng', 'image/apng'],
		['layers.psd', 'psd', 'image/vnd.adobe.photoshop'],
	]) {
		assert.deepEqual(
			metadataOutputProfile({ name, type: '' }),
			{ isImage: true, extension, mimeType },
			`${name} must keep its own format even though nothing declared its type`,
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

test('metadata scrubber maps container extensions and image types', () => {
	assert.equal(imageExtension('image/jpeg'), 'jpg');
	assert.equal(imageExtension('image/webp'), 'webp');
	assert.equal(imageExtension('image/png'), 'png');
	assert.equal(imageExtension('image/gif'), 'gif');
	assert.equal(imageExtension('image/tiff'), 'tiff');
	assert.equal(imageExtension('IMAGE/BMP'), 'bmp');
	assert.equal(imageExtension('image/svg+xml'), 'svg');
	assert.equal(imageExtension('image/x-exr'), '');
	assert.equal(imageExtension(''), '');

	assert.equal(mediaContainerMime('wav'), 'audio/wav');
	assert.equal(mediaContainerMime('opus'), 'audio/ogg');
	assert.equal(mediaContainerMime('mkv'), 'video/x-matroska');
	assert.equal(mediaContainerMime('mp4'), 'video/mp4');
	assert.equal(mediaContainerMime('xyz'), 'application/octet-stream');
	assert.equal(mediaContainerMime(''), 'application/octet-stream');
});

/*
 * PNG and WebP are the two canvas formats that can also move, and canvas.toBlob would keep only the
 * first frame. Spotting the animation is what sends those files to ImageMagick instead.
 */
test('metadata scrubber spots the animated PNG and WebP a canvas would flatten', () => {
	assert.equal(isAnimatedRaster(apngBytes(), 'image/png'), true);
	assert.equal(isAnimatedRaster(apngBytes(), 'image/apng'), true);
	assert.equal(isAnimatedRaster(animatedWebpBytes(), 'image/webp'), true);

	/* The committed stills carry a colour profile but no frames, so they stay on the canvas path. */
	assert.equal(isAnimatedRaster(fixture('tiny-photo.png'), 'image/png'), false);
	assert.equal(isAnimatedRaster(fixture('tiny-photo.webp'), 'image/webp'), false);
	assert.equal(isAnimatedRaster(fixture('tiny-photo.jpg'), 'image/jpeg'), false);
	assert.equal(isAnimatedRaster(new Uint8Array(fixture('tiny-photo.png')), 'image/png'), false);

	/* An animated GIF is never asked about: it goes to ImageMagick on format alone. */
	assert.equal(isAnimatedRaster(gifBytes({ frames: 4 }), 'image/gif'), false);
	assert.equal(isAnimatedRaster(new Uint8Array(0), 'image/png'), false);
	assert.equal(isAnimatedRaster(null, 'image/png'), false);
	assert.equal(isAnimatedRaster('not bytes', 'image/webp'), false);
});

/*
 * SVG metadata is markup, so it is cut out of the text: rasterising the file would answer a request
 * for a scrubbed SVG with a picture of one.
 */
test('metadata scrubber strips the metadata out of SVG markup and keeps the drawing', () => {
	const source = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>',
		'<!-- Created with Inkscape by Jane Doe -->',
		'<svg xmlns="http://www.w3.org/2000/svg" xmlns:dc="http://purl.org/dc/elements/1.1/"',
		'  xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"',
		'  inkscape:version="1.3" sodipodi:docname="holiday-plan.svg" width="20" height="10">',
		'  <metadata id="metadata7"><rdf:RDF><dc:creator>Jane Doe</dc:creator></rdf:RDF></metadata>',
		'  <sodipodi:namedview inkscape:current-layer="layer1"/>',
		'  <x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><dc:title>Holiday</dc:title></rdf:RDF></x:xmpmeta>',
		'  <title>Blue dot</title>',
		'  <circle cx="10" cy="5" r="4" fill="#2f80ed"/>',
		'</svg>',
	].join('\n');
	const stripped = stripSvgMetadata(source);

	for (const secret of ['Jane Doe', 'holiday-plan.svg', 'xpacket', 'inkscape:version', 'sodipodi:docname', '<metadata', 'xmpmeta', 'rdf:RDF', '<!--']) {
		assert.ok(!stripped.includes(secret), `${secret} must not survive the scrub`);
	}

	/* The picture itself and the accessible name stay: those are content, not provenance. */
	assert.ok(stripped.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
	assert.ok(stripped.includes('<circle cx="10" cy="5" r="4" fill="#2f80ed"/>'));
	assert.ok(stripped.includes('<title>Blue dot</title>'));
	assert.ok(stripped.includes('xmlns="http://www.w3.org/2000/svg"'));
	assert.ok(stripped.trimEnd().endsWith('</svg>'));

	/* A self-closing metadata element and a plain file both have to survive the pass. */
	assert.equal(stripSvgMetadata('<svg><metadata/><rect width="1" height="1"/></svg>'), '<svg><rect width="1" height="1"/></svg>');
	assert.equal(stripSvgMetadata('<svg><rect width="1" height="1"/></svg>'), '<svg><rect width="1" height="1"/></svg>');
	assert.equal(stripSvgMetadata(''), '');
	assert.equal(stripSvgMetadata(null), '');
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

/* A canvas holds one frame, so a GIF that plays has to be sent down the FFmpeg path instead. */
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

/*
 * The result panel reports the frames of the GIF the tool wrote, so the count has to come from the
 * produced bytes. Truncated or foreign bytes report what is really there instead of a guess.
 */
test('watermarker counts the frames a GIF plays', () => {
	assert.equal(countGifFrames(gifBytes()), 1);
	assert.equal(countGifFrames(gifBytes({ frames: 3 })), 3);
	assert.equal(countGifFrames(gifBytes({ frames: 12, loop: true })), 12);
	/* A local colour table full of 0x2c bytes must be skipped, not counted as extra frames. */
	assert.equal(countGifFrames(gifBytes({ frames: 4, localTable: true })), 4);
	assert.equal(countGifFrames(gifBytes({ localTable: true })), 1);

	assert.equal(countGifFrames(gifBytes({ frames: 2 }).subarray(0, 30)), 1);
	assert.equal(countGifFrames(fixture('tiny-photo.png')), 0);
	assert.equal(countGifFrames(fixture('tiny-photo.jpg')), 0);
	assert.equal(countGifFrames(new Uint8Array(0)), 0);
	assert.equal(countGifFrames(null), 0);
	assert.equal(countGifFrames('not bytes'), 0);
});

/*
 * An animated GIF is watermarked by FFmpeg and written back as a GIF: the overlay is the second
 * input so it lies over every frame of the first, and the palette is built from the stamped frames
 * so the watermark colours survive quantisation. Nothing in the run may reduce it to one picture.
 */
test('watermarker builds an FFmpeg run that stamps every GIF frame and writes a GIF back', () => {
	const args = buildAnimatedGifArgs('input-7.gif', 'watermark-7.png', 'output-7.gif');

	assert.deepEqual(args, [
		'-i', 'input-7.gif',
		'-i', 'watermark-7.png',
		'-filter_complex', [
			'[0:v][1:v]overlay=0:0:format=auto[stamped]',
			'[stamped]split[colours][frames]',
			'[colours]palettegen=stats_mode=full[palette]',
			'[frames][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle',
		].join(';'),
		'-loop', '0',
		'-gifflags', '+transdiff',
		'-y', 'output-7.gif',
	]);
	assert.equal(args.at(-1), 'output-7.gif');

	for (const flattening of ['-frames:v', '-vframes', '-update', '-f', 'image2']) {
		assert.equal(args.includes(flattening), false, `${flattening} would export a single frame`);
	}

	const filter = buildAnimatedGifFilter();
	assert.equal(filter, buildAnimatedGifArgs('a.gif', 'b.png', 'c.gif')[5]);
	/* The GIF is input 0 and the still watermark input 1, so the stamp lands on the animation. */
	assert.match(filter, /\[0:v\]\[1:v\]overlay=0:0/);
	assert.match(filter, /\[stamped\]split\[colours\]\[frames\]/);
	assert.match(filter, /\[colours\]palettegen[^[]*\[palette\]/);
	assert.match(filter, /\[frames\]\[palette\]paletteuse/);
	/* No fps filter: resampling the timeline would drop or duplicate the frames that arrived. */
	assert.equal(filter.includes('fps='), false);
	assert.equal(filter.includes('select='), false);
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
