import test from 'node:test';
import assert from 'node:assert/strict';

import { convert } from 'pandoc-wasm';
import {
	DOCUMENT_OUTPUT_PROFILES,
	buildOutputName,
	buildPandocInputOptions,
	buildPandocOptions,
	createTextPdf,
	detectInputFormat,
	firstPandocWarning,
	isBinaryInput,
} from '../src/lib/tools/document-converter.js';
import {
	createOutputName,
	fileExtension,
	formatFrames,
	formatOutputMeta,
} from '../src/lib/tools/image-format-converter.js';
import { aup3OutputName } from '../src/lib/tools/aup3-browser.js';
import {
	createWavHeader,
	createWavStreamEncoder,
	encodeWav,
} from '../src/lib/tools/audio-codecs/wav.js';

const markdown = '# Conversion test\n\nA paragraph with **bold text** and math $x^2 + y^2$.\n';
const profile = (value) => DOCUMENT_OUTPUT_PROFILES.find((candidate) => candidate.value === value);

const latin1 = (bytes) => {
	let text = '';
	for (const byte of bytes) text += String.fromCharCode(byte);
	return text;
};

const pdfBytes = async (blob) => new Uint8Array(await blob.arrayBuffer());
const pdfPageCount = (bytes) => latin1(bytes).match(/\/Type\s*\/Page[^s]/g)?.length || 0;

test('document converter maps the remaining source extensions to pandoc readers', () => {
	assert.equal(detectInputFormat('notes.markdown'), 'markdown');
	assert.equal(detectInputFormat('index.htm'), 'html');
	assert.equal(detectInputFormat('manual.rst'), 'rst');
	assert.equal(detectInputFormat('contract.DOCX'), 'docx');
	assert.equal(detectInputFormat('contract.odt'), 'odt');
	assert.equal(detectInputFormat('memo.rtf'), 'rtf');
	assert.equal(detectInputFormat(''), 'markdown');
	assert.equal(isBinaryInput(undefined, 'markdown'), false);
	assert.equal(isBinaryInput({ type: 'application/vnd.oasis.opendocument.text' }, 'markdown'), true);
	assert.equal(isBinaryInput({}, 'odt'), true);
	assert.equal(buildOutputName('README', '.pdf'), 'README.pdf');
	assert.equal(buildOutputName(null, '.md'), 'converted-document.md');
	assert.deepEqual(buildPandocInputOptions('epub', 'book.epub'), { 'input-files': ['book.epub'] });
	assert.deepEqual(buildPandocInputOptions('rst', 'manual.rst'), {});
});

test('only the binary profiles ask pandoc for an output file', () => {
	for (const outputProfile of DOCUMENT_OUTPUT_PROFILES) {
		const options = buildPandocOptions(outputProfile, `output${outputProfile.extension}`);
		assert.equal(options.to, outputProfile.format);
		assert.equal('output-file' in options, Boolean(outputProfile.binary), `${outputProfile.label} output-file`);
	}
	assert.deepEqual(DOCUMENT_OUTPUT_PROFILES.filter((item) => item.binary).map((item) => item.value), ['docx', 'odt', 'epub']);
});

test('createTextPdf writes a real PDF and grows a page at a time', async () => {
	const empty = createTextPdf('');
	const emptyBytes = await pdfBytes(empty);
	assert.equal(empty.type, 'application/pdf');
	assert.equal(latin1(emptyBytes.subarray(0, 5)), '%PDF-');
	assert.equal(pdfPageCount(emptyBytes), 1);

	const single = await pdfBytes(createTextPdf('First line\n\tindented line', 'Short document'));
	assert.equal(latin1(single.subarray(0, 5)), '%PDF-');
	assert.equal(pdfPageCount(single), 1);

	const long = await pdfBytes(createTextPdf(Array.from({ length: 200 }, (_, index) => `Line ${index}`).join('\n')));
	assert.ok(pdfPageCount(long) > 1, 'a 200-line document needs more than one page');
	assert.ok(long.byteLength > single.byteLength);
});

test('the PDF profile turns pandoc plain text into PDF bytes', async () => {
	const pdfProfile = profile('pdf');
	const result = await convert({ from: 'markdown', ...buildPandocOptions(pdfProfile, `output${pdfProfile.extension}`) }, markdown, {});
	assert.equal(result.stderr, '');
	assert.match(result.stdout, /Conversion test/);

	const bytes = await pdfBytes(createTextPdf(result.stdout, buildOutputName('conversion-test.md', pdfProfile.extension)));
	assert.equal(latin1(bytes.subarray(0, 5)), '%PDF-');
	assert.equal(pdfPageCount(bytes), 1);
});

test('binary profiles leave stdout empty and return their container in result.files', async () => {
	const expectations = [
		['docx', 'word/document.xml'],
		['odt', 'application/vnd.oasis.opendocument.text'],
		['epub', 'application/epub+zip'],
	];

	for (const [value, marker] of expectations) {
		const outputProfile = profile(value);
		const outputName = `output${outputProfile.extension}`;
		const result = await convert({ from: 'markdown', ...buildPandocOptions(outputProfile, outputName) }, markdown, {});

		// The converter only falls through to result.files when stdout is empty, so an
		// empty stdout is what keeps the DOCX/ODT/EPUB downloads binary.
		assert.equal(result.stdout, '', `${outputProfile.label} writes nothing to stdout`);
		const output = result.files[outputName];
		assert.ok(output instanceof Blob, `${outputProfile.label} returns a Blob`);
		const bytes = new Uint8Array(await output.arrayBuffer());
		assert.deepEqual(Array.from(bytes.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04], `${outputProfile.label} is a zip container`);
		assert.ok(latin1(bytes).includes(marker), `${outputProfile.label} contains ${marker}`);
	}
});

test('a corrupt DOCX leaves pandoc without output but with an explanatory stderr', async () => {
	// The converter reports `result.stderr` when no output arrives; a generic
	// "Unknown error" would hide the only explanation pandoc produced.
	const fileName = 'corrupt.docx';
	const corrupt = new Blob([Uint8Array.of(0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8)]);
	const outputProfile = profile('html');
	const outputName = `output${outputProfile.extension}`;
	const result = await convert({
		from: 'docx',
		...buildPandocInputOptions('docx', fileName),
		...buildPandocOptions(outputProfile, outputName),
	}, null, { [fileName]: corrupt });

	assert.equal(result.stdout, '');
	assert.equal(result.files[outputName], undefined);
	assert.match(result.stderr, /couldn't unpack docx container/);
	assert.equal(result.stderr.split('\n').filter(Boolean).length, 1);
});

test('pandoc reports the dropped resources the status line now repeats', async () => {
	const outputProfile = profile('docx');
	const outputName = `output${outputProfile.extension}`;
	const result = await convert(
		{ from: 'markdown', ...buildPandocOptions(outputProfile, outputName) },
		'# Report\n\n![Quarterly chart](chart.png)\n',
		{},
	);

	assert.equal(result.stderr, '');
	assert.ok(result.files[outputName] instanceof Blob);
	assert.equal(result.warnings.length, 1);
	assert.equal(result.warnings[0].type, 'CouldNotFetchResource');
	assert.match(result.warnings[0].pretty, /chart\.png/);

	// The DOCX is written either way, so this text is the only thing that separates
	// a document that lost its image from one that converted cleanly.
	assert.equal(
		firstPandocWarning(result.warnings),
		'Could not fetch resource chart.png: replacing image with description',
	);

	const clean = await convert({ from: 'markdown', ...buildPandocOptions(outputProfile, outputName) }, markdown, {});
	assert.deepEqual(clean.warnings, []);
	assert.equal(firstPandocWarning(clean.warnings), '');
});

test('firstPandocWarning reports the first warning that carries text', () => {
	assert.equal(firstPandocWarning(undefined), '');
	assert.equal(firstPandocWarning([]), '');
	assert.equal(firstPandocWarning('not a list'), '');
	assert.equal(firstPandocWarning([{ pretty: '  Could not fetch resource logo.svg  ' }]), 'Could not fetch resource logo.svg');
	assert.equal(firstPandocWarning([{ message: 'replacing image with description' }]), 'replacing image with description');
	assert.equal(firstPandocWarning([{ pretty: 'pretty wins', message: 'message loses' }]), 'pretty wins');
	assert.equal(firstPandocWarning(['a bare string warning']), 'a bare string warning');
	assert.equal(firstPandocWarning([{}, null, { pretty: '   ' }, { pretty: 'the first real one' }]), 'the first real one');
});

test('image converter output names and frame labels survive odd input', () => {
	assert.equal(createOutputName('holiday.photo.JPG', 'png'), 'holiday.photo.png');
	assert.equal(createOutputName('noextension', 'gif'), 'noextension.gif');
	assert.equal(createOutputName(null, 'webp'), 'converted-image.webp');
	assert.equal(createOutputName('.hidden', 'png'), 'converted-image.png');
	assert.equal(fileExtension('archive'), '.image');
	assert.equal(fileExtension(null), '.image');
	assert.equal(fileExtension('scan.v2.TIFF'), '.tiff');

	const copy = { singleFrame: '1 frame', multipleFrames: '{count} frames' };
	assert.equal(formatFrames(0, copy), '1 frame');
	assert.equal(formatFrames(Number.NaN, copy), '1 frame');
	assert.equal(formatFrames(undefined, copy), '1 frame');
	assert.equal(formatFrames(2, copy), '2 frames');
	assert.equal(formatFrames(3, { singleFrame: '1 frame', multipleFrames: '{count} of {total} frames' }), '3 of  frames');
});

test('the result panel describes the written file and never invents its geometry', () => {
	const copy = { imageMeta: '{width} x {height}px | {frames} | {size}', singleFrame: '1 frame', multipleFrames: '{count} frames' };

	// An animated GIF written as PNG keeps one frame, so the panel reports the PNG.
	assert.equal(formatOutputMeta({ width: 96, height: 64, frames: 1 }, '7 KB', copy), '96 x 64px | 1 frame | 7 KB');
	assert.equal(formatOutputMeta({ width: 12, height: 10, frames: 4 }, '1 KB', copy), '12 x 10px | 4 frames | 1 KB');
	assert.equal(formatOutputMeta({ width: 0, height: 0, frames: 2 }, '1 KB', copy), '? x ?px | 2 frames | 1 KB');

	// Bytes the converter could not read back leave only the size it measured itself.
	assert.equal(formatOutputMeta(null, '25 KB', copy), '25 KB');
	assert.equal(formatOutputMeta({ width: 96, height: 64, frames: 0 }, '25 KB', copy), '25 KB');
	assert.equal(formatOutputMeta({ width: 96, height: 64, frames: Number.NaN }, '25 KB', copy), '25 KB');
});

test('the AUP3 helper names every download the .aup3 picker can hand it', () => {
	// The tool used to keep a private copy that stripped the last extension instead
	// of the .aup3 suffix; both agree on every name that picker produces.
	const stripLastExtension = (name) => `${String(name || '').replace(/\.[^.]+$/, '') || 'audacity-project'}.wav`;

	for (const name of ['session.aup3', 'session.AUP3', 'Browser project.aup3', 'live.set.2.aup3', 'float mix.aup3', '.aup3', '']) {
		assert.equal(aup3OutputName(name), stripLastExtension(name), name);
	}

	assert.equal(aup3OutputName('live.set.2.aup3'), 'live.set.2.wav');
	assert.equal(aup3OutputName('  spaced project.aup3  '), 'spaced project.wav');
	assert.equal(aup3OutputName(null), 'audacity-project.wav');
});

test('encodeWav writes the canonical 16-bit RIFF file the AUP3 tool downloads', () => {
	const wav = encodeWav([Float32Array.of(0.25, -0.5, 0.75, 0)], { sampleRate: 48000, bitDepth: 16, dither: false });
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

	assert.equal(wav.byteLength, 52);
	assert.equal(latin1(wav.subarray(0, 4)), 'RIFF');
	assert.equal(view.getUint32(4, true), 44);
	assert.equal(latin1(wav.subarray(8, 12)), 'WAVE');
	assert.equal(latin1(wav.subarray(12, 16)), 'fmt ');
	assert.equal(view.getUint32(16, true), 16);
	assert.equal(view.getUint16(20, true), 1);
	assert.equal(view.getUint16(22, true), 1);
	assert.equal(view.getUint32(24, true), 48000);
	assert.equal(view.getUint32(28, true), 96000);
	assert.equal(view.getUint16(32, true), 2);
	assert.equal(view.getUint16(34, true), 16);
	assert.equal(latin1(wav.subarray(36, 40)), 'data');
	assert.equal(view.getUint32(40, true), 8);
	assert.deepEqual(
		[0, 1, 2, 3].map((index) => view.getInt16(44 + index * 2, true)),
		[8192, -16384, 24576, 0],
	);
});

test('the streaming encoder emits the header first and matches the collected file', () => {
	const chunks = [];
	const encoder = createWavStreamEncoder({
		sampleRate: 48000,
		channelCount: 1,
		totalFrames: 4,
		bitDepth: 16,
		dither: false,
		collect: false,
		onChunk: (chunk, info) => chunks.push({ header: info.header, frameOffset: info.frameOffset, bytes: chunk }),
	});

	assert.equal(encoder.sampleRate, 48000);
	assert.equal(encoder.channelCount, 1);
	assert.equal(encoder.bitDepth, 16);
	assert.equal(chunks.length, 1);
	assert.equal(chunks[0].header, true);
	assert.equal(chunks[0].bytes.byteLength, 44);

	encoder.write([Float32Array.of(0.25, -0.5)]);
	assert.equal(encoder.writtenFrames, 2);
	encoder.write([Float32Array.of(0.75, 0)]);
	assert.equal(encoder.writtenFrames, 4);
	assert.deepEqual(chunks.map((chunk) => chunk.frameOffset), [0, 0, 2]);

	const summary = encoder.finalize();
	assert.deepEqual(Object.keys(summary).sort(), ['byteLength', 'frames', 'header']);
	assert.equal(summary.byteLength, 52);
	assert.equal(summary.frames, 4);
	assert.equal(encoder.byteLength, 52);

	const streamed = new Uint8Array(52);
	let offset = 0;
	for (const chunk of chunks) {
		streamed.set(chunk.bytes, offset);
		offset += chunk.bytes.byteLength;
	}
	assert.deepEqual(streamed, encodeWav([Float32Array.of(0.25, -0.5, 0.75, 0)], { sampleRate: 48000, bitDepth: 16, dither: false }));
});

test('float output switches the WAV format tag and keeps the samples untouched', () => {
	const wav = encodeWav([Float32Array.of(0.5, -0.5, 1.5, Number.NaN)], { sampleRate: 44100, float: true, bitDepth: 16 });
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

	assert.equal(wav.byteLength, 60);
	assert.equal(view.getUint16(20, true), 3);
	assert.equal(view.getUint16(34, true), 32);
	assert.equal(view.getUint32(24, true), 44100);
	assert.equal(view.getUint32(40, true), 16);
	assert.deepEqual(
		[0, 1, 2, 3].map((index) => view.getFloat32(44 + index * 4, true)),
		[0.5, -0.5, 1.5, 0],
	);
});

test('16-bit output clamps out-of-range samples and applies the selected dither', () => {
	const clamped = encodeWav([Float32Array.of(2, -2, Number.POSITIVE_INFINITY)], { bitDepth: 16, dither: 'none' });
	const clampedView = new DataView(clamped.buffer, clamped.byteOffset, clamped.byteLength);
	assert.deepEqual(
		[0, 1, 2].map((index) => clampedView.getInt16(44 + index * 2, true)),
		[32767, -32768, 0],
	);

	// random() - random() over this cycle is always 0.8, so every dither mode has a
	// deterministic effect on a sample that sits 0.3 LSB above zero.
	const nudge = 0.3 / 32768;
	const dithered = (dither) => {
		const values = [0.9, 0.1];
		let call = 0;
		const wav = encodeWav([Float32Array.of(nudge, nudge, nudge)], {
			bitDepth: 16,
			dither,
			random: () => values[call++ % values.length],
		});
		const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
		return [0, 1, 2].map((index) => view.getInt16(44 + index * 2, true));
	};

	assert.deepEqual(dithered(false), [0, 0, 0]);
	assert.deepEqual(dithered('triangular'), [1, 1, 1]);
	assert.deepEqual(dithered('triangular-highpass'), [1, 0, 0]);
});

test('the integer depths write their own sample widths', () => {
	const wav24 = encodeWav([Float32Array.of(0.5)], { dither: false });
	const view24 = new DataView(wav24.buffer, wav24.byteOffset, wav24.byteLength);
	assert.equal(wav24.byteLength, 47);
	assert.equal(view24.getUint16(34, true), 24);
	assert.equal(view24.getUint16(32, true), 3);
	assert.equal(view24.getUint32(28, true), 144000);
	assert.deepEqual(Array.from(wav24.subarray(44, 47)), [0, 0, 64]);

	const wav32 = encodeWav([Float32Array.of(0.5)], { bitDepth: 32, dither: false });
	const view32 = new DataView(wav32.buffer, wav32.byteOffset, wav32.byteLength);
	assert.equal(wav32.byteLength, 48);
	assert.equal(view32.getUint16(20, true), 1);
	assert.equal(view32.getUint16(34, true), 32);
	assert.equal(view32.getInt32(44, true), 1073741824);
});

test('an AudioBuffer-like input is read through getChannelData', () => {
	const wav = encodeWav({
		numberOfChannels: 2,
		getChannelData: (index) => (index === 0 ? Float32Array.of(1, 0) : Float32Array.of(-1, 0)),
	}, { sampleRate: 8000, bitDepth: 16, dither: false });
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

	assert.equal(wav.byteLength, 52);
	assert.equal(view.getUint16(22, true), 2);
	assert.equal(view.getUint32(28, true), 32000);
	assert.equal(view.getUint16(32, true), 4);
	assert.deepEqual(
		[0, 1, 2, 3].map((index) => view.getInt16(44 + index * 2, true)),
		[32767, -32768, 0, 0],
	);
});

test('metadata rides along as a trailing RIFF id3 chunk', () => {
	const wav = encodeWav([Float32Array.of(0)], {
		sampleRate: 8000,
		bitDepth: 16,
		dither: false,
		metadata: { title: 'Dry mix' },
	});
	const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

	assert.equal(wav.byteLength, 82);
	assert.equal(view.getUint32(4, true), 74);
	assert.equal(view.getUint32(40, true), 2);
	assert.equal(latin1(wav.subarray(46, 50)), 'id3 ');
	assert.equal(view.getUint32(50, true), 28);
	assert.equal(latin1(wav.subarray(54, 57)), 'ID3');
	assert.ok(latin1(wav.subarray(54)).includes('TIT2'));
	assert.ok(latin1(wav.subarray(54)).includes('Dry mix'));
	assert.equal(encodeWav([Float32Array.of(0)], { bitDepth: 16, dither: false, metadata: {} }).byteLength, 46);
});

test('asynchronous chunk consumers are awaited through settled()', async () => {
	const seen = [];
	const encoder = createWavStreamEncoder({
		channelCount: 1,
		totalFrames: 1,
		bitDepth: 16,
		dither: false,
		collect: false,
		onChunk: async (chunk) => {
			await Promise.resolve();
			seen.push(chunk.byteLength);
		},
	});

	encoder.write([Float32Array.of(0)]);
	encoder.finalize();
	assert.deepEqual(seen, []);
	await encoder.settled();
	assert.deepEqual(seen, [44, 2]);
});

test('the encoder refuses malformed writes and a second finalize', () => {
	assert.throws(() => encodeWav([]), /Expected 1 channels, received 0\./);
	assert.throws(
		() => encodeWav([Float32Array.of(0, 1), Float32Array.of(0)], { channelCount: 2 }),
		/All WAV input channels must contain the same number of frames\./,
	);

	const stereo = createWavStreamEncoder({ channelCount: 2, totalFrames: 2, bitDepth: 16 });
	assert.throws(() => stereo.write([Float32Array.of(0, 0)]), /Expected 2 channels, received 1\./);
	assert.throws(
		() => stereo.write([Float32Array.of(0, 0, 0), Float32Array.of(0, 0, 0)]),
		/WAV input exceeds the declared total frame count\./,
	);
	assert.throws(() => stereo.finalize(), /Expected 2 WAV frames, received 0\./);

	const mono = createWavStreamEncoder({ channelCount: 1, totalFrames: 1, bitDepth: 16 });
	mono.write([Float32Array.of(0)]);
	mono.finalize();
	assert.throws(() => mono.write([Float32Array.of(0)]), /The WAV encoder has already been finalized\./);
	assert.throws(() => mono.finalize(), /The WAV encoder has already been finalized\./);
});

test('createWavHeader falls back to sane values and guards the 4 GiB ceiling', () => {
	const header = createWavHeader();
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	assert.equal(header.byteLength, 44);
	assert.equal(view.getUint32(4, true), 36);
	assert.equal(view.getUint16(20, true), 1);
	assert.equal(view.getUint16(22, true), 2);
	assert.equal(view.getUint32(24, true), 48000);
	assert.equal(view.getUint16(34, true), 24);
	assert.equal(view.getUint32(40, true), 0);

	const fallback = new DataView(createWavHeader({ sampleRate: -1, channelCount: 0, bitDepth: 7, totalFrames: -5 }).buffer);
	assert.equal(fallback.getUint32(24, true), 48000);
	assert.equal(fallback.getUint16(22, true), 2);
	assert.equal(fallback.getUint16(34, true), 24);
	assert.equal(fallback.getUint32(40, true), 0);

	const floatHeader = new DataView(createWavHeader({ float: true, bitDepth: 16, channelCount: 1, sampleRate: 8000, totalFrames: 2 }).buffer);
	assert.equal(floatHeader.getUint16(20, true), 3);
	assert.equal(floatHeader.getUint16(34, true), 32);
	assert.equal(floatHeader.getUint32(40, true), 8);
	assert.equal(floatHeader.getUint32(4, true), 44);

	assert.throws(
		() => createWavHeader({ totalFrames: 2 ** 31, channelCount: 2, bitDepth: 16 }),
		/Classic WAV output cannot exceed 4 GiB\./,
	);
});
