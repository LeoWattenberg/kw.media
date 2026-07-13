import {
	assertFrame,
	assertPositiveFrame,
	clipEndFrame,
	clipsOverlap,
	commitProject,
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createStableId,
	findClip,
	findClipTrack,
	findSource,
	findTrack,
	normalizeFrameRange,
} from './project.js';
import { createEffect, normalizeEffect, updateEffect } from './effects.js';

/**
 * A JSON-safe command. Commands that create clips carry their generated stable
 * IDs so replay never depends on random state.
 *
 * @typedef {Object} AudioEditorCommand
 * @property {string} type
 * @property {*} [commands]
 * @property {*} [source]
 * @property {*} [track]
 * @property {*} [clip]
 */

/**
 * @typedef {Object} AudioEditorClipboardV1
 * @property {1} schemaVersion
 * @property {number} sampleRate
 * @property {number} durationFrames
 * @property {Array<{sourceTrackId: string, sourceTrackName: string, clips: Object[]}>} tracks
 */

/**
 * @param {import('./project.js').AudioEditorProjectV1} project
 * @param {AudioEditorCommand} command
 * @returns {import('./project.js').AudioEditorProjectV1}
 */
export function applyEditorCommand(project, command, options = {}) {
	if (!command || typeof command.type !== 'string') throw new TypeError('A serializable editor command is required.');
	return commitProject(project, (draft) => mutateCommand(draft, command), options);
}

function mutateCommand(project, command) {
	switch (command.type) {
		case 'batch':
			if (!Array.isArray(command.commands) || !command.commands.length) throw new TypeError('A command batch cannot be empty.');
			for (const child of command.commands) mutateCommand(project, child);
			break;
		case 'project/rename':
			project.title = String(command.title || '').trim();
			if (!project.title) throw new RangeError('A project title is required.');
			break;
		case 'selection/set':
			setSelection(project, command);
			break;
		case 'loop/set':
			setLoop(project, command);
			break;
		case 'source/add':
			addSource(project, command.source);
			break;
		case 'source/remove':
			removeSource(project, command.sourceId);
			break;
		case 'track/add':
			addTrack(project, command.track, command.index);
			break;
		case 'track/remove':
			removeTrack(project, command.trackId);
			break;
		case 'track/update':
			updateTrack(project, command.trackId, command.changes);
			break;
		case 'master/update':
			updateMaster(project, command.changes);
			break;
		case 'clip/add':
			addClip(project, command.trackId, command.clip);
			break;
		case 'clip/remove':
			removeClip(project, command.clipId);
			break;
		case 'clip/update':
			updateClip(project, command.clipId, command.changes);
			break;
		case 'clip/move':
			moveClip(project, command);
			break;
		case 'clip/trim':
			trimClip(project, command);
			break;
		case 'clip/split':
			splitClip(project, command);
			break;
		case 'range/lift-delete':
			deleteRange(project, command, false);
			break;
		case 'range/ripple-delete':
			deleteRange(project, command, true);
			break;
		case 'range/replace':
			replaceRange(project, command);
			break;
		case 'clipboard/paste':
			pasteClipboard(project, command);
			break;
		case 'punch/replace':
			punchReplace(project, command);
			break;
		case 'effect/add':
			addEffect(project, command);
			break;
		case 'effect/update':
			updateRackEffect(project, command);
			break;
		case 'effect/remove':
			removeEffect(project, command);
			break;
		case 'effect/reorder':
			reorderEffect(project, command);
			break;
		default:
			throw new RangeError(`Unsupported editor command: ${command.type}.`);
	}
}

function setSelection(project, command) {
	const startFrame = assertFrame(command.startFrame, 'selection.startFrame');
	const endFrame = assertFrame(command.endFrame, 'selection.endFrame');
	project.selection = startFrame <= endFrame
		? { startFrame, endFrame }
		: { startFrame: endFrame, endFrame: startFrame };
}

function setLoop(project, command) {
	if (!command.enabled) {
		project.loop = { ...project.loop, enabled: false };
		return;
	}
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'loop');
	project.loop = { enabled: true, startFrame: range.startFrame, endFrame: range.endFrame };
}

function addSource(project, value) {
	const source = createAudioSource(value);
	assertUnusedId(project.sources, source.id, 'source');
	project.sources.push(source);
}

function removeSource(project, sourceId) {
	if (project.clips.some((clip) => clip.sourceId === sourceId)) throw new RangeError('A source in use cannot be removed.');
	const index = project.sources.findIndex((source) => source.id === sourceId);
	if (index < 0) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	project.sources.splice(index, 1);
}

function addTrack(project, value, requestedIndex) {
	const effects = Array.isArray(value?.effects) ? value.effects.map(normalizeEffect) : [];
	const track = createAudioTrack({ ...value, effects });
	assertUnusedId(project.tracks, track.id, 'track');
	if (track.clipIds.length) throw new RangeError('Add clips after adding a track.');
	const effectIds = new Set(allEffects(project).map((effect) => effect.id));
	for (const effect of track.effects) {
		if (effectIds.has(effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
		effectIds.add(effect.id);
	}
	if (track.armed) for (const other of project.tracks) other.armed = false;
	const index = requestedIndex == null ? project.tracks.length : insertionIndex(requestedIndex, project.tracks.length);
	project.tracks.splice(index, 0, track);
}

function removeTrack(project, trackId) {
	const index = project.tracks.findIndex((track) => track.id === trackId);
	if (index < 0) throw new ReferenceError(`Unknown track: ${trackId}.`);
	const clipIds = new Set(project.tracks[index].clipIds);
	project.clips = project.clips.filter((clip) => !clipIds.has(clip.id));
	project.tracks.splice(index, 1);
	disableAutoDuckForRemovedControlTrack(project, trackId);
}

function disableAutoDuckForRemovedControlTrack(project, controlTrackId) {
	const racks = [project.master.effects, ...project.tracks.map((track) => track.effects)];
	for (const rack of racks) {
		for (let index = 0; index < rack.length; index += 1) {
			const effect = rack[index];
			if (effect.type !== 'audacity-auto-duck' || effect.context?.controlTrackId !== controlTrackId) continue;
			rack[index] = updateEffect(effect, {
				enabled: false,
				context: { controlTrackId: null },
			});
		}
	}
}

function updateTrack(project, trackId, changes = {}) {
	const track = requireTrack(project, trackId);
	const allowed = new Set(['name', 'gain', 'pan', 'mute', 'solo', 'armed']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Track field cannot be updated: ${key}.`);
	const updated = createAudioTrack({ ...track, ...changes, effects: track.effects, clipIds: track.clipIds });
	Object.assign(track, updated);
	if (track.armed) for (const other of project.tracks) if (other.id !== track.id) other.armed = false;
}

function updateMaster(project, changes = {}) {
	const keys = Object.keys(changes);
	if (keys.some((key) => key !== 'gain')) throw new RangeError('Only master gain can be updated directly.');
	const gain = Number(changes.gain);
	if (!Number.isFinite(gain) || gain < 0 || gain > 4) throw new RangeError('Master gain must be between 0 and 4.');
	project.master.gain = gain;
}

function addClip(project, trackId, value) {
	const track = requireTrack(project, trackId);
	const clip = createAudioClip(value);
	assertUnusedId(project.clips, clip.id, 'clip');
	assertClipSourceBounds(project, clip);
	assertClipSpace(project, track, clip);
	project.clips.push(clip);
	track.clipIds.push(clip.id);
	sortTrack(project, track);
}

function removeClip(project, clipId) {
	const track = requireClipTrack(project, clipId);
	track.clipIds = track.clipIds.filter((id) => id !== clipId);
	project.clips = project.clips.filter((clip) => clip.id !== clipId);
}

function updateClip(project, clipId, changes = {}) {
	const clip = requireClip(project, clipId);
	const track = requireClipTrack(project, clipId);
	const allowed = new Set(['gain', 'fadeInFrames', 'fadeOutFrames', 'reversed']);
	for (const key of Object.keys(changes)) if (!allowed.has(key)) throw new RangeError(`Clip field cannot be updated: ${key}.`);
	const updated = createAudioClip({ ...clip, ...changes, id: clip.id });
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
}

function moveClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const oldTrack = requireClipTrack(project, clip.id);
	const targetTrack = requireTrack(project, command.trackId || oldTrack.id);
	const updated = createAudioClip({
		...clip,
		timelineStartFrame: command.timelineStartFrame,
		id: clip.id,
	});
	assertClipSpace(project, targetTrack, updated, clip.id);
	replaceClip(project, updated);
	if (targetTrack.id !== oldTrack.id) {
		oldTrack.clipIds = oldTrack.clipIds.filter((id) => id !== clip.id);
		targetTrack.clipIds.push(clip.id);
	}
	sortTrack(project, oldTrack);
	sortTrack(project, targetTrack);
}

function trimClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const track = requireClipTrack(project, clip.id);
	const updated = createAudioClip({
		...clip,
		timelineStartFrame: command.timelineStartFrame ?? clip.timelineStartFrame,
		sourceStartFrame: command.sourceStartFrame ?? clip.sourceStartFrame,
		durationFrames: command.durationFrames ?? clip.durationFrames,
		fadeInFrames: command.fadeInFrames ?? Math.min(clip.fadeInFrames, command.durationFrames ?? clip.durationFrames),
		fadeOutFrames: command.fadeOutFrames ?? Math.min(clip.fadeOutFrames, command.durationFrames ?? clip.durationFrames),
		id: clip.id,
	});
	assertClipSourceBounds(project, updated);
	assertClipSpace(project, track, updated, clip.id);
	replaceClip(project, updated);
	sortTrack(project, track);
}

function splitClip(project, command) {
	const clip = requireClip(project, command.clipId);
	const track = requireClipTrack(project, clip.id);
	const atFrame = assertFrame(command.atFrame, 'split.atFrame');
	if (atFrame <= clip.timelineStartFrame || atFrame >= clipEndFrame(clip)) {
		throw new RangeError('A split must be inside the clip.');
	}
	if (!command.rightClipId) throw new TypeError('A stable rightClipId is required for a replayable split.');
	assertUnusedId(project.clips, command.rightClipId, 'clip');
	const left = segmentOfClip(clip, clip.timelineStartFrame, atFrame, clip.timelineStartFrame, clip.id);
	const right = segmentOfClip(clip, atFrame, clipEndFrame(clip), atFrame, command.rightClipId);
	replaceClip(project, left);
	project.clips.push(right);
	const index = track.clipIds.indexOf(clip.id);
	track.clipIds.splice(index + 1, 0, right.id);
	sortTrack(project, track);
}

export function prepareSplitCommand(clipId, atFrame, idFactory = createStableId) {
	return { type: 'clip/split', clipId, atFrame, rightClipId: idFactory('clip') };
}

function deleteRange(project, command, ripple) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'delete range');
	const trackIds = command.trackIds || project.tracks.map((track) => track.id);
	for (const trackId of trackIds) {
		const track = requireTrack(project, trackId);
		processTrackRange(project, track, range, ripple, command.splitClipIds || {});
	}
}

function processTrackRange(project, track, range, ripple, splitClipIds) {
	const originals = track.clipIds.map((clipId) => requireClip(project, clipId));
	const replacements = [];
	const deletedIds = new Set(track.clipIds);
	for (const clip of originals) {
		const start = clip.timelineStartFrame;
		const end = clipEndFrame(clip);
		if (end <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (start >= range.endFrame) {
			replacements.push({ ...clip, timelineStartFrame: ripple ? start - range.durationFrames : start });
			continue;
		}

		const hasLeft = start < range.startFrame;
		const hasRight = end > range.endFrame;
		if (hasLeft) replacements.push(segmentOfClip(clip, start, range.startFrame, start, clip.id));
		if (hasRight) {
			const rightId = hasLeft ? splitClipIds[clip.id] : clip.id;
			if (!rightId) throw new TypeError(`A stable split clip ID is required for ${clip.id}.`);
			if (hasLeft) assertUnusedId(project.clips, rightId, 'clip');
			const timelineStartFrame = ripple ? range.startFrame : range.endFrame;
			replacements.push(segmentOfClip(clip, range.endFrame, end, timelineStartFrame, rightId));
		}
	}

	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...replacements);
	track.clipIds = replacements
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame)
		.map((clip) => clip.id);
}

export function prepareRangeDeleteCommand(project, options = {}, idFactory = createStableId) {
	const type = options.ripple ? 'range/ripple-delete' : 'range/lift-delete';
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'delete range');
	const trackIds = options.trackIds || project.tracks.map((track) => track.id);
	const splitClipIds = {};
	for (const trackId of trackIds) {
		for (const clipId of requireTrack(project, trackId).clipIds) {
			const clip = requireClip(project, clipId);
			if (clip.timelineStartFrame < range.startFrame && clipEndFrame(clip) > range.endFrame) {
				splitClipIds[clip.id] = idFactory('clip');
			}
		}
	}
	return { type, trackIds: [...trackIds], ...range, splitClipIds };
}

/** @returns {AudioEditorClipboardV1} */
export function createClipboardDescriptor(project, options = {}) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'clipboard range');
	const trackIds = options.trackIds || project.tracks.map((track) => track.id);
	return {
		schemaVersion: 1,
		sampleRate: project.sampleRate,
		durationFrames: range.durationFrames,
		tracks: trackIds.map((trackId) => {
			const track = requireTrack(project, trackId);
			const clips = track.clipIds.flatMap((clipId) => {
				const clip = requireClip(project, clipId);
				const startFrame = Math.max(range.startFrame, clip.timelineStartFrame);
				const endFrame = Math.min(range.endFrame, clipEndFrame(clip));
				if (endFrame <= startFrame) return [];
				const segment = segmentOfClip(clip, startFrame, endFrame, startFrame - range.startFrame, clip.id);
				return [{
					key: `${clip.id}:${startFrame}:${endFrame}`,
					sourceId: segment.sourceId,
					offsetFrame: segment.timelineStartFrame,
					sourceStartFrame: segment.sourceStartFrame,
					durationFrames: segment.durationFrames,
					gain: segment.gain,
					fadeInFrames: segment.fadeInFrames,
					fadeOutFrames: segment.fadeOutFrames,
					reversed: segment.reversed,
				}];
			});
			return { sourceTrackId: track.id, sourceTrackName: track.name, clips };
		}),
	};
}

export function preparePasteCommand(clipboard, options = {}, idFactory = createStableId) {
	const clipIds = {};
	for (const track of clipboard.tracks || []) {
		for (const clip of track.clips || []) clipIds[clip.key] = idFactory('clip');
	}
	return {
		type: 'clipboard/paste',
		clipboard,
		atFrame: assertFrame(options.atFrame ?? 0, 'paste.atFrame'),
		trackMap: { ...(options.trackMap || {}) },
		clipIds,
	};
}

export function prepareCut(project, options = {}, idFactory = createStableId) {
	return {
		clipboard: createClipboardDescriptor(project, options),
		command: prepareRangeDeleteCommand(project, { ...options, ripple: Boolean(options.ripple) }, idFactory),
	};
}

function pasteClipboard(project, command) {
	const clipboard = command.clipboard;
	if (!clipboard || clipboard.schemaVersion !== 1 || clipboard.sampleRate !== project.sampleRate) {
		throw new RangeError('The clipboard is incompatible with this project.');
	}
	const atFrame = assertFrame(command.atFrame, 'paste.atFrame');
	const additions = [];
	for (const clipboardTrack of clipboard.tracks || []) {
		const targetTrack = requireTrack(project, command.trackMap?.[clipboardTrack.sourceTrackId] || clipboardTrack.sourceTrackId);
		for (const descriptor of clipboardTrack.clips || []) {
			const id = command.clipIds?.[descriptor.key];
			if (!id) throw new TypeError(`A stable pasted clip ID is required for ${descriptor.key}.`);
			assertUnusedId(project.clips, id, 'clip');
			const clip = createAudioClip({ ...descriptor, id, timelineStartFrame: atFrame + descriptor.offsetFrame });
			assertClipSourceBounds(project, clip);
			assertClipSpace(project, targetTrack, clip, null, additions.filter((addition) => addition.track.id === targetTrack.id).map((addition) => addition.clip));
			additions.push({ track: targetTrack, clip });
		}
	}
	for (const { track, clip } of additions) {
		project.clips.push(clip);
		track.clipIds.push(clip.id);
	}
	for (const track of new Set(additions.map((addition) => addition.track))) sortTrack(project, track);
}

export function preparePunchCommand(project, options = {}, idFactory = createStableId) {
	const rangeCommand = prepareRangeDeleteCommand(project, {
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		trackIds: [options.trackId],
	}, idFactory);
	return {
		type: 'punch/replace',
		trackId: options.trackId,
		startFrame: options.startFrame,
		endFrame: options.endFrame,
		sourceId: options.sourceId,
		sourceStartFrame: options.sourceStartFrame ?? 0,
		clipId: options.clipId || idFactory('clip'),
		splitClipIds: rangeCommand.splitClipIds,
	};
}

/**
 * Prepare an Audacity-style replacement of one track range with an immutable
 * source. The source's complete frame range becomes the replacement clip, and
 * later material on that track ripples by outputFrames - inputFrames.
 */
export function prepareRangeReplacementCommand(project, options = {}, idFactory = createStableId) {
	const range = normalizeFrameRange(options.startFrame, options.endFrame, 'replacement range');
	const track = requireTrack(project, options.trackId);
	const sourceId = options.source?.id || idFactory('source');
	const source = normalizeRangeReplacementSource({ ...(options.source || {}), id: sourceId });
	assertUnusedId(project.sources, source.id, 'source');
	const clipId = requireStableCommandId(options.clipId || idFactory('clip'), 'replacement clip');
	const generatedClipIds = new Set();
	reserveReplacementClipId(project, clipId, generatedClipIds);
	const splitClipIds = {};
	for (const existingClipId of track.clipIds) {
		const clip = requireClip(project, existingClipId);
		if (clip.timelineStartFrame < range.startFrame && clipEndFrame(clip) > range.endFrame) {
			const rightId = requireStableCommandId(idFactory('clip'), `right segment for ${clip.id}`);
			reserveReplacementClipId(project, rightId, generatedClipIds);
			splitClipIds[clip.id] = rightId;
		}
	}
	return {
		type: 'range/replace',
		trackId: track.id,
		...range,
		source,
		clipId,
		splitClipIds,
	};
}

function replaceRange(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'replacement range');
	const track = requireTrack(project, command.trackId);
	const source = normalizeRangeReplacementSource(command.source);
	const clipId = requireStableCommandId(command.clipId, 'replacement clip');
	assertUnusedId(project.sources, source.id, 'source');
	const generatedClipIds = new Set();
	reserveReplacementClipId(project, clipId, generatedClipIds);

	const originals = track.clipIds.map((id) => requireClip(project, id));
	const deletedIds = new Set(track.clipIds);
	const replacements = [];
	const timelineDelta = source.frameCount - range.durationFrames;
	for (const clip of originals) {
		const startFrame = clip.timelineStartFrame;
		const endFrame = clipEndFrame(clip);
		if (endFrame <= range.startFrame) {
			replacements.push(clip);
			continue;
		}
		if (startFrame >= range.endFrame) {
			replacements.push(createAudioClip({
				...clip,
				timelineStartFrame: startFrame + timelineDelta,
				id: clip.id,
			}));
			continue;
		}

		const hasLeft = startFrame < range.startFrame;
		const hasRight = endFrame > range.endFrame;
		if (hasLeft) replacements.push(segmentOfClip(clip, startFrame, range.startFrame, startFrame, clip.id));
		if (hasRight) {
			const rightId = hasLeft
				? requireStableCommandId(command.splitClipIds?.[clip.id], `right segment for ${clip.id}`)
				: clip.id;
			if (hasLeft) reserveReplacementClipId(project, rightId, generatedClipIds);
			replacements.push(segmentOfClip(
				clip,
				range.endFrame,
				endFrame,
				range.startFrame + source.frameCount,
				rightId,
			));
		}
	}

	const replacement = createAudioClip({
		id: clipId,
		sourceId: source.id,
		timelineStartFrame: range.startFrame,
		sourceStartFrame: 0,
		durationFrames: source.frameCount,
	});
	const nextTrackClips = [...replacements, replacement]
		.sort((first, second) => first.timelineStartFrame - second.timelineStartFrame || first.id.localeCompare(second.id));
	project.sources.push(source);
	validateTrackReplacement(project, track, deletedIds, nextTrackClips);
	project.clips = project.clips.filter((clip) => !deletedIds.has(clip.id));
	project.clips.push(...nextTrackClips);
	track.clipIds = nextTrackClips.map((clip) => clip.id);
}

function punchReplace(project, command) {
	const range = normalizeFrameRange(command.startFrame, command.endFrame, 'punch range');
	const track = requireTrack(project, command.trackId);
	processTrackRange(project, track, range, false, command.splitClipIds || {});
	addClip(project, track.id, {
		id: command.clipId,
		sourceId: command.sourceId,
		timelineStartFrame: range.startFrame,
		sourceStartFrame: command.sourceStartFrame ?? 0,
		durationFrames: range.durationFrames,
	});
}

function addEffect(project, command) {
	const rack = getRack(project, command);
	const effect = command.effect?.type ? normalizeEffect(command.effect) : createEffect(command.effectType, command.effect || {});
	if (allEffects(project).some((item) => item.id === effect.id)) throw new RangeError(`Duplicate effect ID: ${effect.id}.`);
	const index = command.index == null ? rack.length : insertionIndex(command.index, rack.length);
	rack.splice(index, 0, effect);
}

function updateRackEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	rack[index] = updateEffect(rack[index], command.changes || {});
}

function removeEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	rack.splice(index, 1);
}

function reorderEffect(project, command) {
	const rack = getRack(project, command);
	const index = rack.findIndex((effect) => effect.id === command.effectId);
	if (index < 0) throw new ReferenceError(`Unknown effect: ${command.effectId}.`);
	const toIndex = Number(command.toIndex);
	if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= rack.length) throw new RangeError('Effect destination is out of bounds.');
	const [effect] = rack.splice(index, 1);
	rack.splice(toIndex, 0, effect);
}

function getRack(project, command) {
	if (command.scope === 'master') return project.master.effects;
	if (command.scope === 'track') return requireTrack(project, command.trackId).effects;
	throw new RangeError('Effect scope must be track or master.');
}

function allEffects(project) {
	return [...project.master.effects, ...project.tracks.flatMap((track) => track.effects)];
}

function segmentOfClip(clip, segmentStartFrame, segmentEndFrame, timelineStartFrame, id) {
	const offsetFrames = segmentStartFrame - clip.timelineStartFrame;
	const durationFrames = segmentEndFrame - segmentStartFrame;
	const sourceStartFrame = clip.reversed
		? clip.sourceStartFrame + clip.durationFrames - offsetFrames - durationFrames
		: clip.sourceStartFrame + offsetFrames;
	return createAudioClip({
		...clip,
		id,
		timelineStartFrame,
		sourceStartFrame,
		durationFrames,
		fadeInFrames: segmentStartFrame === clip.timelineStartFrame ? Math.min(clip.fadeInFrames, durationFrames) : 0,
		fadeOutFrames: segmentEndFrame === clipEndFrame(clip) ? Math.min(clip.fadeOutFrames, durationFrames) : 0,
	});
}

function assertClipSourceBounds(project, clip) {
	const source = findSource(project, clip.sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${clip.sourceId}.`);
	if (clip.sourceStartFrame + clip.durationFrames > source.frameCount) throw new RangeError('Clip exceeds its source bounds.');
}

function assertClipSpace(project, track, candidate, excludedClipId = null, additionalClips = []) {
	const clips = track.clipIds
		.filter((clipId) => clipId !== excludedClipId)
		.map((clipId) => requireClip(project, clipId));
	if ([...clips, ...additionalClips].some((clip) => clipsOverlap(clip, candidate))) {
		throw new RangeError(`Clip overlaps existing material on track ${track.id}.`);
	}
}

function validateTrackReplacement(project, track, deletedIds, clips) {
	const ids = new Set(project.clips.filter((clip) => !deletedIds.has(clip.id)).map((clip) => clip.id));
	for (const clip of clips) {
		if (ids.has(clip.id)) throw new RangeError(`Duplicate clip ID: ${clip.id}.`);
		ids.add(clip.id);
		assertClipSourceBounds(project, clip);
	}
	for (let index = 1; index < clips.length; index += 1) {
		if (clipsOverlap(clips[index - 1], clips[index])) {
			throw new RangeError(`Range replacement overlaps existing material on track ${track.id}.`);
		}
	}
}

function normalizeRangeReplacementSource(value) {
	if (!value || typeof value.id !== 'string' || !value.id) {
		throw new TypeError('A stable replacement source ID is required.');
	}
	if (!Number.isSafeInteger(value.frameCount) || value.frameCount <= 0) {
		throw new RangeError('Range replacement output must contain at least one frame.');
	}
	return createAudioSource(value);
}

function requireStableCommandId(value, name) {
	if (typeof value !== 'string' || !value) throw new TypeError(`A stable ${name} ID is required.`);
	return value;
}

function reserveReplacementClipId(project, id, reservedIds) {
	assertUnusedId(project.clips, id, 'clip');
	if (reservedIds.has(id)) throw new RangeError(`Duplicate replacement clip ID: ${id}.`);
	reservedIds.add(id);
}

function sortTrack(project, track) {
	track.clipIds.sort((firstId, secondId) => {
		const first = requireClip(project, firstId);
		const second = requireClip(project, secondId);
		return first.timelineStartFrame - second.timelineStartFrame || first.id.localeCompare(second.id);
	});
}

function replaceClip(project, value) {
	const index = project.clips.findIndex((clip) => clip.id === value.id);
	if (index < 0) throw new ReferenceError(`Unknown clip: ${value.id}.`);
	project.clips[index] = value;
}

function requireSource(project, sourceId) {
	const source = findSource(project, sourceId);
	if (!source) throw new ReferenceError(`Unknown source: ${sourceId}.`);
	return source;
}

function requireTrack(project, trackId) {
	const track = findTrack(project, trackId);
	if (!track) throw new ReferenceError(`Unknown track: ${trackId}.`);
	return track;
}

function requireClip(project, clipId) {
	const clip = findClip(project, clipId);
	if (!clip) throw new ReferenceError(`Unknown clip: ${clipId}.`);
	return clip;
}

function requireClipTrack(project, clipId) {
	const track = findClipTrack(project, clipId);
	if (!track) throw new ReferenceError(`Clip ${clipId} is not assigned to a track.`);
	return track;
}

function assertUnusedId(items, id, type) {
	if (items.some((item) => item.id === id)) throw new RangeError(`Duplicate ${type} ID: ${id}.`);
}

function insertionIndex(value, length) {
	const index = Number(value);
	if (!Number.isInteger(index) || index < 0 || index > length) throw new RangeError('Insertion index is out of bounds.');
	return index;
}

export function createAddSourceCommand(options) {
	return { type: 'source/add', source: createAudioSource(options) };
}

export function createAddTrackCommand(options = {}) {
	return { type: 'track/add', track: createAudioTrack(options) };
}

export function createAddClipCommand(trackId, options) {
	return { type: 'clip/add', trackId, clip: createAudioClip(options) };
}
