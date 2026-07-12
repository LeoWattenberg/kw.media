export const AUDIO_EDITOR_SCHEMA_VERSION = 1;
export const AUDIO_EDITOR_SAMPLE_RATE = 48_000;
export const AUDIO_EDITOR_MASTER_CHANNELS = 2;

const ID_FALLBACK_RANDOM_LENGTH = 10;

/**
 * @typedef {Object} AudioEditorSourceV1
 * @property {string} id
 * @property {string} name
 * @property {string} mimeType
 * @property {string} storageKey
 * @property {number} frameCount
 * @property {1 | 2} channelCount
 * @property {48000} sampleRate
 * @property {number} originalSampleRate
 */

/**
 * @typedef {Object} AudioEditorClipV1
 * @property {string} id
 * @property {string} sourceId
 * @property {number} timelineStartFrame
 * @property {number} sourceStartFrame
 * @property {number} durationFrames
 * @property {number} gain
 * @property {number} fadeInFrames
 * @property {number} fadeOutFrames
 * @property {boolean} reversed
 */

/**
 * @typedef {Object} AudioEditorEffectV1
 * @property {string} id
 * @property {string} type
 * @property {boolean} enabled
 * @property {Record<string, *>} params
 */

/**
 * @typedef {Object} AudioEditorTrackV1
 * @property {string} id
 * @property {string} name
 * @property {number} gain
 * @property {number} pan
 * @property {boolean} mute
 * @property {boolean} solo
 * @property {boolean} armed
 * @property {AudioEditorEffectV1[]} effects
 * @property {string[]} clipIds
 */

/**
 * Canonical persistence document. PCM is referenced by immutable source keys and
 * never included in undo snapshots or serialized commands.
 *
 * @typedef {Object} AudioEditorProjectV1
 * @property {1} schemaVersion
 * @property {string} id
 * @property {string} title
 * @property {number} revision
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {48000} sampleRate
 * @property {2} masterChannels
 * @property {{ startFrame: number, endFrame: number }} selection
 * @property {{ enabled: boolean, startFrame: number, endFrame: number }} loop
 * @property {AudioEditorSourceV1[]} sources
 * @property {AudioEditorClipV1[]} clips
 * @property {AudioEditorTrackV1[]} tracks
 * @property {{ gain: number, effects: AudioEditorEffectV1[] }} master
 */

function plainClone(value) {
	if (typeof structuredClone === 'function') return structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function isoTimestamp(value = new Date()) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) throw new TypeError('A valid timestamp is required.');
	return date.toISOString();
}

export function createStableId(prefix = 'item') {
	const safePrefix = String(prefix || 'item').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '') || 'item';
	if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
		return `${safePrefix}-${globalThis.crypto.randomUUID()}`;
	}

	const random = Math.random().toString(36).slice(2, 2 + ID_FALLBACK_RANDOM_LENGTH);
	return `${safePrefix}-${Date.now().toString(36)}-${random}`;
}

/** @param {AudioEditorProjectV1} project @returns {AudioEditorProjectV1} */
export function cloneProject(project) {
	return plainClone(project);
}

export function assertFrame(value, name = 'frame') {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

export function assertPositiveFrame(value, name = 'durationFrames') {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return value;
}

export function normalizeFrameRange(startFrame, endFrame, name = 'range') {
	assertFrame(startFrame, `${name}.startFrame`);
	assertFrame(endFrame, `${name}.endFrame`);
	if (endFrame <= startFrame) throw new RangeError(`${name} must have a positive duration.`);
	return { startFrame, endFrame, durationFrames: endFrame - startFrame };
}

/** @returns {AudioEditorProjectV1} */
export function createAudioEditorProject(options = {}) {
	const timestamp = isoTimestamp(options.now);
	return {
		schemaVersion: AUDIO_EDITOR_SCHEMA_VERSION,
		id: options.id || createStableId('project'),
		title: String(options.title || 'Untitled project').trim() || 'Untitled project',
		revision: 0,
		createdAt: timestamp,
		updatedAt: timestamp,
		sampleRate: AUDIO_EDITOR_SAMPLE_RATE,
		masterChannels: AUDIO_EDITOR_MASTER_CHANNELS,
		selection: { startFrame: 0, endFrame: 0 },
		loop: { enabled: false, startFrame: 0, endFrame: 0 },
		sources: [],
		clips: [],
		tracks: [],
		master: { gain: 1, effects: [] },
	};
}

/** @returns {AudioEditorSourceV1} */
export function createAudioSource(options = {}) {
	const frameCount = assertPositiveFrame(options.frameCount, 'source.frameCount');
	const channelCount = Number(options.channelCount);
	if (channelCount !== 1 && channelCount !== 2) throw new RangeError('source.channelCount must be 1 or 2.');

	return {
		id: options.id || createStableId('source'),
		name: String(options.name || 'Audio source'),
		mimeType: String(options.mimeType || 'audio/wav'),
		storageKey: String(options.storageKey || options.id || createStableId('pcm')),
		frameCount,
		channelCount,
		sampleRate: AUDIO_EDITOR_SAMPLE_RATE,
		originalSampleRate: Number.isFinite(options.originalSampleRate)
			? Math.round(options.originalSampleRate)
			: AUDIO_EDITOR_SAMPLE_RATE,
	};
}

/** @returns {AudioEditorTrackV1} */
export function createAudioTrack(options = {}) {
	return {
		id: options.id || createStableId('track'),
		name: String(options.name || 'Track'),
		gain: finiteInRange(options.gain ?? 1, 0, 4, 'track.gain'),
		pan: finiteInRange(options.pan ?? 0, -1, 1, 'track.pan'),
		mute: Boolean(options.mute),
		solo: Boolean(options.solo),
		armed: Boolean(options.armed),
		effects: Array.isArray(options.effects) ? plainClone(options.effects) : [],
		clipIds: Array.isArray(options.clipIds) ? [...options.clipIds] : [],
	};
}

/** @returns {AudioEditorClipV1} */
export function createAudioClip(options = {}) {
	const durationFrames = assertPositiveFrame(options.durationFrames, 'clip.durationFrames');
	const fadeInFrames = assertFrame(options.fadeInFrames ?? 0, 'clip.fadeInFrames');
	const fadeOutFrames = assertFrame(options.fadeOutFrames ?? 0, 'clip.fadeOutFrames');
	if (fadeInFrames > durationFrames || fadeOutFrames > durationFrames) {
		throw new RangeError('Clip fades cannot be longer than the clip.');
	}

	return {
		id: options.id || createStableId('clip'),
		sourceId: String(options.sourceId || ''),
		timelineStartFrame: assertFrame(options.timelineStartFrame ?? 0, 'clip.timelineStartFrame'),
		sourceStartFrame: assertFrame(options.sourceStartFrame ?? 0, 'clip.sourceStartFrame'),
		durationFrames,
		gain: finiteInRange(options.gain ?? 1, 0, 16, 'clip.gain'),
		fadeInFrames,
		fadeOutFrames,
		reversed: Boolean(options.reversed),
	};
}

function finiteInRange(value, minimum, maximum, name) {
	const number = Number(value);
	if (!Number.isFinite(number) || number < minimum || number > maximum) {
		throw new RangeError(`${name} must be between ${minimum} and ${maximum}.`);
	}
	return number;
}

export function findSource(project, sourceId) {
	return project.sources.find((source) => source.id === sourceId) || null;
}

export function findTrack(project, trackId) {
	return project.tracks.find((track) => track.id === trackId) || null;
}

export function findClip(project, clipId) {
	return project.clips.find((clip) => clip.id === clipId) || null;
}

export function findClipTrack(project, clipId) {
	return project.tracks.find((track) => track.clipIds.includes(clipId)) || null;
}

export function clipEndFrame(clip) {
	return clip.timelineStartFrame + clip.durationFrames;
}

export function clipsOverlap(first, second) {
	return first.timelineStartFrame < clipEndFrame(second)
		&& second.timelineStartFrame < clipEndFrame(first);
}

/** @param {AudioEditorProjectV1} project @returns {number} */
export function projectDurationFrames(project) {
	return project.clips.reduce((endFrame, clip) => Math.max(endFrame, clipEndFrame(clip)), 0);
}

/** @param {AudioEditorProjectV1} project @returns {number} */
export function aggregateStereoMinutes(project) {
	const usedSourceIds = new Set(project.clips.map((clip) => clip.sourceId));
	const uniqueSources = new Map(project.sources.filter((source) => usedSourceIds.has(source.id)).map((source) => [source.id, source]));
	let channelFrames = 0;
	for (const source of uniqueSources.values()) channelFrames += source.frameCount * source.channelCount;
	return channelFrames / (AUDIO_EDITOR_SAMPLE_RATE * AUDIO_EDITOR_MASTER_CHANNELS * 60);
}

export function projectEnvelope(project, options = {}) {
	const mobile = Boolean(options.mobile);
	const limits = mobile
		? { trackCount: 4, stereoMinutes: 10 }
		: { trackCount: 8, stereoMinutes: 30 };
	const actual = {
		trackCount: project.tracks.length,
		stereoMinutes: aggregateStereoMinutes(project),
	};
	const exceeded = {
		tracks: actual.trackCount > limits.trackCount,
		stereoMinutes: actual.stereoMinutes > limits.stereoMinutes,
	};
	return {
		mobile,
		limits,
		actual,
		exceeded,
		supported: !exceeded.tracks && !exceeded.stereoMinutes,
	};
}

export function commitProject(project, mutate, options = {}) {
	validateAudioEditorProject(project);
	const draft = cloneProject(project);
	mutate(draft);
	draft.revision = project.revision + 1;
	draft.updatedAt = isoTimestamp(options.now);
	validateAudioEditorProject(draft);
	return draft;
}

/** @param {AudioEditorProjectV1} project @returns {true} */
export function validateAudioEditorProject(project) {
	if (!project || typeof project !== 'object') throw new TypeError('An audio editor project is required.');
	if (project.schemaVersion !== AUDIO_EDITOR_SCHEMA_VERSION) {
		throw new RangeError(`Unsupported audio editor schema version: ${project.schemaVersion}.`);
	}
	if (project.sampleRate !== AUDIO_EDITOR_SAMPLE_RATE || project.masterChannels !== AUDIO_EDITOR_MASTER_CHANNELS) {
		throw new RangeError('Audio editor projects must use a 48 kHz stereo master.');
	}
	assertFrame(project.revision, 'project.revision');
	if (!Array.isArray(project.sources) || !Array.isArray(project.clips) || !Array.isArray(project.tracks)) {
		throw new TypeError('Project sources, clips, and tracks must be arrays.');
	}

	assertUniqueIds(project.sources, 'source');
	assertUniqueIds(project.clips, 'clip');
	assertUniqueIds(project.tracks, 'track');
	const sourceIds = new Set(project.sources.map((source) => source.id));
	const clipIds = new Set(project.clips.map((clip) => clip.id));
	const referencedClipIds = new Set();
	let armedTracks = 0;

	for (const source of project.sources) createAudioSource(source);
	for (const clip of project.clips) {
		const normalized = createAudioClip(clip);
		if (!sourceIds.has(normalized.sourceId)) throw new ReferenceError(`Clip ${clip.id} references a missing source.`);
		const source = findSource(project, normalized.sourceId);
		if (normalized.sourceStartFrame + normalized.durationFrames > source.frameCount) {
			throw new RangeError(`Clip ${clip.id} exceeds its source bounds.`);
		}
	}

	for (const track of project.tracks) {
		createAudioTrack(track);
		if (track.armed) armedTracks += 1;
		if (!Array.isArray(track.clipIds)) throw new TypeError(`Track ${track.id} must contain clip IDs.`);
		const trackClips = [];
		for (const clipId of track.clipIds) {
			if (!clipIds.has(clipId)) throw new ReferenceError(`Track ${track.id} references a missing clip.`);
			if (referencedClipIds.has(clipId)) throw new RangeError(`Clip ${clipId} is assigned to more than one track.`);
			referencedClipIds.add(clipId);
			trackClips.push(findClip(project, clipId));
		}
		trackClips.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame);
		for (let index = 1; index < trackClips.length; index += 1) {
			if (clipsOverlap(trackClips[index - 1], trackClips[index])) {
				throw new RangeError(`Clips overlap on track ${track.id}.`);
			}
		}
	}

	if (referencedClipIds.size !== project.clips.length) throw new RangeError('Every clip must belong to exactly one track.');
	if (armedTracks > 1) throw new RangeError('Only one track can be armed at a time.');
	finiteInRange(project.master?.gain, 0, 4, 'master.gain');
	if (!Array.isArray(project.master?.effects)) throw new TypeError('Master effects must be an array.');
	return true;
}

function assertUniqueIds(items, type) {
	const ids = new Set();
	for (const item of items) {
		if (!item || typeof item.id !== 'string' || !item.id) throw new TypeError(`Every ${type} needs an ID.`);
		if (ids.has(item.id)) throw new RangeError(`Duplicate ${type} ID: ${item.id}.`);
		ids.add(item.id);
	}
}

export function loadAudioEditorProject(value) {
	if (!value || typeof value !== 'object') throw new TypeError('A saved project is required.');
	if (Number(value.schemaVersion) > AUDIO_EDITOR_SCHEMA_VERSION) {
		return { project: plainClone(value), readOnly: true, reason: 'newer-schema' };
	}
	validateAudioEditorProject(value);
	return { project: cloneProject(value), readOnly: false, reason: null };
}
