import test from 'node:test';
import assert from 'node:assert/strict';

import {
	chanceProbability,
	combination,
	createTrials,
	fileExtension,
	formatProbability,
	formatTime,
} from '../src/lib/tools/abx-tester.js';
import {
	buildOutputName as buildDocumentOutputName,
	detectInputFormat,
	isBinaryInput,
} from '../src/lib/tools/document-converter.js';
import { formatBytes, formatTemplate } from '../src/lib/tools/format.js';
import {
	buildConversionArgs,
	buildOutputName as buildMediaOutputName,
	detectMediaKind,
	filterProfilesForMediaKind,
	getFileExtension,
	inputExtension,
} from '../src/lib/tools/video-audio-converter.js';

const profiles = [
	{ value: 'wav', label: 'WAV', extension: '.wav', mimeType: 'audio/wav', kind: 'audio', codec: 'pcm_s16le', args: ['-ar', '48000'] },
	{ value: 'mp4', label: 'MP4', extension: '.mp4', mimeType: 'video/mp4', kind: 'video', codec: 'copy', audioCodec: 'aac', audioArgs: ['-b:a', '192k'] },
	{ value: 'webm', label: 'WebM', extension: '.webm', mimeType: 'video/webm', kind: 'video', codec: 'copy', audioCodec: 'libopus', audioArgs: ['-b:a', '192k', '-ar', '48000'] },
];

test('shared formatting helpers keep compact UI-friendly labels', () => {
	assert.equal(formatTemplate('Selected {name}: {size}', { name: 'clip.wav', size: '1 MB' }), 'Selected clip.wav: 1 MB');
	assert.equal(formatTemplate('Missing {value}', {}), 'Missing ');
	assert.equal(formatBytes(0), '0 B');
	assert.equal(formatBytes(999), '999 B');
	assert.equal(formatBytes(1024), '1.0 KB');
	assert.equal(formatBytes(12 * 1024), '12 KB');
	assert.equal(formatBytes(3 * 1024 ** 2), '3.0 MB');
});

test('video/audio converter detects media type from mime type and extension', () => {
	assert.equal(detectMediaKind({ name: 'mix.WAV', type: '' }), 'audio');
	assert.equal(detectMediaKind({ name: 'camera.mov', type: '' }), 'video');
	assert.equal(detectMediaKind({ name: 'upload.bin', type: 'audio/mpeg' }), 'audio');
	assert.equal(detectMediaKind({ name: 'upload.bin', type: 'video/mp4' }), 'video');
	assert.equal(detectMediaKind({ name: 'notes.txt', type: '' }), 'unknown');
	assert.equal(getFileExtension('archive.TAR.GZ'), 'gz');
});

test('video/audio converter filters profiles based on source media type', () => {
	assert.deepEqual(filterProfilesForMediaKind(profiles, 'audio').map((profile) => profile.value), ['wav']);
	assert.deepEqual(filterProfilesForMediaKind(profiles, 'video').map((profile) => profile.value), ['wav', 'mp4', 'webm']);
	assert.deepEqual(filterProfilesForMediaKind(profiles, 'unknown').map((profile) => profile.value), ['wav', 'mp4', 'webm']);
});

test('video/audio converter builds ffmpeg args for audio extraction and remuxing', () => {
	assert.deepEqual(
		buildConversionArgs('input.bin', 'output.wav', { name: 'source.mp3', type: 'audio/mpeg' }, profiles[0]),
		['-i', 'input.bin', '-vn', '-c:a', 'pcm_s16le', '-ar', '48000', '-y', 'output.wav'],
	);
	assert.deepEqual(
		buildConversionArgs('input.bin', 'output.wav', { name: 'source.mp4', type: 'video/mp4' }, profiles[0]),
		['-i', 'input.bin', '-vn', '-map', '0:a:0?', '-c:a', 'pcm_s16le', '-ar', '48000', '-y', 'output.wav'],
	);
	assert.deepEqual(
		buildConversionArgs('input.bin', 'output.mp4', { name: 'source.mov', type: 'video/quicktime' }, profiles[1]),
		['-i', 'input.bin', '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-y', 'output.mp4'],
	);
	assert.equal(buildMediaOutputName('cut.final.mp4', '.wav'), 'cut.final.wav');
	assert.equal(buildMediaOutputName('', '.mp3'), 'converted-media.mp3');
	assert.equal(inputExtension({ name: 'clip.mp4' }), '.bin');
});

test('document converter maps source files to pandoc input formats', () => {
	assert.equal(detectInputFormat('README.md'), 'markdown');
	assert.equal(detectInputFormat('page.HTML'), 'html');
	assert.equal(detectInputFormat('notes.txt'), 'markdown');
	assert.equal(detectInputFormat('paper.tex'), 'latex');
	assert.equal(detectInputFormat('guide.adoc'), 'asciidoc');
	assert.equal(detectInputFormat('book.epub'), 'epub');
	assert.equal(detectInputFormat('unknown'), 'markdown');
});

test('document converter detects binary pandoc inputs and output names', () => {
	assert.equal(isBinaryInput({ type: '' }, 'docx'), true);
	assert.equal(isBinaryInput({ type: 'application/epub+zip' }, 'markdown'), true);
	assert.equal(isBinaryInput({ type: 'text/markdown' }, 'markdown'), false);
	assert.equal(buildDocumentOutputName('draft.v2.md', '.html'), 'draft.v2.html');
	assert.equal(buildDocumentOutputName('', '.txt'), 'converted-document.txt');
});

test('abx helpers produce deterministic trials and statistics', () => {
	const randomValues = [0.1, 0.7, 0.49, 0.5];
	const trials = createTrials(4, () => randomValues.shift());
	assert.deepEqual(trials, [{ xIs: 'A' }, { xIs: 'B' }, { xIs: 'A' }, { xIs: 'B' }]);
	assert.equal(combination(8, 2), 28);
	assert.equal(chanceProbability(8, 8), 1 / 256);
	assert.equal(chanceProbability(0, 8), 1);
	assert.equal(formatProbability(0.05), '<0.1');
	assert.equal(formatProbability(12.345), '12.3');
	assert.equal(formatProbability(2.345), '2.35');
	assert.equal(formatTime(65.9), '1:05');
	assert.equal(fileExtension('SONG.FLAC'), '.flac');
	assert.equal(fileExtension('no-extension'), '.audio');
});
