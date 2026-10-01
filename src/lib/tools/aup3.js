import { createAudacitySampleReader, getAudacityResamplingRadius } from './audacity-resampler.js';

const FIELD = Object.freeze({
	CHAR_SIZE: 0,
	START_TAG: 1,
	END_TAG: 2,
	STRING: 3,
	INT: 4,
	BOOL: 5,
	LONG: 6,
	LONG_LONG: 7,
	SIZE_T: 8,
	FLOAT: 9,
	DOUBLE: 10,
	DATA: 11,
	RAW: 12,
	PUSH: 13,
	POP: 14,
	NAME: 15,
	BLOB: 16,
});

const SAMPLE_FORMAT = Object.freeze({
	INT16: 0x00020001,
	INT24: 0x00040001,
	FLOAT32: 0x0004000f,
});

const AUDACITY_APPLICATION_ID = 0x41554459;
const MAX_XML_DEPTH = 512;
const MAX_XML_FIELDS = 5_000_000;
const DEFAULT_MAX_DECODED_AUDIO_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_MIX_BYTES = 384 * 1024 * 1024;
const DEFAULT_MAX_AUDIO_FRAMES = DEFAULT_MAX_DECODED_AUDIO_BYTES / Float32Array.BYTES_PER_ELEMENT;

export class Aup3Error extends Error {
	constructor(message, code = 'AUP3_ERROR', options) {
		super(message, options);
		this.name = 'Aup3Error';
		this.code = code;
	}
}

/**
 * Decode Audacity's compact binary XML project description.
 *
 * The dictionary and document are consecutive token streams sharing the same
 * name table. A document may temporarily replace that table with PUSH/POP and
 * define local names inline.
 *
 * @param {ArrayBuffer | ArrayBufferView | number[]} dictionary
 * @param {ArrayBuffer | ArrayBufferView | number[]} document
 */
export function parseAup3BinaryXml(dictionary, document, options = {}) {
	const state = {
		charSize: 0,
		names: new Map(),
		nameStack: [],
		fieldCount: 0,
	};
	decodeDictionary(toBytes(dictionary), state);
	if (!state.charSize) {
		throw new Aup3Error('The AUP3 project dictionary has no character encoding.', 'INVALID_DICTIONARY');
	}
	if (state.nameStack.length) {
		throw new Aup3Error('The AUP3 project dictionary has unbalanced name scopes.', 'INVALID_DICTIONARY');
	}
	return decodeDocument(toBytes(document), state, options);
}

/**
 * Adapt the current AUP4 document profile for Audacity 3 without re-encoding
 * the audio, opaque extensions, raw XML records, or document-local name scopes.
 * Audacity checks the embedded XML version independently of the SQLite header.
 * https://github.com/audacity/audacity/blob/Audacity-3.7.9/libraries/lib-project-file-io/ProjectFileIO.cpp
 */
export function rewriteAup4ProjectForAup3(dictionary, document, options = {}) {
	const bytes = toBytes(document);
	const fields = new Map();
	const edits = [];
	const project = parseAup3BinaryXml(dictionary, bytes, {
		onStartTag({ node, end, charSize }) {
			fields.set(node, { attributes: [], insertionOffset: end, charSize });
		},
		onAttribute(field) {
			const entry = fields.get(field.node);
			entry.attributes.push(field);
			entry.insertionOffset = field.end;
			entry.charSize = field.charSize;
			// Audacity 3 has no FT_Blob token; these currently carry thumbnails.
			// Keep surrounding nodes and dictionaries, which older loaders ignore.
			if (field.type === FIELD.BLOB) edits.push({ start: field.fieldStart, end: field.end, bytes: new Uint8Array() });
		},
	});
	if (project.name !== 'project') {
		throw new Aup3Error('The Audacity document has no project root.', 'INVALID_PROJECT_XML');
	}
	const versionField = fields.get(project).attributes.findLast((field) => field.name === 'version');
	if (!versionField || !['1.3.0', '2.0.0'].includes(versionField.value)) {
		throw new Aup3Error(`Unsupported Audacity project XML version: ${versionField?.value}.`, 'UNSUPPORTED_AUP4_VERSION');
	}
	if (versionField.type !== FIELD.STRING) {
		throw new Aup3Error('The Audacity project version has an invalid encoding.', 'INVALID_PROJECT_XML');
	}
	if (versionField.value !== '1.3.0') {
		const replacement = bytes.slice(versionField.fieldStart, versionField.end);
		replacement.set(encodeAsciiXmlString('1.3.0', versionField.charSize), versionField.offset - versionField.fieldStart + 4);
		edits.push({ start: versionField.fieldStart, end: versionField.end, bytes: replacement });
	}
	const projectTempo = positiveFiniteAttribute(project, ['time_signature_tempo', 'tempo'], 120);
	let warnedTempoEditing = false;
	for (const [node, entry] of fields) {
		if (normalizedName(node.name) !== 'waveclip') continue;
		const timingFields = entry.attributes.filter((field) => ['cliptempo', 'clipstretchtomatchtempo'].includes(normalizedName(field.name)));
		if (!timingFields.length) continue;
		const rawTempo = positiveFiniteAttribute(node, ['rawaudiotempo'], Number.NaN);
		const ratio = positiveFiniteAttribute(node, ['clipstretchratio', 'stretchratio'], 1);
		const legacyTempoRatio = Number.isFinite(rawTempo) ? rawTempo / projectTempo : 1;
		const convertedRatio = clipStretch(node, projectTempo) / legacyTempoRatio;
		if (!Number.isFinite(convertedRatio) || convertedRatio <= 0) {
			throw new Aup3Error('The Audacity clip has invalid tempo or stretch data.', 'INVALID_PROJECT_XML');
		}
		if (convertedRatio !== ratio) {
			const ratioField = entry.attributes.findLast((field) => normalizedName(field.name) === 'clipstretchratio');
			if (ratioField) {
				const replacement = doubleXmlAttribute(ratioField.identifier, convertedRatio);
				edits.push({ start: ratioField.fieldStart, end: ratioField.end, bytes: replacement });
			} else {
				edits.push({ start: entry.insertionOffset, end: entry.insertionOffset, bytes: scopedDoubleXmlAttribute('clipStretchRatio', convertedRatio, entry.charSize) });
			}
		}
		const clipTempo = positiveFiniteAttribute(node, ['cliptempo'], Number.NaN);
		if (!warnedTempoEditing && (!attributeBoolean(node, 'clipstretchtomatchtempo', true)
			|| (Number.isFinite(clipTempo) && clipTempo !== projectTempo))) {
			// AU3 OnProjectTempoChange always stretches every clip, even if raw
			// tempo is absent (it initializes it). AU4's disabled matching and
			// independent clip tempo cannot retain their later edit behavior.
			// Preserve the current timing, and disclose that native limitation.
			// https://github.com/audacity/audacity/blob/Audacity-3.7.9/libraries/lib-wave-track/WaveClip.cpp#L545-L566
			options.onWarning?.({ code: 'AUP4_TEMPO_EDITING_CHANGED' });
			warnedTempoEditing = true;
		}
		// Bake AU4's current effective stretch into AU3's project-tempo ratio.
		// Removing the newer fields avoids applying the AU4 adjustment twice.
		for (const field of timingFields) edits.push({ start: field.fieldStart, end: field.end, bytes: new Uint8Array() });
	}
	return applyBinaryXmlEdits(bytes, edits);
}

function encodeAsciiXmlString(value, charSize) {
	const bytes = new Uint8Array(value.length * charSize);
	for (let index = 0; index < value.length; index += 1) bytes[index * charSize] = value.charCodeAt(index);
	return bytes;
}

function doubleXmlAttribute(identifier, value) {
	const bytes = new Uint8Array(15);
	const view = new DataView(bytes.buffer);
	bytes[0] = FIELD.DOUBLE;
	view.setUint16(1, identifier, true);
	view.setFloat64(3, value, true);
	view.setInt32(11, 8, true);
	return bytes;
}

function scopedDoubleXmlAttribute(name, value, charSize) {
	const encodedName = encodeAsciiXmlString(name, charSize);
	// A temporary dictionary makes the inserted name independent of existing
	// global and local IDs, then restores the exact original name scope.
	const bytes = new Uint8Array(1 + 5 + encodedName.length + 15 + 1);
	const view = new DataView(bytes.buffer);
	bytes[0] = FIELD.PUSH;
	bytes[1] = FIELD.NAME;
	view.setUint16(2, 0, true);
	view.setUint16(4, encodedName.length, true);
	bytes.set(encodedName, 6);
	bytes.set(doubleXmlAttribute(0, value), 6 + encodedName.length);
	bytes[bytes.length - 1] = FIELD.POP;
	return bytes;
}

function applyBinaryXmlEdits(source, edits) {
	edits.sort((left, right) => left.start - right.start || left.end - right.end);
	const length = edits.reduce((total, edit) => total + edit.bytes.length - (edit.end - edit.start), source.length);
	const bytes = new Uint8Array(length);
	let sourceOffset = 0;
	let destinationOffset = 0;
	for (const edit of edits) {
		if (edit.start < sourceOffset) throw new Aup3Error('Overlapping Audacity project edits.', 'INVALID_PROJECT_XML');
		bytes.set(source.subarray(sourceOffset, edit.start), destinationOffset);
		destinationOffset += edit.start - sourceOffset;
		bytes.set(edit.bytes, destinationOffset);
		destinationOffset += edit.bytes.length;
		sourceOffset = edit.end;
	}
	bytes.set(source.subarray(sourceOffset), destinationOffset);
	return bytes;
}

/**
 * Convert an sql.js AUP3 database into channel-aligned floating-point audio.
 *
 * @param {{ prepare: Function, exec: Function }} database
 * @param {{ fileName?: string, onProgress?: Function, maxDecodedAudioBytes?: number, maxMixBytes?: number }} [options]
 */
export async function decodeAup3Database(database, options = {}) {
	if (!database || typeof database.prepare !== 'function') {
		throw new TypeError('An open sql.js database is required.');
	}

	validateApplicationId(database);
	if (!tableExists(database, 'project')) {
		throw new Aup3Error('This SQLite file has no Audacity project data.', 'NOT_AUP3');
	}
	if (!tableExists(database, 'sampleblocks')) {
		throw new Aup3Error('The Audacity project has no sample-block table.', 'INVALID_DATABASE');
	}

	let source = 'project';
	let row = null;
	if (tableExists(database, 'autosave')) {
		row = readProjectRow(database, 'autosave');
		if (row?.dictionary.byteLength && row.document.byteLength) source = 'autosave';
		else row = null;
	}
	if (!row) row = readProjectRow(database, 'project');
	if (!row?.dictionary.byteLength || !row.document.byteLength) {
		throw new Aup3Error('The Audacity project description is empty.', 'INVALID_DATABASE');
	}

	const project = parseAup3BinaryXml(row.dictionary, row.document);
	if (normalizedName(project.name) !== 'project') {
		throw new Aup3Error('The Audacity document has no project root.', 'INVALID_PROJECT_XML');
	}
	const xmlVersion = attribute(project, 'version');
	if (!['1.3.0', '2.0.0'].includes(xmlVersion)) {
		throw new Aup3Error(`Unsupported Audacity project XML version: ${xmlVersion}.`, 'UNSUPPORTED_PROJECT_VERSION');
	}
	const blockStatement = database.prepare('SELECT sampleformat, samples FROM sampleblocks WHERE blockid = ? LIMIT 1');
	try {
		const result = await (options.structured ? decodeAup3ProjectStructure : renderAup3Project)(project, (blockId) => {
			blockStatement.reset();
			blockStatement.bind([blockId]);
			if (!blockStatement.step()) return null;
			const values = blockStatement.get();
			return { sampleFormat: Number(values[0]), samples: toBytes(values[1]) };
		}, options);
		const fileTitle = stripAup3Extension(options.fileName);
		return {
			...result,
			metadata: {
				...result.metadata,
				title: fileTitle || result.metadata.title,
				source,
			},
		};
	} finally {
		blockStatement.free();
	}
}

/**
 * Decode AUP3 into materialized tracks and clips without flattening the project
 * to a dry stereo mix. Unsupported nodes remain attached as opaque plain data.
 */
export async function decodeAup3ProjectStructure(root, loadBlock, options = {}) {
	const project = findProjectNode(root);
	if (!project) throw new Aup3Error('The AUP3 document has no project element.', 'INVALID_PROJECT_XML');
	const warnings = [];
	const warn = (message) => { if (!warnings.includes(message)) warnings.push(message); };
	const projectRate = sampleRate(attributeNumber(project, 'rate', 44_100));
	const projectTempo = firstFiniteAttribute(project, ['time_signature_tempo', 'tempo'], 120);
	const maxDecodedAudioBytes = positiveInteger(options.maxDecodedAudioBytes, DEFAULT_MAX_DECODED_AUDIO_BYTES);
	const maxAudioFrames = Math.floor(maxDecodedAudioBytes / Float32Array.BYTES_PER_ELEMENT);
	const trackNodes = findTrackNodes(project);
	const labelNodes = directChildren(project, 'labeltrack');
	if (!trackNodes.length && !labelNodes.length) throw new Aup3Error('The Audacity project contains no tracks.', 'NO_AUDIO');
	warnForUnsupportedProjectFeatures(project, warn);
	const routes = buildTrackRoutes(trackNodes, warn);
	const totalBlocks = trackNodes.reduce((total, track) => total + directChildren(track, 'waveclip')
		.reduce((clipTotal, clip) => clipTotal + directChildren(clip, 'sequence')
			.reduce((sequenceTotal, sequence) => sequenceTotal + directChildren(sequence, 'waveblock').length, 0), 0), 0);
	let completedBlocks = 0;
	let decodedSampleCount = 0;
	progress(options.onProgress, 0, 'reading');
	const physicalTracks = [];
	for (let trackIndex = 0; trackIndex < trackNodes.length; trackIndex += 1) {
		const node = trackNodes[trackIndex];
		const rate = sampleRate(attributeNumber(node, 'rate', projectRate));
		const track = {
			type: 'audio',
			name: attributeString(node, 'name', `Track ${trackIndex + 1}`),
			rate,
			route: routes[trackIndex].route,
			joinsPrevious: routes[trackIndex].joinsPrevious,
			gain: audioTrackGain(node),
			pan: clamp(finiteAttribute(node, 'pan', 0), -1, 1),
			mute: attributeBoolean(node, 'mute', false),
			solo: attributeBoolean(node, 'solo', false),
			sampleFormat: integerAttribute(node, 'sampleformat', SAMPLE_FORMAT.FLOAT32),
			displayMode: readLegacyDisplayMode(node),
			spectrogram: readLegacySpectrogram(node, rate),
			clips: [],
			opaqueExtensions: { aup3Track: clonePlain(node) },
		};
		for (const [clipIndex, clipNode] of directChildren(node, 'waveclip').entries()) {
			const sequenceNode = directChildren(clipNode, 'sequence')[0];
			if (!sequenceNode) continue;
			const stretch = clipStretch(clipNode, projectTempo);
			const samples = await decodeSequence(sequenceNode, loadBlock, {
				maxSamples: maxAudioFrames - decodedSampleCount,
				onBlock() {
					completedBlocks += 1;
					progress(options.onProgress, totalBlocks ? completedBlocks / totalBlocks : 1, 'reading');
				},
				warn,
			});
			decodedSampleCount += samples.length;
			if (!samples.length) continue;
			const trimLeftSeconds = nonNegativeFiniteAttribute(clipNode, 'trimleft', 0);
			const trimRightSeconds = nonNegativeFiniteAttribute(clipNode, 'trimright', 0);
			const sourceStart = Math.min(samples.length, Math.round(trimLeftSeconds * rate / stretch));
			const sourceEnd = Math.max(sourceStart, samples.length - Math.round(trimRightSeconds * rate / stretch));
			const timing = clipPlaybackTiming(samples.length, clipNode, rate, stretch, trimLeftSeconds, trimRightSeconds);
			if (sourceEnd <= sourceStart || timing.endSeconds <= timing.startSeconds) continue;
			track.clips.push({
				name: attributeString(clipNode, 'name', `Audio ${clipIndex + 1}`),
				channels: [samples],
				sourceStart,
				sourceEnd,
				...timing,
				trimLeftSeconds,
				trimRightSeconds,
				stretch,
				pitchCents: clamp(firstFiniteAttribute(clipNode, ['centshift', 'pitch', 'pitchshift'], 0), -1_200, 1_200),
				speedRatio: positiveFiniteAttribute(clipNode, ['speed', 'playatx'], 1),
				groupId: readLegacyGroupId(clipNode),
				color: attributeString(clipNode, 'colorindex', attributeString(clipNode, 'color', 'auto')) || 'auto',
				envelope: readLegacyEnvelope(clipNode, rate),
				opaqueExtensions: { aup3WaveClip: clonePlain(clipNode) },
			});
		}
		physicalTracks.push(track);
	}

	const tracks = [];
	for (let index = 0; index < physicalTracks.length; index += 1) {
		const left = physicalTracks[index];
		const right = physicalTracks[index + 1];
		if (left.route === 'left' && right?.joinsPrevious) {
			tracks.push(linkLegacyStereoTracks(left, right, warn));
			index += 1;
		} else tracks.push({ ...left, channelCount: 1, channelLayout: 'mono' });
	}
	for (const [trackIndex, node] of labelNodes.entries()) {
		tracks.push({
			type: 'label',
			name: attributeString(node, 'name', `Labels ${trackIndex + 1}`),
			labels: directChildren(node, 'label').map((label, labelIndex) => ({
				title: attributeString(label, 'title', attributeString(label, 'text', `Label ${labelIndex + 1}`)),
				startSeconds: Math.max(0, finiteAttribute(label, 't', 0)),
				endSeconds: Math.max(0, finiteAttribute(label, 't1', finiteAttribute(label, 't', 0))),
				opaqueExtensions: { aup3Label: clonePlain(label) },
			})),
			opaqueExtensions: { aup3LabelTrack: clonePlain(node) },
		});
	}
	progress(options.onProgress, 1, 'complete');
	return {
		sampleRate: projectRate,
		tempo: {
			bpm: Number.isFinite(projectTempo) && projectTempo > 0 ? projectTempo : 120,
			timeSignature: {
				numerator: Math.max(1, integerAttribute(project, 'time_signature_upper', 4)),
				denominator: legacyTimeSignatureDenominator(project),
			},
		},
		selection: {
			startSeconds: Math.max(0, finiteAttribute(project, 'sel0', 0)),
			endSeconds: Math.max(0, finiteAttribute(project, 'sel1', 0)),
		},
		view: {
			zoom: positiveFiniteAttribute(project, ['zoom', 'viewstate_zoom'], 100),
			horizontalPosition: Math.max(0, firstFiniteAttribute(project, ['h', 'viewstate_hpos'], 0)),
			verticalPosition: Math.max(0, Math.round(firstFiniteAttribute(project, ['vpos', 'viewstate_vpos'], 0))),
		},
		tracks,
		metadata: {
			title: attributeString(project, 'projname', '') || attributeString(project, 'name', '') || undefined,
			trackCount: tracks.length,
			durationSeconds: structuredDurationSeconds(tracks, projectRate),
		},
		warnings,
		opaqueExtensions: { aup3Project: clonePlain(project) },
	};
}

/**
 * Render a parsed AUP3 XML tree. Exposed separately so timeline and mixing can
 * be tested without creating SQLite fixtures.
 *
 * @param {Aup3Node} root
 * @param {(blockId: number) => { sampleFormat: number, samples: Uint8Array } | null} loadBlock
 * @param {{ onProgress?: Function, maxDecodedAudioBytes?: number, maxMixBytes?: number }} [options]
 */
export async function renderAup3Project(root, loadBlock, options = {}) {
	const project = findProjectNode(root);
	if (!project) throw new Aup3Error('The AUP3 document has no project element.', 'INVALID_PROJECT_XML');

	const warnings = [];
	const warn = (message) => {
		if (!warnings.includes(message)) warnings.push(message);
	};
	const projectRate = sampleRate(attributeNumber(project, 'rate', 44100));
	const maxDecodedAudioBytes = positiveInteger(options.maxDecodedAudioBytes, DEFAULT_MAX_DECODED_AUDIO_BYTES);
	const maxMixBytes = positiveInteger(options.maxMixBytes, DEFAULT_MAX_MIX_BYTES);
	const maxAudioFrames = Math.floor(maxDecodedAudioBytes / Float32Array.BYTES_PER_ELEMENT);
	const trackNodes = findTrackNodes(project);
	if (!trackNodes.length) {
		throw new Aup3Error('The Audacity project contains no audio tracks.', 'NO_AUDIO');
	}

	warnForUnsupportedProjectFeatures(project, warn);
	const projectTempo = firstFiniteAttribute(project, ['time_signature_tempo', 'tempo'], Number.NaN);
	const trackRoutes = buildTrackRoutes(trackNodes, warn);
	const totalBlocks = trackNodes.reduce((total, track) => total + directChildren(track, 'waveclip')
		.reduce((clipTotal, clip) => clipTotal + directChildren(clip, 'sequence')
			.reduce((sequenceTotal, sequence) => sequenceTotal + directChildren(sequence, 'waveblock').length, 0), 0), 0);
	let completedBlocks = 0;
	progress(options.onProgress, 0, 'reading');

	const decodedTracks = [];
	let decodedSampleCount = 0;
	for (let trackIndex = 0; trackIndex < trackNodes.length; trackIndex += 1) {
		const trackNode = trackNodes[trackIndex];
		const rate = sampleRate(attributeNumber(trackNode, 'rate', projectRate));
		const track = {
			name: attributeString(trackNode, 'name', `Track ${trackIndex + 1}`),
			rate,
			route: trackRoutes[trackIndex].route,
			joinsPrevious: trackRoutes[trackIndex].joinsPrevious,
			linked: attributeBoolean(trackNode, 'linked', false),
			mute: attributeBoolean(trackNode, 'mute', false),
			solo: attributeBoolean(trackNode, 'solo', false),
			gain: audioTrackGain(trackNode),
			pan: clamp(finiteAttribute(trackNode, 'pan', 0), -1, 1),
			clips: [],
		};

		for (const clipNode of directChildren(trackNode, 'waveclip')) {
			const sequences = directChildren(clipNode, 'sequence');
			if (!sequences.length) continue;
			if (sequences.length > 1) {
				warn('A clip with multiple audio sequences was mixed from its first sequence only.');
			}
			const stretch = clipStretch(clipNode, projectTempo);
			warnForUnsupportedClipFeatures(clipNode, stretch, warn);
			const sequence = await decodeSequence(sequences[0], loadBlock, {
				maxSamples: maxAudioFrames - decodedSampleCount,
				onBlock() {
					completedBlocks += 1;
					progress(options.onProgress, totalBlocks ? completedBlocks / totalBlocks : 1, 'reading');
				},
				warn,
			});
			if (!sequence.length) continue;
			decodedSampleCount += sequence.length;

			const trimLeft = nonNegativeFiniteAttribute(clipNode, 'trimleft', 0);
			const trimRight = nonNegativeFiniteAttribute(clipNode, 'trimright', 0);
			const sourceStart = Math.min(sequence.length, Math.round(trimLeft * rate / stretch));
			const sourceEnd = Math.max(sourceStart, sequence.length - Math.round(trimRight * rate / stretch));
			const timing = clipPlaybackTiming(sequence.length, clipNode, rate, stretch, trimLeft, trimRight);
			if (sourceEnd <= sourceStart || timing.endSeconds <= timing.startSeconds) continue;
			track.clips.push({
				samples: sequence,
				sourceStart,
				sourceEnd,
				...timing,
				stretch,
			});
		}
		decodedTracks.push(track);
	}

	const audibleClips = decodedTracks.flatMap((track) => track.clips);
	if (!audibleClips.length) {
		throw new Aup3Error('The Audacity project contains no readable audio clips.', 'NO_AUDIO');
	}
	const stereo = decodedTracks.some((track) => track.route !== 'mono' || Math.abs(track.pan) > 1e-9);
	let frameCount = 0;
	for (const track of decodedTracks) {
		for (const clip of track.clips) {
			frameCount = Math.max(frameCount, Math.round(clip.endSeconds * projectRate));
		}
	}
	frameCount = Math.max(1, frameCount);
	const outputChannelCount = stereo ? 2 : 1;
	if (
		!Number.isSafeInteger(frameCount) ||
		frameCount * outputChannelCount * Float32Array.BYTES_PER_ELEMENT > maxMixBytes
	) {
		throw new Aup3Error('The Audacity project is too long to mix safely in this browser.', 'PROJECT_TOO_LARGE');
	}

	const maxOutputFrames = Math.floor(maxMixBytes / outputChannelCount / Float32Array.BYTES_PER_ELEMENT);
	const channels = Array.from({ length: outputChannelCount }, () => allocateSamples(frameCount, 'The Audacity project is too large to mix in this browser.', maxOutputFrames));
	const anySolo = decodedTracks.some((track) => track.solo);
	for (const track of decodedTracks) {
		// Audacity's export selection uses solo exclusively whenever any track
		// is soloed, even when a soloed track also retains its mute flag.
		if (anySolo ? !track.solo : track.mute) continue;
		for (const clip of track.clips) await mixClip(channels, clip, track, projectRate);
	}
	progress(options.onProgress, 1, 'complete');

	return {
		channels,
		sampleRate: projectRate,
		metadata: {
			title: attributeString(project, 'projname', '') || attributeString(project, 'name', '') || undefined,
			trackCount: logicalTrackCount(decodedTracks),
			durationSeconds: frameCount / projectRate,
		},
		warnings,
	};
}

/**
 * Decode one raw AUP3 sample block.
 *
 * @param {ArrayBuffer | ArrayBufferView | number[]} input
 * @param {number} sampleFormat
 */
export function decodeAup3SampleBlock(input, sampleFormat) {
	const bytes = toBytes(input);
	const format = Number(sampleFormat);
	const bytesPerSample = format >>> 16;
	if (!bytesPerSample || bytes.byteLength % bytesPerSample !== 0) {
		throw new Aup3Error('An AUP3 sample block has an invalid byte length.', 'INVALID_SAMPLE_BLOCK');
	}
	if (![SAMPLE_FORMAT.INT16, SAMPLE_FORMAT.INT24, SAMPLE_FORMAT.FLOAT32].includes(format)) {
		throw new Aup3Error(`Unsupported Audacity sample format: 0x${format.toString(16)}.`, 'UNSUPPORTED_SAMPLE_FORMAT');
	}

	const result = allocateSamples(bytes.byteLength / bytesPerSample, 'An AUP3 sample block is too large to decode in this browser.');
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let index = 0, offset = 0; index < result.length; index += 1, offset += bytesPerSample) {
		if (format === SAMPLE_FORMAT.INT16) result[index] = view.getInt16(offset, true) / 32768;
		else if (format === SAMPLE_FORMAT.INT24) result[index] = view.getInt32(offset, true) / 8388608;
		else result[index] = finiteSample(view.getFloat32(offset, true));
	}
	return result;
}

function decodeDictionary(bytes, state) {
	const cursor = new ByteCursor(bytes, 'dictionary');
	while (!cursor.done) {
		countField(state);
		const type = cursor.u8();
		if (type === FIELD.CHAR_SIZE) state.charSize = readCharSize(cursor);
		else if (type === FIELD.NAME) readName(cursor, state);
		else if (type === FIELD.PUSH) pushNames(state);
		else if (type === FIELD.POP) popNames(state, 'dictionary');
		else throw new Aup3Error(`Unexpected field ${type} in the AUP3 dictionary.`, 'INVALID_DICTIONARY');
	}
}

function decodeDocument(bytes, state, options = {}) {
	const cursor = new ByteCursor(bytes, 'document');
	/** @type {Aup3Node[]} */
	const roots = [];
	/** @type {Aup3Node[]} */
	const nodes = [];
	while (!cursor.done) {
		countField(state);
		const fieldStart = cursor.offset;
		const type = cursor.u8();
		if (type === FIELD.CHAR_SIZE) {
			state.charSize = readCharSize(cursor);
			continue;
		}
		if (type === FIELD.NAME) {
			readName(cursor, state);
			continue;
		}
		if (type === FIELD.PUSH) {
			pushNames(state);
			continue;
		}
		if (type === FIELD.POP) {
			popNames(state, 'document');
			continue;
		}
		if (type === FIELD.START_TAG) {
			if (nodes.length >= MAX_XML_DEPTH) throw new Aup3Error('The AUP3 XML is nested too deeply.', 'INVALID_PROJECT_XML');
			const node = createNode(resolveName(cursor.u16(), state));
			if (nodes.length) nodes.at(-1).children.push(node);
			else roots.push(node);
			nodes.push(node);
			options.onStartTag?.({ node, fieldStart, end: cursor.offset, charSize: state.charSize, depth: nodes.length });
			continue;
		}
		if (type === FIELD.END_TAG) {
			const name = resolveName(cursor.u16(), state);
			const current = nodes.pop();
			if (!current || current.name !== name) {
				throw new Aup3Error(`Mismatched AUP3 XML end tag: ${name}.`, 'INVALID_PROJECT_XML');
			}
			continue;
		}
		if (type === FIELD.RAW) {
			// Audacity stores the textual XML declaration and doctype as raw
			// records before the root. They are compatibility text, not project data.
			cursor.bytes(cursor.i32Length());
			continue;
		}
		if (type === FIELD.DATA) {
			const current = requireNode(nodes);
			const data = cursor.bytes(cursor.i32Length());
			current.data += decodeString(data, state.charSize);
			continue;
		}
		const current = requireNode(nodes);
		const identifier = cursor.u16();
		const attributeName = resolveName(identifier, state);
		const offset = cursor.offset;
		const value = readAttributeValue(cursor, state, type);
		// Audacity stores an ordered AttributesList, not an XML-style map.
		// AU4 writes integer spectrogram gain and double track gain with the
		// same name. Preserve every typed record for decoding and opaque data.
		current.attributeRecords.push({ name: attributeName, type, value });
		current.attributes[attributeName] = value;
		options.onAttribute?.({
			node: current, name: attributeName, identifier, type, value, fieldStart, offset, end: cursor.offset, charSize: state.charSize, depth: nodes.length,
		});
	}
	if (nodes.length) throw new Aup3Error('The AUP3 XML has unclosed elements.', 'INVALID_PROJECT_XML');
	if (state.nameStack.length) throw new Aup3Error('The AUP3 XML has unbalanced name scopes.', 'INVALID_PROJECT_XML');
	if (roots.length !== 1) throw new Aup3Error('The AUP3 document must contain one root element.', 'INVALID_PROJECT_XML');
	return roots[0];
}

function readAttributeValue(cursor, state, type) {
	if (type === FIELD.STRING) return decodeString(cursor.bytes(cursor.i32Length()), state.charSize);
	if (type === FIELD.BLOB) return cursor.bytes(cursor.i32Length()).slice();
	if (type === FIELD.INT || type === FIELD.LONG) return cursor.i32();
	if (type === FIELD.BOOL) return cursor.u8() !== 0;
	if (type === FIELD.LONG_LONG) return safeInteger(cursor.i64());
	if (type === FIELD.SIZE_T) return cursor.u32();
	if (type === FIELD.FLOAT) {
		const value = cursor.f32();
		cursor.i32();
		return value;
	}
	if (type === FIELD.DOUBLE) {
		const value = cursor.f64();
		cursor.i32();
		return value;
	}
	throw new Aup3Error(`Unknown AUP3 XML field type: ${type}.`, 'INVALID_PROJECT_XML');
}

async function decodeSequence(sequenceNode, loadBlock, { maxSamples, onBlock, warn }) {
	const declaredFormat = integerAttribute(sequenceNode, 'sampleformat', 0);
	const declaredSamples = nonNegativeIntegerAttribute(sequenceNode, 'numsamples', 0);
	if (declaredSamples > maxSamples) {
		throw new Aup3Error('The Audacity project contains too much decoded audio for this browser.', 'PROJECT_TOO_LARGE');
	}
	let result = allocateSamples(declaredSamples, 'An Audacity sequence is too large to decode in this browser.', maxSamples);
	let sampleCount = 0;
	const blockNodes = directChildren(sequenceNode, 'waveblock');
	for (let blockIndex = 0; blockIndex < blockNodes.length; blockIndex += 1) {
		const blockNode = blockNodes[blockIndex];
		const declaredStart = nonNegativeIntegerAttribute(blockNode, 'start', sampleCount);
		if (declaredStart !== sampleCount) {
			warn('A sequence with inconsistent block positions was repaired in project order.');
		}
		const blockId = integerAttribute(blockNode, 'blockid', Number.NaN);
		if (!Number.isSafeInteger(blockId)) {
			throw new Aup3Error('An AUP3 wave block has an invalid identifier.', 'INVALID_SAMPLE_BLOCK');
		}
		let samples = null;
		let blockLength = 0;
		if (blockId <= 0) {
			blockLength = Math.max(0, -blockId);
		} else {
			const row = loadBlock(blockId);
			if (!row) throw new Aup3Error(`The Audacity project is missing sample block ${blockId}.`, 'MISSING_SAMPLE_BLOCK');
			if (declaredFormat && row.sampleFormat !== declaredFormat) {
				warn('A sample block format differed from its sequence declaration; the block format was used.');
			}
			samples = decodeAup3SampleBlock(row.samples, row.sampleFormat);
			blockLength = samples.length;
		}
		if (sampleCount + blockLength > maxSamples) {
			throw new Aup3Error('The Audacity project contains too much decoded audio for this browser.', 'PROJECT_TOO_LARGE');
		}
		if (sampleCount + blockLength > result.length) {
			result = growSamples(result, Math.max(sampleCount + blockLength, Math.min(maxSamples, Math.max(1, result.length * 2))), maxSamples);
		}
		if (samples) result.set(samples, sampleCount);
		sampleCount += blockLength;
		onBlock();
		if ((blockIndex + 1) % 32 === 0) await yieldToEventLoop();
	}
	if (declaredSamples !== sampleCount) {
		warn('A sequence with an inconsistent sample count was repaired from its stored audio blocks.');
	}
	return result.length === sampleCount ? result : result.slice(0, sampleCount);
}

async function mixClip(output, clip, track, outputRate) {
	const ratio = track.rate / (outputRate * clip.stretch);
	const startTrackFrame = roundTrackSample(clip.startSeconds * track.rate);
	const sourceOffset = clip.sourceStart - startTrackFrame / clip.stretch;
	// MixerSource resamples the continuous WaveTrack, including silence. Use
	// one global phase and sum each clip's complete filter support, so splitting
	// a track into adjacent clips cannot create a dip or shift at their join.
	// https://github.com/audacity/audacity/blob/Audacity-3.7.9/libraries/lib-mixer/MixerSource.cpp#L109-L122
	// Its input queue starts at export time zero; negative-time audio is not
	// available as filter context, just as hidden trims are not available.
	const sourceStart = Math.max(clip.sourceStart, Math.ceil(sourceOffset));
	if (sourceStart >= clip.sourceEnd) return;
	const alignedUnity = ratio === 1 && Number.isInteger(sourceOffset);
	const radius = alignedUnity ? 0 : getAudacityResamplingRadius(ratio);
	const firstDestination = alignedUnity
		? Math.max(0, Math.round(clip.startSeconds * outputRate))
		: Math.max(0, Math.ceil((sourceStart - radius - sourceOffset) / ratio));
	const lastDestination = alignedUnity
		? Math.min(output[0].length, Math.round(clip.endSeconds * outputRate))
		: Math.min(output[0].length, Math.floor((clip.sourceEnd - 1 + radius - sourceOffset) / ratio) + 1);
	const gains = output.length === 1 ? [track.gain] : stereoGains(track);
	const readSample = createAudacitySampleReader(clip.samples, ratio, sourceStart, clip.sourceEnd);
	let yieldAt = firstDestination + 65_536;
	for (let destination = firstDestination; destination < lastDestination; destination += 1) {
		const position = sourceOffset + destination * ratio;
		const sample = readSample(position);
		if (output.length === 1) output[0][destination] += sample * gains[0];
		else {
			output[0][destination] += sample * gains[0];
			output[1][destination] += sample * gains[1];
		}
		if (destination === yieldAt) {
			yieldAt += 65_536;
			await yieldToEventLoop();
		}
	}
}

function stereoGains(track) {
	const left = track.gain * (track.pan > 0 ? 1 - track.pan : 1);
	const right = track.gain * (track.pan < 0 ? 1 + track.pan : 1);
	if (track.route === 'left') return [left, 0];
	if (track.route === 'right') return [0, right];
	return [left, right];
}

function clipPlaybackTiming(sampleCount, clip, rate, stretch, trimLeft, trimRight) {
	const offset = finiteAttribute(clip, 'offset', 0);
	// WaveClip::GetPlayStartTime/GetPlayEndTime snap each absolute endpoint to
	// the track's grid. Rounding source trims first loses their fractional
	// stretched duration and can incorrectly add a frame to the export.
	return {
		startSeconds: roundTrackSample((offset + trimLeft) * rate) / rate,
		endSeconds: roundTrackSample((offset + sampleCount * stretch / rate - trimRight) * rate) / rate,
	};
}

function roundTrackSample(value) {
	// C++ std::round resolves negative half samples away from zero.
	return Math.sign(value) * Math.round(Math.abs(value));
}

function warnForUnsupportedProjectFeatures(project, warn) {
	for (const node of walkNodes(project)) {
		const name = normalizedName(node.name);
		const effectsActive = attribute(node, 'active');
		if (
			name.includes('realtimeeffect') ||
			name.includes('mastereffect') ||
			(name === 'effects' && node.children.length > 0 && (effectsActive == null || attributeBoolean(node, 'active', false)))
		) {
			warn('Audacity realtime and master effects were not rendered.');
		}
		if (name === 'notetrack' || name === 'timetrack') {
			warn('Audacity note, MIDI, and time tracks were not rendered.');
		}
	}
}

function warnForUnsupportedClipFeatures(clip, stretch, warn) {
	if (directChildren(clip, 'envelope').some((node) => node.children.length || attributeNumber(node, 'numpoints', 0) > 0)) {
		warn('Clip volume envelopes were not rendered.');
	}
	if (Math.abs(stretch - 1) > 1e-9) {
		warn('Clip time and tempo stretching was approximated by resampling; Audacity pitch preservation was not reproduced.');
	}
	const pitch = firstFiniteAttribute(clip, ['centshift', 'pitch', 'pitchshift'], 0);
	if (Math.abs(pitch) > 1e-9) warn('Clip pitch changes were not rendered.');
	const speed = firstFiniteAttribute(clip, ['speed', 'playatx'], 1);
	if (Math.abs(speed - 1) > 1e-9) warn('Legacy clip speed changes were not rendered.');
}

function clipStretch(clip, projectTempo) {
	const ratio = positiveFiniteAttribute(clip, ['clipstretchratio', 'stretchratio'], 1);
	const rawTempo = positiveFiniteAttribute(clip, ['rawaudiotempo'], Number.NaN);
	const clipTempo = positiveFiniteAttribute(clip, ['cliptempo'], Number.NaN);
	// AU4 permits an independent clip tempo and disabled tempo matching. AU3
	// and older AU4 documents omit these attributes and use the project tempo.
	// https://github.com/audacity/audacity/blob/Audacity-4.0.1/au3/libraries/au3-wave-track/WaveClip.cpp
	const tempo = Number.isFinite(clipTempo) ? clipTempo
		: attributeBoolean(clip, 'clipstretchtomatchtempo', true) ? projectTempo : Number.NaN;
	if (Number.isFinite(rawTempo) && Number.isFinite(tempo) && tempo > 0) return ratio * rawTempo / tempo;
	return ratio;
}

function buildTrackRoutes(trackNodes, warn) {
	const routes = trackNodes.map(() => ({ route: 'mono', joinsPrevious: false }));
	const assigned = trackNodes.map(() => false);
	const channels = trackNodes.map((node) => integerAttribute(node, 'channel', Number.NaN));
	for (let index = 0; index < trackNodes.length; index += 1) {
		if (!attributeBoolean(trackNodes[index], 'linked', false)) continue;
		if (index + 1 >= trackNodes.length || assigned[index + 1]) {
			warn('A malformed linked track was mixed as mono.');
			continue;
		}
		routes[index] = { route: 'left', joinsPrevious: false };
		routes[index + 1] = { route: 'right', joinsPrevious: true };
		assigned[index] = true;
		assigned[index + 1] = true;
		index += 1;
	}
	for (let index = 0; index < trackNodes.length; index += 1) {
		if (assigned[index]) continue;
		if (channels[index] === 0 && !assigned[index + 1] && channels[index + 1] === 1) {
			routes[index] = { route: 'left', joinsPrevious: false };
			routes[index + 1] = { route: 'right', joinsPrevious: true };
			assigned[index] = true;
			assigned[index + 1] = true;
			index += 1;
		} else if (channels[index] === 1) {
			routes[index] = { route: 'right', joinsPrevious: false };
			assigned[index] = true;
		} else {
			assigned[index] = true;
			if (Number.isFinite(channels[index]) && ![0, 2].includes(channels[index])) {
				warn('A track with an unknown legacy channel assignment was mixed as mono.');
			}
		}
	}
	return routes;
}

function linkLegacyStereoTracks(left, right, warn) {
	const clipCount = Math.max(left.clips.length, right.clips.length);
	const clips = [];
	for (let index = 0; index < clipCount; index += 1) {
		const leftClip = left.clips[index];
		const rightClip = right.clips[index];
		if (!leftClip && !rightClip) continue;
		const basis = leftClip || rightClip;
		if (leftClip && rightClip && (
			Math.abs(leftClip.startSeconds - rightClip.startSeconds) > 1e-9
			|| Math.abs(leftClip.endSeconds - rightClip.endSeconds) > 1e-9
			|| leftClip.sourceStart !== rightClip.sourceStart
			|| leftClip.sourceEnd !== rightClip.sourceEnd
		)) warn(`Linked stereo clip ${index + 1} had mismatched channel timing and was padded without flattening.`);
		const frameCount = Math.max(leftClip?.channels[0].length || 0, rightClip?.channels[0].length || 0);
		clips.push({
			...basis,
			channels: [padLegacyChannel(leftClip?.channels[0], frameCount), padLegacyChannel(rightClip?.channels[0], frameCount)],
			sourceStart: Math.min(leftClip?.sourceStart ?? basis.sourceStart, rightClip?.sourceStart ?? basis.sourceStart),
			sourceEnd: Math.max(leftClip?.sourceEnd ?? basis.sourceEnd, rightClip?.sourceEnd ?? basis.sourceEnd),
			endSeconds: Math.max(leftClip?.endSeconds ?? basis.endSeconds, rightClip?.endSeconds ?? basis.endSeconds),
			opaqueExtensions: {
				...basis.opaqueExtensions,
				aup3StereoWaveClips: [leftClip?.opaqueExtensions?.aup3WaveClip, rightClip?.opaqueExtensions?.aup3WaveClip].filter(Boolean),
			},
		});
	}
	return {
		...left,
		name: left.name === right.name ? left.name : `${left.name} / ${right.name}`,
		channelCount: 2,
		channelLayout: 'stereo',
		clips,
		opaqueExtensions: {
			...left.opaqueExtensions,
			aup3LinkedTracks: [left.opaqueExtensions.aup3Track, right.opaqueExtensions.aup3Track],
		},
	};
}

function padLegacyChannel(channel, frameCount) {
	if (channel?.length === frameCount) return channel;
	const output = new Float32Array(frameCount);
	if (channel) output.set(channel.subarray(0, frameCount));
	return output;
}

function readLegacyEnvelope(clipNode, sampleRate) {
	const envelope = directChildren(clipNode, 'envelope')[0];
	if (!envelope) return [];
	return directChildren(envelope, 'controlpoint')
		.map((point) => ({
			frame: Math.max(0, Math.round(finiteAttribute(point, 't', 0) * sampleRate)),
			value: clamp(finiteAttribute(point, 'val', 1), 0, 16),
		}))
		.sort((first, second) => first.frame - second.frame)
		.filter((point, index, points) => !index || point.frame > points[index - 1].frame);
}

function readLegacyDisplayMode(node) {
	const value = integerAttribute(node, 'trackviewtype', integerAttribute(node, 'display', 0));
	return value === 1 ? 'spectrogram' : value === 2 ? 'multiview' : 'waveform';
}

function readLegacySpectrogram(node, sampleRate) {
	let minimumFrequency = clamp(firstFiniteAttribute(node, ['minfreq', 'spectrummin'], 0), 0, sampleRate / 2);
	let maximumFrequency = clamp(firstFiniteAttribute(node, ['maxfreq', 'spectrummax'], Math.min(20_000, sampleRate / 2)), 0, sampleRate / 2);
	if (maximumFrequency <= minimumFrequency) { minimumFrequency = 0; maximumFrequency = Math.max(1, Math.min(20_000, sampleRate / 2)); }
	return {
		scale: 'mel',
		minimumFrequency,
		maximumFrequency,
		windowSize: legacyPowerOfTwo(integerAttribute(node, 'windowsize', 2_048), 2_048),
		windowType: 'hann',
		gain: clamp(typedAttributeNumber(node, 'gain', [FIELD.INT, FIELD.LONG, FIELD.LONG_LONG, FIELD.SIZE_T], finiteAttribute(node, 'spectrumgain', 20)), -120, 120),
		range: clamp(firstFiniteAttribute(node, ['range', 'spectrumrange'], 80), 1, 240),
	};
}

function readLegacyGroupId(node) {
	const value = firstFiniteAttribute(node, ['groupid', 'group'], -1);
	return Number.isSafeInteger(value) && value >= 0 ? `aup3-group-${value}` : null;
}

function legacyTimeSignatureDenominator(project) {
	return legacyPowerOfTwo(integerAttribute(project, 'time_signature_lower', 4), 4);
}

function legacyPowerOfTwo(value, fallback) {
	return Number.isSafeInteger(value) && value > 0 && (value & (value - 1)) === 0 ? value : fallback;
}

function structuredDurationSeconds(tracks, projectRate) {
	let duration = 0;
	for (const track of tracks) {
		if (track.type === 'label') {
			for (const label of track.labels) duration = Math.max(duration, label.endSeconds);
			continue;
		}
		for (const clip of track.clips) {
			duration = Math.max(duration, clip.endSeconds);
		}
	}
	return duration || 1 / projectRate;
}

function clonePlain(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function findProjectNode(root) {
	for (const node of walkNodes(root)) {
		if (normalizedName(node.name) === 'project') return node;
	}
	return null;
}

function findTrackNodes(project) {
	const direct = directChildren(project, 'wavetrack');
	if (direct.length) return direct;
	const tracks = [];
	const visit = (node, insideClip = false) => {
		const name = normalizedName(node.name);
		if (name === 'wavetrack' && !insideClip) tracks.push(node);
		if (name === 'waveclip') return;
		for (const child of node.children) visit(child, insideClip || name === 'waveclip');
	};
	for (const child of project.children) visit(child);
	return tracks;
}

function logicalTrackCount(tracks) {
	return tracks.reduce((count, track) => count + (track.joinsPrevious ? 0 : 1), 0);
}

function directChildren(node, name) {
	const expected = normalizedName(name);
	return node.children.filter((child) => normalizedName(child.name) === expected);
}

function* walkNodes(root) {
	const stack = [root];
	while (stack.length) {
		const node = stack.pop();
		yield node;
		for (let index = node.children.length - 1; index >= 0; index -= 1) stack.push(node.children[index]);
	}
}

function createNode(name) {
	return { name, attributes: Object.create(null), attributeRecords: [], children: [], data: '', raw: [] };
}

function attribute(node, name) {
	const expected = normalizedName(name);
	let result;
	for (const [key, value] of Object.entries(node.attributes)) {
		if (normalizedName(key) === expected) result = value;
	}
	return result;
}

function typedAttributeNumber(node, name, types, fallback) {
	const expected = normalizedName(name);
	let result = fallback;
	for (const record of node.attributeRecords || []) {
		if (normalizedName(record.name) !== expected || !types.includes(record.type)) continue;
		const value = Number(record.value);
		if (Number.isFinite(value)) result = value;
	}
	return result;
}

function audioTrackGain(node) {
	// AU4's serializers distinguish integer spectrogram gain from the double
	// record WaveTrack writes for audio volume, despite using the same name.
	// https://github.com/audacity/audacity/blob/Audacity-4.0.1/src/spectrogram/internal/au3/au3spectrogramsettings.cpp#L122-L135
	// Hand-authored trees without binary records retain the public API fallback.
	return node.attributeRecords
		? typedAttributeNumber(node, 'gain', [FIELD.FLOAT, FIELD.DOUBLE], 1)
		: finiteAttribute(node, 'gain', 1);
}

function attributeString(node, name, fallback) {
	const value = attribute(node, name);
	return value == null ? fallback : String(value);
}

function attributeNumber(node, name, fallback) {
	const value = Number(attribute(node, name));
	return Number.isFinite(value) ? value : fallback;
}

function finiteAttribute(node, name, fallback) {
	return attributeNumber(node, name, fallback);
}

function firstFiniteAttribute(node, names, fallback) {
	for (const name of names) {
		const value = Number(attribute(node, name));
		if (Number.isFinite(value)) return value;
	}
	return fallback;
}

function positiveFiniteAttribute(node, names, fallback) {
	const value = firstFiniteAttribute(node, names, fallback);
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function integerAttribute(node, name, fallback) {
	const value = attributeNumber(node, name, fallback);
	return Number.isSafeInteger(value) ? value : fallback;
}

function nonNegativeIntegerAttribute(node, name, fallback) {
	const value = integerAttribute(node, name, fallback);
	return value >= 0 ? value : fallback;
}

function nonNegativeFiniteAttribute(node, name, fallback) {
	return Math.max(0, finiteAttribute(node, name, fallback));
}

function attributeBoolean(node, name, fallback) {
	const value = attribute(node, name);
	if (value == null) return fallback;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'string') return value === '1' || value.toLowerCase() === 'true';
	return Boolean(value);
}

function normalizedName(value) {
	return String(value || '').trim().toLowerCase();
}

function sampleRate(value) {
	const rate = Math.round(Number(value));
	if (!Number.isFinite(rate) || rate < 1 || rate > 1_000_000) {
		throw new Aup3Error(`Unsupported Audacity sample rate: ${value}.`, 'INVALID_SAMPLE_RATE');
	}
	return rate;
}

function progress(callback, value, phase) {
	if (typeof callback === 'function') callback({ progress: clamp(value, 0, 1), phase });
}

function finiteSample(value) {
	return Number.isFinite(value) ? value : 0;
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function positiveInteger(value, fallback) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function stripAup3Extension(name) {
	return String(name || '').trim().replace(/\.aup[34]$/i, '');
}

function tableExists(database, name) {
	const statement = database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1");
	try {
		statement.bind([name]);
		return statement.step();
	} finally {
		statement.free();
	}
}

function readProjectRow(database, table) {
	const statement = database.prepare(`SELECT dict, doc FROM ${table} WHERE id = 1 LIMIT 1`);
	try {
		if (!statement.step()) return null;
		const values = statement.get();
		return { dictionary: toBytes(values[0]), document: toBytes(values[1]) };
	} finally {
		statement.free();
	}
}

function validateApplicationId(database) {
	let rows;
	try {
		rows = database.exec('PRAGMA application_id');
	} catch (error) {
		throw new Aup3Error('The AUP3 database application identifier could not be read.', 'INVALID_DATABASE', { cause: error });
	}
	const value = Number(rows?.[0]?.values?.[0]?.[0] || 0);
	if (value !== AUDACITY_APPLICATION_ID) {
		throw new Aup3Error('This SQLite file is not an Audacity project.', 'NOT_AUP3');
	}
}

function readCharSize(cursor) {
	const value = cursor.u8();
	if (![1, 2, 4].includes(value)) throw new Aup3Error(`Unsupported AUP3 character size: ${value}.`, 'INVALID_PROJECT_XML');
	return value;
}

function readName(cursor, state) {
	const identifier = cursor.u16();
	const name = decodeString(cursor.bytes(cursor.u16()), state.charSize);
	if (!name || state.names.has(identifier)) {
		throw new Aup3Error(`Invalid or duplicate AUP3 XML name identifier: ${identifier}.`, 'INVALID_PROJECT_XML');
	}
	state.names.set(identifier, name);
}

function resolveName(identifier, state) {
	const name = state.names.get(identifier);
	if (!name) throw new Aup3Error(`Unknown AUP3 XML name identifier: ${identifier}.`, 'INVALID_PROJECT_XML');
	return name;
}

function pushNames(state) {
	state.nameStack.push(state.names);
	state.names = new Map();
}

function popNames(state, source) {
	const previous = state.nameStack.pop();
	if (!previous) throw new Aup3Error(`Unbalanced AUP3 name scope in ${source}.`, 'INVALID_PROJECT_XML');
	state.names = previous;
}

function countField(state) {
	state.fieldCount += 1;
	if (state.fieldCount > MAX_XML_FIELDS) throw new Aup3Error('The AUP3 project description is too complex.', 'PROJECT_TOO_LARGE');
}

function requireNode(nodes) {
	const node = nodes.at(-1);
	if (!node) throw new Aup3Error('AUP3 XML data appears outside an element.', 'INVALID_PROJECT_XML');
	return node;
}

function decodeString(bytes, charSize) {
	if (!charSize || bytes.byteLength % charSize !== 0) {
		throw new Aup3Error('An AUP3 XML string has an invalid byte length.', 'INVALID_PROJECT_XML');
	}
	if (charSize === 1) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	if (charSize === 2) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
	let result = '';
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let offset = 0; offset < bytes.byteLength; offset += 4) {
		const codePoint = view.getUint32(offset, true);
		if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
			throw new Aup3Error('An AUP3 XML string contains invalid UTF-32.', 'INVALID_PROJECT_XML');
		}
		result += String.fromCodePoint(codePoint);
	}
	return result;
}

function safeInteger(value) {
	if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) return value;
	return Number(value);
}

function toBytes(value) {
	// Binary XML rewriting and BLOB reads require copying slice semantics.
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (Array.isArray(value)) return Uint8Array.from(value);
	if (value == null) return new Uint8Array();
	throw new Aup3Error('Expected binary AUP3 data.', 'INVALID_DATABASE');
}

function yieldToEventLoop() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function allocateSamples(length, message, maxFrames = DEFAULT_MAX_AUDIO_FRAMES) {
	if (!Number.isSafeInteger(length) || length < 0 || length > maxFrames) {
		throw new Aup3Error(message, 'PROJECT_TOO_LARGE');
	}
	try {
		return new Float32Array(length);
	} catch (error) {
		throw new Aup3Error(message, 'PROJECT_TOO_LARGE', { cause: error });
	}
}

function growSamples(previous, length, maxFrames) {
	const next = allocateSamples(length, 'An Audacity sequence is too large to decode in this browser.', maxFrames);
	next.set(previous);
	return next;
}

class ByteCursor {
	constructor(bytes, label) {
		this.bytesValue = bytes;
		this.label = label;
		this.offset = 0;
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	get done() { return this.offset === this.bytesValue.byteLength; }

	require(length) {
		if (length < 0 || this.offset + length > this.bytesValue.byteLength) {
			throw new Aup3Error(`Truncated AUP3 ${this.label}.`, 'INVALID_PROJECT_XML');
		}
	}

	u8() { this.require(1); const value = this.view.getUint8(this.offset); this.offset += 1; return value; }
	u16() { this.require(2); const value = this.view.getUint16(this.offset, true); this.offset += 2; return value; }
	u32() { this.require(4); const value = this.view.getUint32(this.offset, true); this.offset += 4; return value; }
	i32() { this.require(4); const value = this.view.getInt32(this.offset, true); this.offset += 4; return value; }
	i64() { this.require(8); const value = this.view.getBigInt64(this.offset, true); this.offset += 8; return value; }
	f32() { this.require(4); const value = this.view.getFloat32(this.offset, true); this.offset += 4; return value; }
	f64() { this.require(8); const value = this.view.getFloat64(this.offset, true); this.offset += 8; return value; }
	i32Length() {
		const length = this.i32();
		if (length < 0) throw new Aup3Error(`Negative byte length in AUP3 ${this.label}.`, 'INVALID_PROJECT_XML');
		return length;
	}
	bytes(length) {
		this.require(length);
		const value = this.bytesValue.subarray(this.offset, this.offset + length);
		this.offset += length;
		return value;
	}
}

/**
 * @typedef {{
 *   name: string,
 *   attributes: Record<string, string | number | boolean | bigint | Uint8Array>,
 *   attributeRecords?: { name: string, type: number, value: string | number | boolean | bigint | Uint8Array }[],
 *   children: Aup3Node[],
 *   data: string,
 *   raw: Uint8Array[],
 * }} Aup3Node
 */
