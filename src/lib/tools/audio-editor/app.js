import {
	AUDIO_EDITOR_SAMPLE_RATE,
	analyzeAudioChannels,
	audioEffectLabel,
	audioEffectTypes,
	canRedo,
	canUndo,
	cloneProject,
	createAddClipCommand,
	createAddSourceCommand,
	createAddTrackCommand,
	createAudioEditorProject,
	createClipboardDescriptor,
	createEditorHistory,
	createEffect,
	createExportPlan,
	createStableId,
	collectHistorySourceIds,
	compactEditorHistorySourceMetadata,
	editorHistoryProjects,
	evictUnreferencedSourceCaches,
	executeEditorCommand,
	findClip,
	findClipTrack,
	findSource,
	findTrack,
	loadAudioEditorProject,
	prepareCut,
	preparePasteCommand,
	preparePunchCommand,
	prepareRangeDeleteCommand,
	prepareRangeReplacementCommand,
	prepareOverwriteClipCommand,
	prepareSplitCommand,
	projectDurationFrames,
	projectEnvelope,
	createStreamingLinearResampler,
	redoEditorCommand,
	undoEditorCommand,
} from './index.js';
import {
	AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES,
	AUDACITY_EFFECT_DEFINITIONS,
	applyAudacityEffect,
	assertAudacityEffectOutput,
	audacityEffectDefaults,
	audacityEffectLabel,
	audacityEffectTypes,
	captureAudacityNoiseProfile,
	estimateAudacityEffectOutputFrames,
	estimateAudacityEffectPeakBytes,
	normalizeAudacityEffectParams,
} from './audacity-effects/index.js';
import {
	audacitySelectionChannelCount,
	matchAudacitySelectionChannels,
} from './audacity-selection.js';
import {
	createAudioEditorEngine,
	createRecordingController,
	requestMicrophone,
} from './engine.js';
import { createEditorFfmpeg } from './ffmpeg.js';
import { acquireProjectLock } from './project-lock.js';
import { createProjectStore } from './storage.js';
import { createWavStreamEncoder, encodeWav } from './wav.js';
import { decodeAup3File } from '../aup3-browser.js';

const MIN_TIMELINE_SECONDS = 10;
const DEFAULT_PIXELS_PER_SECOND = 120;
const MAX_PIXELS_PER_SECOND = AUDIO_EDITOR_SAMPLE_RATE;
const MAX_TIMELINE_PIXELS = 16_000_000;
const SOURCE_CHUNK_FRAMES = 65_536;

export function createAudioEditorController(_root = null, options = {}) {
	const copy = options.copy || {};
	const locale = options.locale === 'de' ? 'de' : 'en';
	const documentListeners = new Set();
	const telemetryListeners = new Set();
	let documentSnapshot = null;
	let telemetrySnapshot = null;
	const store = options.store || createProjectStore();
	const sourceBuffers = new Map();
	const sourcePeaks = new Map();
	const engine = options.engine || createAudioEditorEngine({
		onPosition: updatePlayhead,
		onMeter: updateMeters,
		onState: updateTransportState,
	});
	const ffmpeg = options.ffmpeg || createEditorFfmpeg({
		onLoading: () => setStatus(locale === 'de' ? 'FFmpeg wird lokal geladen…' : 'Loading local FFmpeg…'),
		onProgress: (progress) => updateExportProgress(progress),
	});
	const state = {
		history: null,
		selectedTrackId: null,
		selectedClipId: null,
		clipboard: null,
		pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
		mobile: classifyMobile(),
		timelineWidth: MIN_TIMELINE_SECONDS * DEFAULT_PIXELS_PER_SECOND,
		timelineView: 'waveform',
		readOnly: false,
		projectLock: null,
		autosaveTimer: 0,
		sourceGcTimer: 0,
		saveGeneration: 0,
		pendingSaveSnapshots: new Set(),
		recorder: null,
		recordingWriter: null,
		recordingStream: null,
		recordingStarting: false,
		importing: false,
		recordingSourceId: null,
		recordingStartFrame: 0,
		recordingSourceOffsetFrames: 0,
		recordingTrackId: null,
		recordingSelection: null,
		recordingResampler: null,
		recordingCleanup: null,
		recordingFinishing: false,
		exportAbort: null,
		exportGeneration: 0,
		outputUrl: null,
		outputCleanup: null,
		projectQueue: Promise.resolve(),
		missingSourceIds: new Set(),
		audacityEffectType: audacityEffectTypes()[0],
		audacityEffectParams: {},
		audacityEffectTouchedParams: new Map(),
		audacityControlTrackId: null,
		audacityNoiseProfile: null,
		audacityEffectProcessing: false,
		audacityEffectWorker: null,
		phase: 'loading',
		projects: [],
		status: { message: copy.ready || '', state: 'info' },
		saveState: 'saved',
		storageEstimate: { usage: null, quota: null },
		analysisResult: null,
		analysisVisuals: null,
		exportProgress: 0,
		exportOutput: null,
		monitoring: false,
		latencyOffsetMs: 0,
		positionFrame: 0,
		durationFrames: 0,
		transportState: 'stopped',
		meters: { tracks: {}, master: null },
		inputMeterDb: -60,
		disposed: false,
	};
	let project = null;

	const ready = bootstrap()
		.then(() => {
			state.phase = 'ready';
			publishDocumentSnapshot();
			return getSnapshot();
		})
		.catch((error) => {
			state.phase = 'error';
			handleError(error);
			publishDocumentSnapshot();
			return getSnapshot();
		});
	const actions = createControllerActions();

	return {
		ready,
		get project() { return state.history?.present ?? null; },
		get engine() { return engine; },
		get headless() { return true; },
		getSnapshot,
		subscribe: (listener) => subscribeTo(documentListeners, listener),
		getTelemetrySnapshot,
		subscribeTelemetry: (listener) => subscribeTo(telemetryListeners, listener),
		getClipVisualData,
		actions,
		async dispose() {
			if (state.disposed) return;
			state.disposed = true;
			state.phase = 'disposed';
			publishDocumentSnapshot();
			globalThis.clearTimeout(state.autosaveTimer);
			globalThis.clearTimeout(state.sourceGcTimer);
			state.audacityEffectWorker?.terminate();
			state.audacityEffectWorker = null;
			await stopRecording().catch(() => undefined);
			state.projectLock?.release();
			state.projectLock = null;
			if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
			await state.outputCleanup?.();
			ffmpeg.dispose();
			await engine.dispose();
			await store.close?.();
			documentListeners.clear();
			telemetryListeners.clear();
		},
	};

	function subscribeTo(listeners, listener) {
		if (typeof listener !== 'function') throw new TypeError('Audio editor subscribers must be functions.');
		listeners.add(listener);
		return () => listeners.delete(listener);
	}

	function getSnapshot() {
		if (!documentSnapshot) documentSnapshot = buildDocumentSnapshot();
		return documentSnapshot;
	}

	function getTelemetrySnapshot() {
		if (!telemetrySnapshot) telemetrySnapshot = buildTelemetrySnapshot();
		return telemetrySnapshot;
	}

	function publishDocumentSnapshot() {
		documentSnapshot = buildDocumentSnapshot();
		for (const listener of [...documentListeners]) listener();
	}

	function publishTelemetrySnapshot() {
		telemetrySnapshot = buildTelemetrySnapshot();
		for (const listener of [...telemetryListeners]) listener();
	}

	function buildDocumentSnapshot() {
		const currentProject = state.history?.present ?? null;
		const selection = currentProject?.selection && currentProject.selection.endFrame > currentProject.selection.startFrame
			? currentProject.selection
			: null;
		return Object.freeze({
			ready: state.phase === 'ready',
			phase: state.phase,
			headless: true,
			locale,
			project: currentProject,
			projects: state.projects,
			selectedTrackId: state.selectedTrackId,
			selectedClipId: state.selectedClipId,
			selection,
			readOnly: state.readOnly,
			importing: state.importing,
			recordingStarting: state.recordingStarting,
			recording: Boolean(state.recorder),
			processingEffect: state.audacityEffectProcessing,
			exporting: Boolean(state.exportAbort),
			timeline: Object.freeze({
				view: state.timelineView,
				pixelsPerSecond: state.pixelsPerSecond,
				width: state.timelineWidth,
			}),
			history: Object.freeze({
				canUndo: Boolean(state.history && canUndo(state.history)),
				canRedo: Boolean(state.history && canRedo(state.history)),
				hasClipboard: Boolean(state.clipboard),
			}),
			status: Object.freeze({ ...state.status }),
			save: Object.freeze({ state: state.saveState }),
			storage: Object.freeze({ ...state.storageEstimate }),
			analysis: state.analysisResult,
			analysisVisuals: state.analysisVisuals,
			export: Object.freeze({ progress: state.exportProgress, output: state.exportOutput }),
			effects: Object.freeze({
				rackTypes: Object.freeze(audioEffectTypes().map((type) => Object.freeze({ type, label: audioEffectLabel(type, locale) }))),
				selectionTypes: Object.freeze(audacityEffectTypes().map((type) => Object.freeze({ type, label: audacityEffectLabel(type, locale) }))),
				selectionType: state.audacityEffectType,
				selectionParams: currentAudacityEffectParams(),
				selectionDefinition: AUDACITY_EFFECT_DEFINITIONS[state.audacityEffectType] || null,
				controlTrackId: state.audacityControlTrackId,
				noiseProfileReady: Boolean(state.audacityNoiseProfile),
			}),
			monitor: Object.freeze({ enabled: state.monitoring, latencyOffsetMs: state.latencyOffsetMs }),
			missingSourceIds: Object.freeze([...state.missingSourceIds]),
			disposed: state.disposed,
		});
	}

	function buildTelemetrySnapshot() {
		return Object.freeze({
			positionFrame: state.positionFrame,
			durationFrames: state.durationFrames,
			transportState: state.transportState,
			recording: Boolean(state.recorder),
			meters: state.meters,
			inputMeterDb: state.inputMeterDb,
			exportProgress: state.exportProgress,
		});
	}

	function getClipVisualData(clipId) {
		const clip = project ? findClip(project, clipId) : null;
		if (!clip) return null;
		return Object.freeze({
			clip,
			track: findClipTrack(project, clip.id),
			source: findSource(project, clip.sourceId),
			buffer: sourceBuffers.get(clip.sourceId) || null,
			peaks: sourcePeaks.get(clip.sourceId) || null,
		});
	}

	function getVisibleClips(options = {}) {
		if (!project) return [];
		const startFrame = Math.max(0, Number.isSafeInteger(options.startFrame) ? options.startFrame : 0);
		const defaultEndFrame = Math.max(startFrame, projectDurationFrames(project));
		const endFrame = Math.max(startFrame, Number.isSafeInteger(options.endFrame) ? options.endFrame : defaultEndFrame);
		const overscanFrames = Math.max(0, Number.isSafeInteger(options.overscanFrames) ? options.overscanFrames : endFrame - startFrame);
		const visibleStart = Math.max(0, startFrame - overscanFrames);
		const visibleEnd = endFrame + overscanFrames;
		return project.clips
			.filter((clip) => clip.timelineStartFrame < visibleEnd && clip.timelineStartFrame + clip.durationFrames > visibleStart)
			.map((clip) => getClipVisualData(clip.id));
	}

	function createControllerActions() {
		return Object.freeze({
			project: Object.freeze({
				create: (projectOptions) => newProject(projectOptions),
				open: (value) => openProject(value),
				openById: async (projectId) => {
					const saved = await store.loadProject(projectId);
					if (!saved) throw new Error(locale === 'de' ? 'Das Projekt wurde nicht gefunden.' : 'The project was not found.');
					return openProject(saved);
				},
				list: listProjects,
				save: saveNow,
				rename: (title) => renameProject(title),
				duplicate: (title) => duplicateProject(title),
				remove: deleteProject,
				clear: clearLocalData,
				importFiles,
			}),
			edit: Object.freeze({
				execute: handleEdit,
				commit,
				undo: () => handleEdit('undo'),
				redo: () => handleEdit('redo'),
				copy: () => handleEdit('copy'),
				cut: () => handleEdit('cut'),
				paste: () => handleEdit('paste'),
				split: () => handleEdit('split'),
				delete: () => handleEdit('delete'),
				rippleDelete: () => handleEdit('ripple-delete'),
			}),
			transport: Object.freeze({
				playPause: () => handleTransport('play'),
				stop: () => handleTransport('stop'),
				seek: (frame) => engine.seek(normalizeTimelineFrame(frame)),
				jumpStart: () => handleTransport('jump-start'),
				jumpEnd: () => handleTransport('jump-end'),
				rewind: () => handleTransport('rewind'),
				forward: () => handleTransport('forward'),
				toggleLoop: () => handleTransport('loop'),
			}),
			recording: Object.freeze({
				start: startRecording,
				stop: stopRecording,
				setMonitoring,
				setLatencyOffset,
			}),
			timeline: Object.freeze({
				selectTrack,
				selectClip,
				setSelection,
				clearSelection: () => setSelection(0, 0),
				setView: setTimelineView,
				setZoom,
				zoomIn: () => updateZoom('in'),
				zoomOut: () => updateZoom('out'),
				zoomFit: (viewportWidth) => updateZoom('fit', viewportWidth),
				getClipVisualData,
				getVisibleClips,
			}),
			track: Object.freeze({
				add: addTrack,
				update: (trackId, changes) => commit({ type: 'track/update', trackId, changes }, { selectTrackId: trackId }),
				duplicate: (trackId) => duplicateTrack(findTrack(project, trackId)),
				remove: (trackId) => commit({ type: 'track/remove', trackId }),
			}),
			clip: Object.freeze({
				update: (clipId, changes) => commit({ type: 'clip/update', clipId, changes }, { selectClipId: clipId }),
				move: (clipId, trackId, timelineStartFrame) => commit({ type: 'clip/move', clipId, trackId, timelineStartFrame }, { selectTrackId: trackId, selectClipId: clipId }),
				trim: (clipId, changes) => commit({ type: 'clip/trim', clipId, ...changes }, { selectClipId: clipId }),
				overwrite: (clipId, trackId, changes) => commit(
					prepareOverwriteClipCommand(project, clipId, { trackId, changes }),
					{ selectTrackId: trackId, selectClipId: clipId },
				),
				remove: (clipId) => commit({ type: 'clip/remove', clipId }),
				reverse: (clipId) => handleClipAction('reverse', clipId),
				normalizePeak: (clipId) => handleClipAction('normalize-peak', clipId),
				normalizeLoudness: (clipId) => handleClipAction('normalize-lufs', clipId),
			}),
			effects: Object.freeze({
				add: addEffect,
				update: (scope, trackId, effectId, changes) => commit({ type: 'effect/update', scope, trackId, effectId, changes }),
				remove: (scope, trackId, effectId) => commit({ type: 'effect/remove', scope, trackId, effectId }),
				reorder: (scope, trackId, effectId, toIndex) => commit({ type: 'effect/reorder', scope, trackId, effectId, toIndex }),
				setMasterGain: (gain) => commit({ type: 'master/update', changes: { gain: Math.max(0, Math.min(4, Number(gain))) } }),
				setSelectionType: setAudacityEffectType,
				setSelectionParams: setAudacityEffectParamsFromController,
				setControlTrack: setAudacityControlTrack,
				captureNoiseProfile: captureSelectedNoiseProfile,
				captureRackNoiseProfile: captureRackNoiseProfileFromController,
				applySelection: applyAudacityEffectFromController,
			}),
			analysis: Object.freeze({ run: runAnalysis }),
			export: Object.freeze({
				start: (settings) => handleExportAction('start', settings),
				cancel: () => handleExportAction('cancel'),
			}),
		});
	}

	async function bootstrap() {
		if (!engine || typeof engine.loadProject !== 'function') throw new Error('Web Audio is not supported in this browser.');
		await store.ready();
		await store.cleanupTemporaryAssets?.();
		void store.requestPersistentStorage();
		state.monitoring = Boolean(await store.loadSetting('input-monitor', false));
		state.latencyOffsetMs = normalizeLatencyOffset(await store.loadSetting('recording-latency-offset-ms', 0));
		const lastProjectId = await store.loadSetting('last-project-id', null);
		const saved = lastProjectId ? await store.loadProject(lastProjectId) : null;
		if (saved) await openProject(saved);
		else await newProject();
		publishProjectState();
		if (!state.readOnly) await saveNow();
		await refreshStorageUsage();
		if (state.missingSourceIds.size) setStatus(locale === 'de'
			? 'Einige lokale Audioquellen fehlen. Wiedergabe, Analyse und Export sind gesperrt, bis die betroffenen Clips entfernt werden.'
			: 'Some local audio sources are missing. Playback, analysis, and export are blocked until affected clips are removed.', 'error');
		else if (!state.readOnly) setStatus(copy.ready, 'success');
	}

	async function newProject(options = {}) {
		const nextProject = createAudioEditorProject({ title: String(options.title || copy.untitledProject).trim() || copy.untitledProject });
		const track = createAddTrackCommand({ name: `${copy.track} 1`, armed: true });
		const history = executeEditorCommand(createEditorHistory(nextProject), track);
		await switchProject(history.present, { save: true, skipFlush: options.skipFlush });
	}

	async function openProject(value) {
		const loaded = loadAudioEditorProject(value);
		await switchProject(loaded.project, { readOnly: loaded.readOnly });
		if (loaded.readOnly) setStatus(locale === 'de' ? 'Dieses Projekt stammt aus einer neueren Version und ist schreibgeschützt.' : 'This project was created by a newer version and is read-only.', 'error');
	}

	function switchProject(nextProject, options = {}) {
		const operation = state.projectQueue.then(() => performProjectSwitch(nextProject, options));
		state.projectQueue = operation.catch(() => undefined);
		return operation;
	}

	async function performProjectSwitch(nextProject, options = {}) {
		state.exportAbort?.abort();
		state.exportAbort = null;
		await stopRecording().catch(() => undefined);
		if (!options.skipFlush && project && project.id !== nextProject.id && !state.readOnly) await saveNow();
		globalThis.clearTimeout(state.autosaveTimer);
		state.autosaveTimer = 0;
		engine.stop();
		state.projectLock?.release();
		state.projectLock = await acquireProjectLock(nextProject.id);
		state.readOnly = Boolean(options.readOnly || state.projectLock.readOnly);
		state.history = compactEditorHistorySourceMetadata(createEditorHistory(nextProject));
		project = state.history.present;
		state.selectedTrackId = nextProject.tracks[0]?.id ?? null;
		state.selectedClipId = null;
		state.clipboard = null;
		state.audacityNoiseProfile = null;
		state.audacityControlTrackId = null;
		state.analysisResult = null;
		state.analysisVisuals = null;
		if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
		state.outputUrl = null;
		await state.outputCleanup?.();
		state.outputCleanup = null;
		state.exportOutput = null;
		sourceBuffers.clear();
		sourcePeaks.clear();
		state.missingSourceIds.clear();
		await loadProjectSources(project);
		engine.loadProject(project, sourceBuffers);
		await store.saveSetting('last-project-id', nextProject.id);
		if (options.save && !state.readOnly) await store.saveProject(nextProject);
		publishProjectState();
		await garbageCollectSources();
		if (state.readOnly) setStatus(locale === 'de' ? 'Das Projekt ist bereits in einem anderen Tab geöffnet.' : 'This project is already open in another tab.', 'error');
	}

	async function loadProjectSources(project) {
		const usedSourceIds = new Set((project.clips || []).map((clip) => clip.sourceId));
		if (!usedSourceIds.size) return;
		const context = await engine.getAudioContext?.({ resume: false });
		for (const source of project.sources.filter((candidate) => usedSourceIds.has(candidate.id))) {
			try {
				const buffer = await readStoredAudioBuffer(store, source, context);
				if (buffer) {
					sourceBuffers.set(source.id, buffer);
					let peaks = await store.loadAnalysis(peakCacheKey(source.id));
					if (!peaks?.levels) {
						peaks = await generateWaveformPeaks(audioBufferChannels(buffer));
						await store.saveAnalysis(peakCacheKey(source.id), peaks);
					}
					sourcePeaks.set(source.id, peaks);
				}
			} catch (error) {
				state.missingSourceIds.add(source.id);
				setStatus(`${source.name}: ${error.message}`, 'error');
			}
		}
	}

	async function listProjects() {
		await saveNow();
		state.projects = Object.freeze(await store.listProjects());
		publishDocumentSnapshot();
		return state.projects;
	}

	async function renameProject(requestedTitle) {
		if (state.readOnly) return;
		if (requestedTitle == null) throw new TypeError('A project title is required.');
		const title = String(requestedTitle).trim();
		if (title) commit({ type: 'project/rename', title });
	}

	async function duplicateProject(requestedTitle) {
		if (!project) return;
		await saveNow();
		const title = String(requestedTitle || `${project.title} ${locale === 'de' ? 'Kopie' : 'copy'}`).trim();
		const duplicated = await store.duplicateProject(project.id, { title });
		await openProject(duplicated);
		return duplicated;
	}

	async function deleteProject() {
		if (!project || state.readOnly) return;
		await stopRecording();
		const id = project.id;
		state.projectLock?.release();
		state.projectLock = null;
		await store.deleteProject(id);
		state.history = null;
		project = null;
		sourceBuffers.clear();
		sourcePeaks.clear();
		state.missingSourceIds.clear();
		await garbageCollectSources();
		await newProject({ skipFlush: true });
		await listProjects();
	}

	async function garbageCollectSources() {
		if (!store.pruneUnreferencedSources) return;
		globalThis.clearTimeout(state.sourceGcTimer);
		state.sourceGcTimer = 0;
		const protectedSourceIds = liveSessionSourceIds();
		for (const sourceId of sourceBuffers.keys()) protectedSourceIds.add(sourceId);
		for (const sourceId of sourcePeaks.keys()) protectedSourceIds.add(sourceId);
		const result = await store.pruneUnreferencedSources({
			protectedProjects: [
				...editorHistoryProjects(state.history),
				...state.pendingSaveSnapshots,
			],
			protectedSourceIds,
		});
		for (const sourceId of result.deletedSourceIds || []) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			state.missingSourceIds.delete(sourceId);
		}
		if (result.nextEligibleAt != null && !state.disposed) {
			const delay = Math.max(1_000, Math.min(2_147_000_000, result.nextEligibleAt - Date.now() + 50));
			state.sourceGcTimer = globalThis.setTimeout(() => {
				state.sourceGcTimer = 0;
				void garbageCollectSources().catch(handleError);
			}, delay);
		}
	}

	async function clearLocalData() {
		await stopRecording();
		state.projectLock?.release();
		state.projectLock = null;
		engine.stop();
		sourceBuffers.clear();
		sourcePeaks.clear();
		await store.clear();
		state.history = null;
		project = null;
		await newProject({ skipFlush: true });
		state.projects = Object.freeze([]);
		publishDocumentSnapshot();
	}

	async function importFiles(fileList) {
		const files = [...(fileList || [])];
		if (!files.length || editingBlocked()) return;
		state.importing = true;
		publishDocumentSnapshot();
		setStatus(copy.importing);
		let failures = 0;
		let successes = 0;
		const notices = [];
		for (const file of files) {
			try {
				const result = await importFile(file);
				if (result?.notice) notices.push(result.notice);
				successes += 1;
			} catch (error) {
				failures += 1;
				handleError(error);
			}
		}
		try {
			if (!failures) setStatus(notices.length ? notices.join(' ') : copy.done, 'success');
			else setStatus(locale === 'de'
				? `${successes} Datei(en) importiert, ${failures} fehlgeschlagen.`
				: `${successes} file(s) imported, ${failures} failed.`, 'error');
		} finally {
			state.importing = false;
			publishDocumentSnapshot();
		}
	}

	async function importFile(file) {
		await preflightStorage(Math.max(file.size * 8, 8 * 1024 * 1024), 'import');
		const context = await engine.getAudioContext({ resume: false });
		const aup3 = isAup3File(file);
		let decoded;
		let warnings = [];
		if (aup3) {
			setStatus(copy.aup3Importing);
			const result = await decodeAup3File(file, { onProgress: updateAup3ImportProgress });
			decoded = await bufferFromAup3Channels(result.channels, result.sampleRate, context);
			warnings = Array.isArray(result.warnings) ? result.warnings : [];
		} else {
			try {
				decoded = await engine.decodeAudioData(await file.arrayBuffer());
			} catch {
				const fallback = await ffmpeg.decode(file);
				decoded = await bufferFromChannels(fallback.channels, fallback.sampleRate, context);
			}
		}
		const canonical = await canonicalizeBuffer(decoded, context);
		await preflightStorage(canonical.length * canonical.numberOfChannels * Float32Array.BYTES_PER_ELEMENT, 'import');
		const sourceId = createStableId('source');
		const trackId = createStableId('track');
		const clipId = createStableId('clip');
		const trackName = stripExtension(file.name) || `${copy.track} ${project.tracks.length + 1}`;
		const sourceName = aup3 ? `${trackName}.wav` : file.name;
		const mimeType = aup3 ? 'audio/wav' : file.type || 'audio/wav';
		const writer = await store.beginSourceWrite(sourceId, { name: sourceName, mimeType });
		try {
			await writeBuffer(writer, canonical);
			await writer.commit({ sampleRate: AUDIO_EDITOR_SAMPLE_RATE, channelCount: canonical.numberOfChannels });
		} catch (error) {
			await writer.abort();
			throw error;
		}

		const command = {
			type: 'batch',
			commands: [
				createAddSourceCommand({ id: sourceId, storageKey: sourceId, name: sourceName, mimeType, frameCount: canonical.length, channelCount: canonical.numberOfChannels, originalSampleRate: decoded.sampleRate }),
				createAddTrackCommand({ id: trackId, name: trackName }),
				createAddClipCommand(trackId, { id: clipId, sourceId, timelineStartFrame: 0, sourceStartFrame: 0, durationFrames: canonical.length }),
			],
		};
		sourceBuffers.set(sourceId, canonical);
		try {
			const peaks = await generateWaveformPeaks(audioBufferChannels(canonical));
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			commit(command, { selectTrackId: trackId, selectClipId: clipId });
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId);
			throw error;
		}
		warnEnvelope();
		if (aup3) {
			const detail = warnings.map(formatAup3Warning).filter(Boolean).join(' ');
			return { notice: detail ? `${copy.aup3Imported} ${detail}` : copy.aup3Imported };
		}
		return null;
	}

	function updateAup3ImportProgress(progress) {
		const rawValue = typeof progress === 'number'
			? progress
			: Number(progress?.progress ?? progress?.value);
		if (!Number.isFinite(rawValue)) return;
		const percentage = rawValue <= 1 ? rawValue * 100 : rawValue;
		setStatus(`${copy.aup3Importing} ${Math.max(0, Math.min(100, Math.round(percentage)))}%`);
	}

	function addTrack(options = {}) {
		if (editingBlocked()) return;
		const trackId = options.id || createStableId('track');
		const track = createAddTrackCommand({
			...options,
			id: trackId,
			name: String(options.name || `${copy.track} ${project.tracks.length + 1}`).trim() || copy.track,
			armed: options.armed ?? project.tracks.length === 0,
		});
		commit(track, { selectTrackId: trackId });
		return trackId;
	}

	function handleEdit(action) {
		if (!state.history || editingBlocked()) return;
		try {
			if (action === 'undo') {
				state.history = undoEditorCommand(state.history);
				projectChanged();
				return;
			}
			if (action === 'redo') {
				state.history = redoEditorCommand(state.history);
				projectChanged();
				return;
			}
			const selection = activeSelection();
			const trackIds = state.selectedTrackId ? [state.selectedTrackId] : project.tracks.map((track) => track.id);
			if (action === 'copy' || action === 'cut') {
				if (!selection) throw new Error(locale === 'de' ? 'Erstelle zuerst eine Zeitauswahl.' : 'Create a time selection first.');
				if (action === 'copy') {
					state.clipboard = createClipboardDescriptor(project, { ...selection, trackIds });
					compactLiveSourceState();
					void garbageCollectSources().catch(handleError);
				}
				else {
					const prepared = prepareCut(project, { ...selection, trackIds });
					state.clipboard = prepared.clipboard;
					commit(prepared.command);
				}
				publishDocumentSnapshot();
				return;
			}
			if (action === 'paste') {
				if (!state.clipboard) return;
				const trackMap = {};
				if (state.selectedTrackId && state.clipboard.tracks.length === 1) trackMap[state.clipboard.tracks[0].sourceTrackId] = state.selectedTrackId;
				commit(preparePasteCommand(state.clipboard, { atFrame: engine.getPositionFrames(), trackMap }));
				return;
			}
			if (action === 'split') {
				if (!state.selectedClipId) return;
				commit(prepareSplitCommand(state.selectedClipId, engine.getPositionFrames()));
				return;
			}
			if (action === 'delete' && !selection && state.selectedClipId) {
				commit({ type: 'clip/remove', clipId: state.selectedClipId });
				state.selectedClipId = null;
				return;
			}
			if ((action === 'delete' || action === 'ripple-delete') && selection) {
				commit(prepareRangeDeleteCommand(project, { ...selection, trackIds, ripple: action === 'ripple-delete' }));
			}
		} catch (error) {
			handleError(error);
		}
	}

	async function handleTransport(action) {
		if ((state.recordingStarting || state.recorder) && action !== 'stop' && action !== 'record') return;
		if (state.missingSourceIds.size && action === 'play') throw new Error(locale === 'de' ? 'Lokale Audioquellen fehlen.' : 'Local audio sources are missing.');
		if (action === 'play') return engine.getState().state === 'playing' ? engine.pause() : engine.play();
		if (action === 'stop') return state.recorder ? stopRecording() : engine.stop();
		if (action === 'jump-start') return engine.seek(0);
		if (action === 'jump-end') return engine.seek(projectDurationFrames(project));
		if (action === 'rewind') return engine.seek(engine.getPositionFrames() - AUDIO_EDITOR_SAMPLE_RATE * 5);
		if (action === 'forward') return engine.seek(engine.getPositionFrames() + AUDIO_EDITOR_SAMPLE_RATE * 5);
		if (action === 'loop') {
			const selection = activeSelection();
			const enabled = !engine.getState().loop.enabled;
			const range = selection || { startFrame: 0, endFrame: projectDurationFrames(project) };
			commit({ type: 'loop/set', enabled, ...range });
			engine.setLoop(project.loop);
			return;
		}
		if (action === 'record') return state.recorder ? stopRecording() : startRecording();
	}

	function normalizeTimelineFrame(value) {
		const maximum = project ? projectDurationFrames(project) : 0;
		const frame = Number(value);
		if (!Number.isFinite(frame)) throw new TypeError('Timeline frames must be finite numbers.');
		return Math.max(0, Math.min(maximum, Math.round(frame)));
	}

	function selectTrack(trackId) {
		if (trackId != null && !findTrack(project, trackId)) throw new Error('The audio track could not be found.');
		state.selectedTrackId = trackId || null;
		state.selectedClipId = null;
		publishProjectState();
	}

	function selectClip(clipId) {
		if (clipId == null) {
			state.selectedClipId = null;
			publishProjectState();
			return;
		}
		const clip = findClip(project, clipId);
		const track = clip ? findClipTrack(project, clip.id) : null;
		if (!clip || !track) throw new Error('The audio clip could not be found.');
		state.selectedTrackId = track.id;
		state.selectedClipId = clip.id;
		publishProjectState();
	}

	function setSelection(startFrame, endFrame) {
		if (!Number.isFinite(Number(startFrame)) || !Number.isFinite(Number(endFrame))) {
			throw new TypeError('Selection frames must be finite numbers.');
		}
		const start = normalizeTimelineFrame(Math.min(Number(startFrame), Number(endFrame)));
		const end = normalizeTimelineFrame(Math.max(Number(startFrame), Number(endFrame)));
		return commit({ type: 'selection/set', startFrame: start, endFrame: end });
	}

	function setZoom(pixelsPerSecond) {
		const durationSeconds = Math.max(MIN_TIMELINE_SECONDS, projectDurationFrames(project) / AUDIO_EDITOR_SAMPLE_RATE);
		const maximum = Math.min(MAX_PIXELS_PER_SECOND, MAX_TIMELINE_PIXELS / durationSeconds);
		state.pixelsPerSecond = Math.max(1, Math.min(maximum, Number(pixelsPerSecond) || DEFAULT_PIXELS_PER_SECOND));
		renderTimeline();
		updatePlayhead(engine.getPositionFrames());
		publishDocumentSnapshot();
		return state.pixelsPerSecond;
	}

	function setMonitoring(enabled) {
		state.monitoring = Boolean(enabled);
		state.recorder?.setMonitoring(state.monitoring);
		void store.saveSetting('input-monitor', state.monitoring);
		publishDocumentSnapshot();
		return state.monitoring;
	}

	function setLatencyOffset(value) {
		state.latencyOffsetMs = normalizeLatencyOffset(value);
		void store.saveSetting('recording-latency-offset-ms', state.latencyOffsetMs);
		publishDocumentSnapshot();
		return state.latencyOffsetMs;
	}

	function commit(command, selection = {}) {
		if (state.readOnly) throw new Error(locale === 'de' ? 'Dieses Projekt ist schreibgeschützt.' : 'This project is read-only.');
		state.history = executeEditorCommand(state.history, command);
		project = state.history.present;
		if (selection.selectTrackId) state.selectedTrackId = selection.selectTrackId;
		if (selection.selectClipId) state.selectedClipId = selection.selectClipId;
		projectChanged();
		return project;
	}

	function projectChanged() {
		compactLiveSourceState();
		const selectedClipExists = state.selectedClipId && findClip(project, state.selectedClipId);
		if (!selectedClipExists) state.selectedClipId = null;
		if (state.selectedTrackId && !findTrack(project, state.selectedTrackId)) state.selectedTrackId = project.tracks[0]?.id ?? null;
		void engine.applyProject(project, sourceBuffers).catch(handleError);
		publishProjectState();
		scheduleAutosave();
	}

	function scheduleAutosave() {
		if (state.readOnly) return;
		globalThis.clearTimeout(state.autosaveTimer);
		state.saveGeneration += 1;
		const generation = state.saveGeneration;
		const snapshot = cloneProject(project);
		state.saveState = 'saving';
		publishDocumentSnapshot();
		state.autosaveTimer = globalThis.setTimeout(() => {
			state.autosaveTimer = 0;
			void saveSnapshot(snapshot, generation);
		}, 500);
	}

	async function saveNow() {
		if (!state.history || state.readOnly) return;
		globalThis.clearTimeout(state.autosaveTimer);
		state.autosaveTimer = 0;
		const generation = state.saveGeneration;
		return saveSnapshot(cloneProject(project), generation);
	}

	async function saveSnapshot(snapshot, generation) {
		state.pendingSaveSnapshots.add(snapshot);
		try {
			await store.saveProject(snapshot);
			state.pendingSaveSnapshots.delete(snapshot);
			if (project?.id === snapshot.id) await store.saveSetting('last-project-id', snapshot.id);
			if (project?.id === snapshot.id && generation === state.saveGeneration) {
				state.saveState = 'saved';
				publishDocumentSnapshot();
			}
			await garbageCollectSources();
			await refreshStorageUsage();
		} catch (error) {
			state.saveState = 'dirty';
			publishDocumentSnapshot();
			handleError(error);
		} finally {
			state.pendingSaveSnapshots.delete(snapshot);
		}
	}

	function clipboardSourceIds() {
		const ids = new Set();
		for (const clipboardTrack of state.clipboard?.tracks || []) {
			for (const clip of clipboardTrack.clips || []) if (clip.sourceId) ids.add(clip.sourceId);
		}
		return ids;
	}

	function compactLiveSourceState() {
		state.history = compactEditorHistorySourceMetadata(state.history, {
			preservePresentSourceIds: clipboardSourceIds(),
		});
		project = state.history?.present ?? null;
		evictUnreferencedSourceCaches(sourceBuffers, sourcePeaks, liveSessionSourceIds());
	}

	function liveSessionSourceIds() {
		const ids = collectHistorySourceIds(state.history);
		for (const sourceId of clipboardSourceIds()) ids.add(sourceId);
		if (state.recordingSourceId) ids.add(state.recordingSourceId);
		return ids;
	}

	function publishProjectState() {
		if (!project) {
			publishDocumentSnapshot();
			return;
		}
		const duration = projectDurationFrames(project);
		const durationSeconds = Math.max(MIN_TIMELINE_SECONDS, duration / AUDIO_EDITOR_SAMPLE_RATE);
		state.pixelsPerSecond = Math.min(state.pixelsPerSecond, MAX_TIMELINE_PIXELS / durationSeconds);
		state.timelineWidth = Math.max(1, Math.round(durationSeconds * state.pixelsPerSecond));
		updatePlayhead(engine.getPositionFrames(), duration);
		publishDocumentSnapshot();
	}

	function setTimelineView(view) {
		state.timelineView = view === 'spectrogram' ? 'spectrogram' : 'waveform';
		publishDocumentSnapshot();
		return state.timelineView;
	}

	function duplicateTrack(track) {
		if (editingBlocked() || !track) return;
		const trackId = createStableId('track');
		const effects = track.effects.map((effect) => ({ ...effect, id: createStableId('effect') }));
		const commands = [createAddTrackCommand({ ...track, id: trackId, name: `${track.name} ${locale === 'de' ? 'Kopie' : 'copy'}`, armed: false, effects, clipIds: [] })];
		let selectedClipId = null;
		for (const clipId of track.clipIds) {
			const clip = findClip(project, clipId);
			if (!clip) continue;
			const nextClipId = createStableId('clip');
			selectedClipId ||= nextClipId;
			commands.push(createAddClipCommand(trackId, { ...clip, id: nextClipId }));
		}
		commit({ type: 'batch', commands }, { selectTrackId: trackId, selectClipId: selectedClipId });
	}

	async function handleClipAction(action, clipId = state.selectedClipId) {
		if (editingBlocked()) return;
		const clip = clipId ? findClip(project, clipId) : null;
		if (!clip) return;
		if (action === 'reverse') return commit({ type: 'clip/update', clipId: clip.id, changes: { reversed: !clip.reversed } }, { selectClipId: clip.id });
		const buffer = sourceBuffers.get(clip.sourceId);
		if (!buffer) return;
		const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).subarray(clip.sourceStartFrame, clip.sourceStartFrame + clip.durationFrames));
		const result = await analyzeChannelsInWorker(channels, buffer.sampleRate);
		let gain = clip.gain;
		if (action === 'normalize-peak' && result.peakAmplitude > 0) gain = 10 ** (-1 / 20) / result.peakAmplitude;
		if (action === 'normalize-lufs' && Number.isFinite(result.integratedLufs)) gain = 10 ** ((-14 - result.integratedLufs) / 20);
		commit({ type: 'clip/update', clipId: clip.id, changes: { gain: Math.max(0, Math.min(16, gain)) } }, { selectClipId: clip.id });
	}

	function addEffect(request = {}) {
		if (editingBlocked()) return;
		if (!request.type) throw new TypeError('An effect type is required.');
		const scope = request.scope === 'master' ? 'master' : 'track';
		const trackId = request.trackId ?? state.selectedTrackId;
		if (scope === 'track' && !trackId) return handleError(new Error(locale === 'de' ? 'Wähle zuerst eine Spur.' : 'Select a track first.'));
		const type = request.type;
		if (!audioEffectTypes().includes(type)) throw new Error(locale === 'de' ? 'Dieser Effekt wird nicht unterstützt.' : 'This effect is not supported.');
		const effectOptions = { ...(request.options || {}) };
		if (type === 'audacity-auto-duck') {
			const candidates = project.tracks.filter((track) => scope === 'master' || track.id !== trackId);
			const requestedControlTrackId = effectOptions.context?.controlTrackId || state.audacityControlTrackId;
			const controlTrackId = candidates.some((track) => track.id === requestedControlTrackId)
				? requestedControlTrackId
				: candidates[0]?.id;
			if (!controlTrackId) {
				return handleError(new Error(locale === 'de'
					? 'Auto-Duck benötigt eine andere Steuerspur.'
					: 'Auto Duck requires another control track.'));
			}
			effectOptions.context = { ...effectOptions.context, controlTrackId };
		}
		if (type === 'audacity-noise-reduction') {
			effectOptions.context = {
				...effectOptions.context,
				noiseProfile: effectOptions.context?.noiseProfile || serializeAudacityNoiseProfile(state.audacityNoiseProfile),
			};
			if (!effectOptions.context.noiseProfile) effectOptions.enabled = false;
		}
		const effect = createEffect(type, effectOptions);
		commit({ type: 'effect/add', scope, trackId, effect });
		if (type === 'audacity-noise-reduction' && !effectOptions.context.noiseProfile) {
			setStatus(locale === 'de'
				? 'Rauschverminderung wurde deaktiviert hinzugefügt. Erfasse im Effekt ein Rauschprofil.'
				: 'Noise Reduction was added disabled. Capture a noise profile in the effect to enable it.');
		}
		return effect.id;
	}

	function currentAudacityEffectParams(type = state.audacityEffectType) {
		if (!state.audacityEffectParams[type]) state.audacityEffectParams[type] = audacityEffectDefaults(type);
		return state.audacityEffectParams[type];
	}

	function setAudacityEffectParams(changes, { markTouched = true } = {}) {
		state.audacityEffectParams[state.audacityEffectType] = normalizeAudacityEffectParams(state.audacityEffectType, {
			...currentAudacityEffectParams(),
			...changes,
		});
		if (markTouched) {
			if (!state.audacityEffectTouchedParams.has(state.audacityEffectType)) {
				state.audacityEffectTouchedParams.set(state.audacityEffectType, new Set());
			}
			const touched = state.audacityEffectTouchedParams.get(state.audacityEffectType);
			for (const name of Object.keys(changes)) touched.add(name);
		}
	}

	function setAudacityEffectType(type) {
		if (!AUDACITY_EFFECT_DEFINITIONS[type]) throw new Error(locale === 'de' ? 'Dieser Auswahleffekt wird nicht unterstützt.' : 'This selection effect is not supported.');
		state.audacityEffectType = type;
		publishDocumentSnapshot();
		return currentAudacityEffectParams(type);
	}

	function setAudacityEffectParamsFromController(changes, options) {
		setAudacityEffectParams(changes, options);
		publishDocumentSnapshot();
		return currentAudacityEffectParams();
	}

	function setAudacityControlTrack(trackId) {
		if (trackId != null && !findTrack(project, trackId)) throw new Error(locale === 'de' ? 'Die Steuerspur wurde nicht gefunden.' : 'The control track was not found.');
		state.audacityControlTrackId = trackId || null;
		publishDocumentSnapshot();
		return state.audacityControlTrackId;
	}

	async function applyAudacityEffectFromController(request = {}) {
		if (request.type) setAudacityEffectType(request.type);
		if (request.params) setAudacityEffectParamsFromController(request.params);
		if ('controlTrackId' in request) setAudacityControlTrack(request.controlTrackId);
		return applySelectedAudacityEffect();
	}

	function captureRackNoiseProfileFromController(scope, trackId, effectId) {
		const normalizedScope = scope === 'master' ? 'master' : 'track';
		const rack = normalizedScope === 'master' ? project?.master?.effects : findTrack(project, trackId)?.effects;
		const effect = rack?.find((candidate) => candidate.id === effectId);
		if (!effect) throw new Error(locale === 'de' ? 'Der Rack-Effekt wurde nicht gefunden.' : 'The rack effect could not be found.');
		return captureRackNoiseProfile(effect, normalizedScope, trackId || null);
	}

	function resolveInteractiveAudacityParams(type, params, channels) {
		if (type !== 'audacity-amplify' || state.audacityEffectTouchedParams.get(type)?.has('gainDb')) return params;
		let peak = 0;
		for (const channel of channels) {
			for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
		}
		const gainDb = peak > 0
			? Math.max(-50, Math.min(50, 20 * Math.log10(1 / peak)))
			: 0;
		const resolved = normalizeAudacityEffectParams(type, { ...params, gainDb });
		state.audacityEffectParams[type] = resolved;
		return resolved;
	}

	function audacityEffectTarget(requestedTrackId = state.selectedTrackId) {
		const selectedClip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const selectedClipTrack = selectedClip ? findClipTrack(project, selectedClip.id) : null;
		const track = findTrack(project, requestedTrackId) || selectedClipTrack;
		if (!track) return null;
		const selection = activeSelection();
		const trackClip = selectedClipTrack?.id === track.id ? selectedClip : null;
		const startFrame = selection?.startFrame ?? trackClip?.timelineStartFrame;
		const endFrame = selection?.endFrame ?? (trackClip ? trackClip.timelineStartFrame + trackClip.durationFrames : null);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame) return null;
		const channelCount = audacitySelectionChannelCount(project, track.id, startFrame, endFrame);
		return channelCount ? { track, startFrame, endFrame, durationFrames: endFrame - startFrame, channelCount } : null;
	}

	async function captureSelectedNoiseProfile() {
		if (editingBlocked()) return;
		const target = audacityEffectTarget();
		if (!target) throw new Error(copy.audacitySelectionHint);
		const estimatedPeakBytes = estimateAudacityEffectPeakBytes(
			'audacity-noise-reduction',
			target.durationFrames,
			currentAudacityEffectParams('audacity-noise-reduction'),
			{ channelCount: target.channelCount, sampleRate: AUDIO_EDITOR_SAMPLE_RATE },
		);
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(locale);
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityProfileProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount);
			const result = await runAudacityEffectWorker({
				operation: 'capture-noise-profile',
				channels,
				sampleRate: AUDIO_EDITOR_SAMPLE_RATE,
				params: currentAudacityEffectParams('audacity-noise-reduction'),
			});
			state.audacityNoiseProfile = result.profile;
			setStatus(copy.noiseProfileReady, 'success');
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function captureRackNoiseProfile(effect, scope, requestedTrackId = state.selectedTrackId) {
		if (editingBlocked()) return;
		const selectionTarget = audacityEffectTarget(requestedTrackId);
		const selection = activeSelection();
		const selectedClip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const startFrame = selection?.startFrame ?? selectedClip?.timelineStartFrame;
		const endFrame = selection?.endFrame ?? (selectedClip
			? selectedClip.timelineStartFrame + selectedClip.durationFrames
			: null);
		if (!Number.isSafeInteger(startFrame) || !Number.isSafeInteger(endFrame) || endFrame <= startFrame) {
			throw new Error(copy.audacitySelectionHint);
		}
		const durationFrames = endFrame - startFrame;
		if (durationFrames < 2_048) {
			throw new Error(locale === 'de'
				? 'Ein Rauschprofil benötigt mindestens 2048 Samples.'
				: 'A noise profile requires at least 2048 samples.');
		}
		const trackId = requestedTrackId;
		if (scope === 'track' && (!selectionTarget || selectionTarget.track.id !== trackId)) {
			throw new Error(copy.audacitySelectionHint);
		}
		const estimatedPeakBytes = estimateAudacityEffectPeakBytes(
			'audacity-noise-reduction',
			durationFrames,
			effect.params,
			{
				channelCount: scope === 'track' ? selectionTarget.channelCount : 2,
				sampleRate: AUDIO_EDITOR_SAMPLE_RATE,
			},
		);
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(locale);
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityProfileProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderRackPrefixRange(
				effect,
				scope,
				startFrame,
				endFrame,
				scope === 'track' ? selectionTarget.channelCount : 2,
				trackId,
			);
			const result = await runAudacityEffectWorker({
				operation: 'capture-noise-profile',
				channels,
				sampleRate: AUDIO_EDITOR_SAMPLE_RATE,
				params: effect.params,
			});
			state.audacityNoiseProfile = result.profile;
			commit({
				type: 'effect/update',
				scope,
				trackId,
				effectId: effect.id,
				changes: {
					enabled: effect.context?.noiseProfile ? effect.enabled : true,
					context: { noiseProfile: serializeAudacityNoiseProfile(result.profile) },
				},
			});
			setStatus(copy.noiseProfileReady, 'success');
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function renderRackPrefixRange(effect, scope, startFrame, endFrame, channelCount, requestedTrackId = state.selectedTrackId) {
		const snapshot = cloneProject(project);
		let trackId = requestedTrackId;
		if (scope === 'track') {
			const track = findTrack(snapshot, trackId);
			if (!track) throw new Error(locale === 'de' ? 'Die Audiospur wurde nicht gefunden.' : 'The audio track could not be found.');
			const effectIndex = track.effects.findIndex((candidate) => candidate.id === effect.id);
			if (effectIndex < 0) throw new Error('The rack effect could not be found.');
			track.effects = track.effects.slice(0, effectIndex);
			track.gain = 1;
			track.pan = 0;
			track.mute = false;
			track.solo = false;
		} else {
			const effectIndex = snapshot.master.effects.findIndex((candidate) => candidate.id === effect.id);
			if (effectIndex < 0) throw new Error('The rack effect could not be found.');
			snapshot.master.effects = snapshot.master.effects.slice(0, effectIndex);
			snapshot.master.gain = 1;
		}

		const prefixEngine = createAudioEditorEngine();
		prefixEngine.loadProject(snapshot, sourceBuffers);
		try {
			const rendered = scope === 'track'
				? await prefixEngine.renderTrack(trackId, {
					startFrame,
					endFrame,
					includeTrackPan: false,
				})
				: await prefixEngine.renderMix({
					startFrame,
					endFrame,
					includeMaster: true,
					respectMuteSolo: true,
				});
			return matchAudacitySelectionChannels(audioBufferChannels(rendered), channelCount);
		} finally {
			await prefixEngine.dispose();
		}
	}

	async function applySelectedAudacityEffect() {
		if (editingBlocked()) return;
		const target = audacityEffectTarget();
		if (!target) throw new Error(copy.audacitySelectionHint);
		const type = state.audacityEffectType;
		const definition = AUDACITY_EFFECT_DEFINITIONS[type];
		let params = normalizeAudacityEffectParams(type, currentAudacityEffectParams());
		if (definition.requiresNoiseProfile && !state.audacityNoiseProfile) throw new Error(copy.noiseProfileMissing);
		if (definition.requiresControlTrack && !state.audacityControlTrackId) throw new Error(locale === 'de' ? 'Auto-Duck benötigt eine Steuerspur.' : 'Auto Duck requires a control track.');
		const estimatedFrames = estimateAudacityEffectOutputFrames(type, target.durationFrames, params);
		const estimatedOutputBytes = estimatedFrames * target.channelCount * Float32Array.BYTES_PER_ELEMENT;
		const estimatedPeakBytes = estimateAudacityEffectPeakBytes(type, target.durationFrames, params, {
			channelCount: target.channelCount,
			controlChannelCount: definition.requiresControlTrack ? 2 : undefined,
			sampleRate: AUDIO_EDITOR_SAMPLE_RATE,
			beforeFrames: definition.requiresContext ? 128 : 0,
			afterFrames: definition.requiresContext ? 128 : 0,
		});
		if (estimatedPeakBytes > AUDACITY_EFFECT_PEAK_MEMORY_LIMIT_BYTES) throw audacityEffectMemoryError(locale);
		await preflightStorage(estimatedOutputBytes, 'effect');
		state.audacityEffectProcessing = true;
		setStatus(copy.audacityProcessing);
		publishDocumentSnapshot();
		try {
			const channels = await renderDryTrackRange(target.track.id, target.startFrame, target.endFrame, target.channelCount);
			params = resolveInteractiveAudacityParams(type, params, channels);
			const effectContext = {};
			if (definition.requiresControlTrack) {
				effectContext.controlChannels = await renderDryTrackRange(state.audacityControlTrackId, target.startFrame, target.endFrame);
			}
			if (definition.requiresNoiseProfile) effectContext.noiseProfile = state.audacityNoiseProfile;
			if (definition.requiresContext) {
				const beforeStart = Math.max(0, target.startFrame - 128);
				const afterEnd = Math.min(projectDurationFrames(project), target.endFrame + 128);
				effectContext.beforeChannels = beforeStart < target.startFrame
					? await renderDryTrackRange(target.track.id, beforeStart, target.startFrame, target.channelCount)
					: channels.map(() => new Float32Array(0));
				effectContext.afterChannels = target.endFrame < afterEnd
					? await renderDryTrackRange(target.track.id, target.endFrame, afterEnd, target.channelCount)
					: channels.map(() => new Float32Array(0));
			}
			const result = await runAudacityEffectWorker({
				operation: 'apply', effectType: type, channels, sampleRate: AUDIO_EDITOR_SAMPLE_RATE, params, context: effectContext,
			});
			await persistAudacityEffectResult(target, type, result.channels);
			setStatus(copy.audacityApplied, 'success');
		} finally {
			state.audacityEffectProcessing = false;
			publishDocumentSnapshot();
		}
	}

	async function renderDryTrackRange(trackId, startFrame, endFrame, requestedChannelCount = null) {
		const track = findTrack(project, trackId);
		if (!track) throw new Error(locale === 'de' ? 'Die Audiospur wurde nicht gefunden.' : 'The audio track could not be found.');
		const channelCount = requestedChannelCount ?? (audacitySelectionChannelCount(project, trackId, startFrame, endFrame) || 1);
		const snapshot = cloneProject(project);
		snapshot.tracks = snapshot.tracks
			.filter((candidate) => candidate.id === trackId)
			.map((candidate) => ({ ...candidate, gain: 1, pan: 0, mute: false, solo: false, effects: [] }));
		snapshot.master = { gain: 1, effects: [] };
		const rendered = await renderSnapshot(snapshot, {
			startFrame,
			endFrame,
			trackId,
			includeMaster: false,
			includeTrackPan: false,
			respectMuteSolo: false,
			outputFrames: endFrame - startFrame,
		});
		return matchAudacitySelectionChannels(audioBufferChannels(rendered), channelCount);
	}

	async function persistAudacityEffectResult(target, type, channels) {
		if (!Array.isArray(channels) || !channels.length || channels.length > 2 || !channels[0]?.length) {
			throw new Error(locale === 'de' ? 'Der Effekt hat kein gültiges Audiosignal erzeugt.' : 'The effect did not produce valid audio.');
		}
		const frameCount = channels[0].length;
		if (!channels.every((channel) => channel instanceof Float32Array && channel.length === frameCount)) {
			throw new Error(locale === 'de' ? 'Die Effektkanäle haben unterschiedliche Längen.' : 'The effect channels have mismatched lengths.');
		}
		assertAudacityEffectOutput(channels);
		if (channels.length !== target.channelCount) {
			throw new Error(locale === 'de' ? 'Der Effekt hat die Kanalbelegung der Auswahl verändert.' : 'The effect changed the selection channel layout.');
		}
		const context = await engine.getAudioContext({ resume: false });
		const buffer = await bufferFromChannels(channels, AUDIO_EDITOR_SAMPLE_RATE, context);
		const sourceId = createStableId('audacity-effect');
		const effectName = audacityEffectLabel(type, locale);
		const sourceName = `${target.track.name} — ${effectName}.wav`;
		const writer = await store.beginSourceWrite(sourceId, { name: sourceName, mimeType: 'audio/wav' });
		try {
			await writeBuffer(writer, buffer);
			await writer.commit({ sampleRate: AUDIO_EDITOR_SAMPLE_RATE, channelCount: buffer.numberOfChannels });
		} catch (error) {
			await writer.abort();
			throw error;
		}

		const replacement = prepareRangeReplacementCommand(project, {
			trackId: target.track.id,
			startFrame: target.startFrame,
			endFrame: target.endFrame,
			source: {
				id: sourceId,
				storageKey: sourceId,
				name: sourceName,
				mimeType: 'audio/wav',
				frameCount,
				channelCount: buffer.numberOfChannels,
				originalSampleRate: AUDIO_EDITOR_SAMPLE_RATE,
			},
		});
		sourceBuffers.set(sourceId, buffer);
		try {
			const peaks = await generateWaveformPeaks(channels);
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			commit({
				type: 'batch',
				commands: [replacement, { type: 'selection/set', startFrame: target.startFrame, endFrame: target.startFrame + frameCount }],
			}, { selectTrackId: target.track.id, selectClipId: replacement.clipId });
		} catch (error) {
			sourceBuffers.delete(sourceId);
			sourcePeaks.delete(sourceId);
			await store.deleteSource(sourceId);
			throw error;
		}
	}

	async function runAudacityEffectWorker(payload) {
		if (typeof Worker !== 'function') {
			if (payload.operation === 'capture-noise-profile') {
				return { profile: captureAudacityNoiseProfile(payload.channels, payload.sampleRate, payload.params) };
			}
			return { channels: applyAudacityEffect(payload.effectType, payload.channels, payload.sampleRate, payload.params, payload.context) };
		}
		const worker = new Worker(new URL('./audacity-effects/worker.js', import.meta.url), { type: 'module' });
		state.audacityEffectWorker = worker;
		const transfer = [];
		const message = cloneAudacityWorkerPayload(payload, transfer);
		try {
			return await new Promise((resolve, reject) => {
				worker.onmessage = ({ data }) => {
					if (data.type === 'error') reject(new Error(data.message || 'Audacity effect processing failed.'));
					else resolve(data);
				};
				worker.onerror = (event) => reject(event.error || new Error(event.message || 'Audacity effect processing failed.'));
				worker.postMessage(message, transfer);
			});
		} finally {
			worker.terminate();
			if (state.audacityEffectWorker === worker) state.audacityEffectWorker = null;
		}
	}

	async function runAnalysis(scope) {
		if (!project.clips.length) return;
		if (state.missingSourceIds.size) throw new Error(locale === 'de' ? 'Lokale Audioquellen fehlen.' : 'Local audio sources are missing.');
		setStatus(locale === 'de' ? 'Audiosignal wird für die Analyse gerendert…' : 'Rendering audio for analysis…');
		const selection = activeSelection();
		const startFrame = selection?.startFrame ?? 0;
		const endFrame = selection?.endFrame ?? projectDurationFrames(project);
		const analysisKey = ['audio-editor-analysis-v1', project.id, project.revision, scope, scope === 'track' ? state.selectedTrackId : 'master', startFrame, endFrame].join(':');
		const cached = await store.loadAnalysis(analysisKey);
		if (cached?.result) {
			showAnalysis(cached.result, cached.visuals || null);
			setStatus(locale === 'de' ? 'Gespeicherte Analyse geladen.' : 'Loaded cached analysis.', 'success');
			return;
		}
		let snapshot = cloneProject(project);
		if (scope === 'track') {
			if (!state.selectedTrackId) throw new Error(locale === 'de' ? 'Wähle zuerst eine Spur.' : 'Select a track first.');
			snapshot = cloneProject(project);
			for (const track of snapshot.tracks) { track.mute = track.id !== state.selectedTrackId; track.solo = false; }
			snapshot.master = { gain: 1, effects: [] };
		}
		try {
			const rendered = await renderSnapshot(snapshot, { startFrame, endFrame, includeTail: false, preRollFrames: Math.min(startFrame, AUDIO_EDITOR_SAMPLE_RATE * 10) });
			const channels = audioBufferChannels(rendered);
			const result = await analyzeChannelsInWorker(channels, rendered.sampleRate);
			const visuals = createAnalysisVisuals(channels, rendered.sampleRate);
			await store.saveAnalysis(analysisKey, { result, visuals, createdAt: new Date().toISOString() });
			showAnalysis(result, visuals);
			setStatus(copy.done, 'success');
		} catch (error) { handleError(error); }
	}

	async function handleExportAction(action, requestedSettings = null) {
		if (action === 'cancel') {
			state.exportGeneration += 1;
			state.exportAbort?.abort();
			state.exportAbort = null;
			ffmpeg.dispose();
			toggleExport(false);
			publishDocumentSnapshot();
			return;
		}
		if (!project.clips.length || state.exportAbort) return;
		if (state.missingSourceIds.size) throw new Error(locale === 'de' ? 'Lokale Audioquellen fehlen.' : 'Local audio sources are missing.');
		const generation = ++state.exportGeneration;
		const abort = new AbortController();
		state.exportAbort = abort;
		toggleExport(true);
		const exportProject = cloneProject(project);
		const exportSources = new Map(sourceBuffers);
		let pendingCleanup = null;
		try {
			const settings = normalizeExportSettings(requestedSettings || {});
			const plan = createExportPlan(exportProject, { ...settings, mobile: state.mobile, livePcmBytes: undefined });
			await preflightStorage(plan.outputBytesPerRender * Math.max(1, plan.outputs.length), 'export');
			setStatus(copy.rendering);
			let blob;
			let fileName;
			let outputCleanup = null;
			if (plan.mode === 'mix') {
				const encoded = await renderAndEncode(exportProject, plan, settings, abort.signal, exportSources);
				blob = encoded.blob || new Blob([encoded.bytes], { type: encoded.mimeType });
				outputCleanup = encoded.cleanup || null;
				pendingCleanup = outputCleanup;
				fileName = plan.outputs[0].fileName;
			} else {
				const archive = await createStreamingZipArchive(plan.archiveName, plan.outputBytesPerRender * plan.outputs.length);
				try {
					for (let index = 0; index < plan.outputs.length; index += 1) {
						throwIfAborted(abort.signal);
						const output = plan.outputs[index];
						const snapshot = stemProject(exportProject, output.trackId);
						const encoded = await renderAndEncode(snapshot, plan, settings, abort.signal, exportSources);
						try {
							await archive.add(output.fileName, encoded.blob || encoded.bytes, abort.signal);
						} finally {
							await encoded.cleanup?.();
						}
						updateExportProgress((index + 1) / plan.outputs.length);
					}
					const result = await archive.finish();
					blob = result.blob;
					outputCleanup = result.cleanup;
					pendingCleanup = outputCleanup;
					fileName = plan.archiveName;
				} catch (error) {
					await archive.abort();
					throw error;
				}
			}
			throwIfAborted(abort.signal);
			if (generation !== state.exportGeneration) throw abortError();
			if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
			await state.outputCleanup?.();
			state.outputCleanup = outputCleanup;
			pendingCleanup = null;
			state.outputUrl = URL.createObjectURL(blob);
			state.exportOutput = Object.freeze({
				url: state.outputUrl,
				fileName,
				mimeType: blob.type || 'application/octet-stream',
				size: blob.size,
			});
			setStatus(copy.done, 'success');
			publishDocumentSnapshot();
			return state.exportOutput;
		} catch (error) {
			await pendingCleanup?.().catch(() => undefined);
			if (error?.name !== 'AbortError') handleError(error);
		} finally {
			if (generation === state.exportGeneration) {
				state.exportAbort = null;
				toggleExport(false);
			}
		}
	}

	async function renderAndEncode(snapshot, plan, settings, signal, sourceMap = sourceBuffers) {
		throwIfAborted(signal);
		if (plan.render.strategy === 'realtime-stream') {
			setStatus(locale === 'de' ? 'Großes Projekt: Export läuft speicherschonend in Echtzeit…' : 'Large project: rendering in realtime to conserve memory…');
			return renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap);
		}
		try {
			const rendered = await renderSnapshot(snapshot, {
				startFrame: plan.range.startFrame,
				endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / AUDIO_EDITOR_SAMPLE_RATE : false,
				outputFrames: plan.range.durationFrames + plan.tailFrames,
				preRollFrames: Math.min(plan.range.startFrame, AUDIO_EDITOR_SAMPLE_RATE * 10),
			}, sourceMap, signal);
			throwIfAborted(signal);
			return await encodeRendered(rendered, plan, settings, signal);
		} catch (error) {
			if (error?.name === 'AbortError') throw error;
			setStatus(locale === 'de' ? 'Schneller Export nicht verfügbar; Echtzeit-Render wird verwendet…' : 'Fast render unavailable; switching to realtime rendering…');
			return renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap);
		}
	}

	async function renderSnapshot(snapshot, range, sourceMap = sourceBuffers, signal = null) {
		throwIfAborted(signal);
		const renderEngine = createAudioEditorEngine();
		try {
			renderEngine.loadProject(snapshot, sourceMap);
			const rendered = await renderEngine.renderMix(range);
			throwIfAborted(signal);
			return rendered;
		} finally { await renderEngine.dispose(); }
	}

	async function encodeRendered(rendered, plan, settings, signal) {
		throwIfAborted(signal);
		let output = rendered;
		if (plan.sampleRate !== rendered.sampleRate) output = await resampleBuffer(rendered, plan.sampleRate);
		throwIfAborted(signal);
		const bitDepth = settings.bitDepth === 32 ? 32 : settings.bitDepth;
		const stagingBitDepth = plan.format === 'wav' ? bitDepth : plan.format === 'flac' ? bitDepth : 24;
		const wav = encodeWav(output, { sampleRate: plan.sampleRate, bitDepth: stagingBitDepth, float: plan.format === 'wav' && bitDepth === 32, dither: plan.dither });
		throwIfAborted(signal);
		if (plan.format === 'wav') return { bytes: wav, mimeType: 'audio/wav' };
		setStatus(copy.encoding);
		return ffmpeg.encode(wav, plan.format, { ...plan.encoding, bitDepth, sampleRate: plan.sampleRate, signal });
	}

	async function renderRealtimeEncoded(snapshot, plan, settings, signal, sourceMap = sourceBuffers) {
		const sink = await createTemporaryFileSink(`audio-editor-${createStableId('render')}.wav`);
		if (!sink.persistent && plan.outputBytesPerRender > 96 * 1024 ** 2) {
			await sink.abort();
			throw new Error(locale === 'de'
				? 'Große Echtzeit-Exporte benötigen in diesem Browser origin-privaten Dateispeicher.'
				: 'Large realtime exports require origin-private file storage in this browser.');
		}
		const bitDepth = plan.format === 'wav' || plan.format === 'flac' ? settings.bitDepth : 24;
		const encoder = createWavStreamEncoder({
			sampleRate: plan.sampleRate,
			channelCount: 2,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: plan.format === 'wav' && bitDepth === 32,
			dither: plan.dither,
			collect: false,
			onChunk: (chunk) => sink.write(chunk),
		});
		const renderEngine = createAudioEditorEngine();
		let outputResampler = null;
		let renderedSampleRate = AUDIO_EDITOR_SAMPLE_RATE;
		try {
			renderEngine.loadProject(snapshot, sourceMap);
			const renderResult = await renderEngine.renderMixRealtime({
				startFrame: plan.range.startFrame,
				endFrame: plan.range.endFrame,
				includeTail: settings.includeTail ? plan.tailFrames / AUDIO_EDITOR_SAMPLE_RATE : false,
				sampleRate: AUDIO_EDITOR_SAMPLE_RATE,
				preRollFrames: Math.min(plan.range.startFrame, AUDIO_EDITOR_SAMPLE_RATE * 10),
				signal,
				onChunk: (channels, metadata = {}) => {
					renderedSampleRate = metadata.sampleRate || renderedSampleRate;
					outputResampler ||= createStreamingLinearResampler(renderedSampleRate, plan.sampleRate, 2);
					const outputChannels = outputResampler.push(channels);
					if (outputChannels[0]?.length) encoder.write(outputChannels);
				},
			});
			outputResampler ||= createStreamingLinearResampler(renderResult.sampleRate || renderedSampleRate, plan.sampleRate, 2);
			const finalChannels = outputResampler.finish(plan.outputFrames);
			if (finalChannels[0]?.length) encoder.write(finalChannels);
			encoder.finalize();
			await encoder.settled();
			const wavFile = await sink.close('audio/wav');
			if (plan.format === 'wav') {
				return { blob: wavFile, bytes: null, mimeType: 'audio/wav', cleanup: () => sink.remove() };
			}
			setStatus(copy.encoding);
			const encoded = await ffmpeg.encodeFile(wavFile, plan.format, { ...plan.encoding, bitDepth, sampleRate: plan.sampleRate, signal });
			await sink.remove();
			return encoded;
		} catch (error) {
			await sink.abort();
			throw error;
		} finally {
			await renderEngine.dispose();
		}
	}

	async function startRecording(options = {}) {
		if (state.readOnly || state.recordingStarting || state.recorder) return;
		const track = options.trackId
			? findTrack(project, options.trackId)
			: project.tracks.find((item) => item.armed);
		if (!track) throw new Error(locale === 'de' ? 'Aktiviere zuerst eine Spur für die Aufnahme.' : 'Select or arm a track before recording.');
		state.recordingStarting = true;
		publishDocumentSnapshot();
		let stream = null;
		let writer = null;
		let recorder = null;
		try {
			await preflightStorage(AUDIO_EDITOR_SAMPLE_RATE * 2 * Float32Array.BYTES_PER_ELEMENT * 60, 'recording');
			const context = await engine.getAudioContext();
			await context.resume();
			stream = await requestMicrophone({ audio: { channelCount: { ideal: 2, max: 2 }, sampleRate: { ideal: AUDIO_EDITOR_SAMPLE_RATE }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
			const sourceId = createStableId('recording');
			writer = await store.beginSourceWrite(sourceId, { name: `${locale === 'de' ? 'Aufnahme' : 'Recording'} ${new Date().toLocaleTimeString(locale)}`, mimeType: 'audio/wav' });
			const inputTrack = stream.getAudioTracks()[0];
			const trackSettings = inputTrack?.getSettings?.() || {};
			const channelCount = Math.min(2, trackSettings.channelCount || 1);
			const inputSampleRate = context.sampleRate || AUDIO_EDITOR_SAMPLE_RATE;
			const resampler = createStreamingLinearResampler(inputSampleRate, AUDIO_EDITOR_SAMPLE_RATE, channelCount);
			const selection = activeSelection();
			const requestedStartFrame = selection?.startFrame ?? engine.getPositionFrames();
			const automaticLatency = (context.baseLatency || 0) + (context.outputLatency || 0) + (Number(trackSettings.latency) || 0);
			const manualLatency = state.latencyOffsetMs / 1000;
			const latencyFrames = Math.max(0, Math.round((automaticLatency + manualLatency) * AUDIO_EDITOR_SAMPLE_RATE));
			state.recordingStartFrame = selection ? requestedStartFrame : Math.max(0, requestedStartFrame - latencyFrames);
			state.recordingSourceOffsetFrames = selection ? latencyFrames : Math.max(0, latencyFrames - requestedStartFrame);
			recorder = await createRecordingController({
				context,
				stream,
				channelCount,
				monitor: state.monitoring,
				onChunk: async ({ channels }) => {
					const canonicalChannels = resampler.push(channels);
					if (canonicalChannels[0]?.length) await writer.write(canonicalChannels);
					let peak = 0;
					for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
					const db = peak > 0 ? 20 * Math.log10(peak) : -60;
					state.inputMeterDb = Math.max(-60, db);
					publishTelemetrySnapshot();
				},
				onError: handleError,
				onState: (recordingState) => {
					if (recordingState === 'stopped' && state.recorder && !state.recordingFinishing) void finalizeRecording();
				},
			});
			state.recordingWriter = writer;
			state.recordingStream = stream;
			state.recordingSourceId = sourceId;
			state.recordingTrackId = track.id;
			state.recordingSelection = selection ? { ...selection } : null;
			state.recordingResampler = resampler;
			state.recorder = recorder;
			const scheduledTime = context.currentTime + 0.08;
			const currentContextFrame = Math.ceil(scheduledTime * context.sampleRate);
			const selectionProjectFrames = selection ? selection.endFrame - selection.startFrame + state.recordingSourceOffsetFrames : 0;
			const stopFrame = selection
				? currentContextFrame + Math.ceil(selectionProjectFrames * context.sampleRate / AUDIO_EDITOR_SAMPLE_RATE)
				: undefined;
			const interrupt = () => { if (state.recorder && !state.recordingFinishing) void stopRecording().catch(handleError); };
			inputTrack?.addEventListener?.('ended', interrupt, { once: true });
			const contextStateChange = () => { if (context.state === 'suspended' && state.recorder) interrupt(); };
			context.addEventListener?.('statechange', contextStateChange);
			state.recordingCleanup = () => {
				inputTrack?.removeEventListener?.('ended', interrupt);
				context.removeEventListener?.('statechange', contextStateChange);
			};
			engine.setLoop(false);
			engine.seek(requestedStartFrame);
			await engine.playAt(scheduledTime, requestedStartFrame);
			recorder.start({ startFrame: currentContextFrame, stopFrame });
			setStatus(copy.recording);
			updateTransportState('recording');
		} catch (error) {
			state.recordingCleanup?.();
			state.recordingCleanup = null;
			await recorder?.dispose?.().catch(() => undefined);
			await writer?.abort?.().catch(() => undefined);
			for (const mediaTrack of stream?.getTracks?.() || []) mediaTrack.stop();
			state.recorder = null;
			state.recordingWriter = null;
			state.recordingStream = null;
			state.recordingResampler = null;
			throw error;
		} finally {
			state.recordingStarting = false;
			publishDocumentSnapshot();
		}
	}

	async function stopRecording() {
		if (!state.recorder) return;
		await state.recorder.stop();
		if (!state.recordingFinishing) await finalizeRecording();
	}

	async function finalizeRecording() {
		if (!state.recorder || state.recordingFinishing) return;
		state.recordingFinishing = true;
		const recorder = state.recorder;
		const writer = state.recordingWriter;
		let sourceCommitted = false;
		try {
			engine.pause();
			await recorder.dispose();
			const finalChannels = state.recordingResampler?.finish?.();
			if (finalChannels?.[0]?.length) await writer.write(finalChannels);
			const frames = writer.framesWritten;
			if (frames <= 0) { await writer.abort(); return; }
			const metadata = await writer.commit({ sampleRate: AUDIO_EDITOR_SAMPLE_RATE });
			sourceCommitted = true;
			const sourceId = state.recordingSourceId;
			const sourceCommand = createAddSourceCommand({ id: sourceId, storageKey: sourceId, name: metadata.name, mimeType: 'audio/wav', frameCount: frames, channelCount: metadata.channelCount || 1 });
			const buffer = await readStoredAudioBuffer(store, { id: sourceId, frameCount: frames, channelCount: metadata.channelCount || 1 }, await engine.getAudioContext());
			sourceBuffers.set(sourceId, buffer);
			const peaks = await generateWaveformPeaks(audioBufferChannels(buffer));
			sourcePeaks.set(sourceId, peaks);
			await store.saveAnalysis(peakCacheKey(sourceId), peaks);
			const selection = state.recordingSelection;
			const clipId = createStableId('clip');
			const sourceStartFrame = Math.min(state.recordingSourceOffsetFrames, Math.max(0, frames - 1));
			const availableFrames = frames - sourceStartFrame;
			const durationFrames = selection ? Math.min(availableFrames, selection.endFrame - selection.startFrame) : availableFrames;
			const clipCommand = preparePunchCommand(project, {
				trackId: state.recordingTrackId,
				startFrame: state.recordingStartFrame,
				endFrame: state.recordingStartFrame + durationFrames,
				sourceId,
				sourceStartFrame,
				clipId,
			});
			commit({ type: 'batch', commands: [sourceCommand, clipCommand] }, { selectTrackId: state.recordingTrackId, selectClipId: clipId });
			setStatus(copy.done, 'success');
		} catch (error) {
			await writer?.abort?.().catch(() => undefined);
			if (sourceCommitted && state.recordingSourceId) {
				sourceBuffers.delete(state.recordingSourceId);
				sourcePeaks.delete(state.recordingSourceId);
				await store.deleteSource(state.recordingSourceId).catch(() => undefined);
			}
			handleError(error);
		} finally {
			state.recordingCleanup?.();
			state.recordingCleanup = null;
			state.recorder = null;
			state.recordingWriter = null;
			state.recordingStream = null;
			state.recordingSourceId = null;
			state.recordingTrackId = null;
			state.recordingSelection = null;
			state.recordingResampler = null;
			state.recordingSourceOffsetFrames = 0;
			state.recordingFinishing = false;
			state.inputMeterDb = -60;
			publishTelemetrySnapshot();
			updateTransportState(engine.getState().state);
			publishDocumentSnapshot();
		}
	}

	function editingBlocked() {
		return Boolean(state.readOnly || state.importing || state.recordingStarting || state.recorder || state.exportAbort || state.audacityEffectProcessing);
	}

	function updatePlayhead(frame = 0, duration = project ? projectDurationFrames(project) : 0) {
		state.positionFrame = Math.max(0, Math.round(Number(frame) || 0));
		state.durationFrames = Math.max(0, Math.round(Number(duration) || 0));
		publishTelemetrySnapshot();
	}

	function updateTransportState(value) {
		state.transportState = value || 'stopped';
		publishTelemetrySnapshot();
	}

	function updateMeters(meters) {
		state.meters = meters || { tracks: {}, master: null };
		publishTelemetrySnapshot();
	}

	function updateZoom(action, requestedViewportWidth) {
		if (action === 'fit') {
			const viewport = Math.max(320, Number(requestedViewportWidth) || 960);
			state.pixelsPerSecond = Math.max(1, viewport / Math.max(MIN_TIMELINE_SECONDS, projectDurationFrames(project) / AUDIO_EDITOR_SAMPLE_RATE));
		} else state.pixelsPerSecond = Math.max(1, Math.min(MAX_PIXELS_PER_SECOND, state.pixelsPerSecond * (action === 'in' ? 2 : 0.5)));
		publishProjectState();
	}

	function normalizeExportSettings(value = {}) {
		const format = ['wav', 'flac', 'mp3', 'opus'].includes(value.format) ? value.format : 'wav';
		const defaultQuality = format === 'mp3' ? 192 : format === 'opus' ? 160 : format === 'flac' ? 5 : undefined;
		return {
			mode: value.mode === 'stems' ? 'stems' : 'mix',
			range: value.range === 'selection' ? 'selection' : 'project',
			format,
			bitDepth: [16, 24, 32].includes(Number(value.bitDepth)) ? Number(value.bitDepth) : 24,
			bitRate: format === 'mp3' || format === 'opus' ? Number(value.bitRate) || defaultQuality : undefined,
			compressionLevel: format === 'flac' ? Number.isFinite(Number(value.compressionLevel)) ? Number(value.compressionLevel) : defaultQuality : undefined,
			sampleRate: [44_100, 48_000].includes(Number(value.sampleRate)) ? Number(value.sampleRate) : AUDIO_EDITOR_SAMPLE_RATE,
			includeTail: value.includeTail !== false,
		};
	}

	function toggleExport(active) {
		if (!active) {
			state.exportProgress = 0;
			publishTelemetrySnapshot();
		}
		publishDocumentSnapshot();
	}

	function updateExportProgress(progress) {
		state.exportProgress = Math.max(0, Math.min(1, Number(progress) || 0));
		publishTelemetrySnapshot();
	}

	function showAnalysis(result, visuals = null) {
		state.analysisResult = result || null;
		state.analysisVisuals = visuals;
		publishDocumentSnapshot();
	}

	function createAnalysisVisuals(channels, sampleRate) {
		const length = channels[0]?.length || 0;
		const spectrumFrames = Math.min(length, 16_384);
		const spectrumStart = Math.max(0, Math.floor((length - spectrumFrames) / 2));
		const spectrum = mixToMono(channels.map((channel) => channel.subarray(spectrumStart, spectrumStart + spectrumFrames)));
		const step = Math.max(1, Math.ceil(length / 131_072));
		const overview = new Float32Array(Math.ceil(length / step));
		for (let index = 0; index < overview.length; index += 1) {
			const frame = Math.min(length - 1, index * step);
			for (const channel of channels) overview[index] += (channel[frame] || 0) / channels.length;
		}
		return Object.freeze({
			spectrum: Object.freeze({ samples: spectrum, sampleRate, startFrame: spectrumStart }),
			overview: Object.freeze({ samples: overview, sampleRate: sampleRate / step, step }),
		});
	}

	function setStatus(message, status = 'info') {
		const resolvedMessage = message || copy.ready;
		state.status = { message: resolvedMessage, state: status };
		publishDocumentSnapshot();
	}

	function handleError(error) {
		const message = error?.message || String(error) || (locale === 'de' ? 'Unbekannter Fehler' : 'Unknown error');
		setStatus((copy.genericError || (locale === 'de' ? 'Fehler: {message}' : 'Error: {message}')).replace('{message}', message), 'error');
		return null;
	}

	function warnEnvelope() {
		const envelope = projectEnvelope(project, { mobile: state.mobile });
		if (!envelope.supported) setStatus(locale === 'de'
			? `Hinweis: Das Projekt überschreitet den getesteten Umfang von ${envelope.limits.trackCount} Spuren / ${envelope.limits.stereoMinutes} Stereo-Minuten.`
			: `Note: This project exceeds the tested envelope of ${envelope.limits.trackCount} tracks / ${envelope.limits.stereoMinutes} stereo minutes.`);
	}

	async function refreshStorageUsage() {
		const estimate = await store.estimateStorage();
		state.storageEstimate = { usage: estimate.usage ?? null, quota: estimate.quota ?? null };
		publishDocumentSnapshot();
	}

	async function preflightStorage(requiredBytes, operation) {
		const estimate = await store.estimateStorage();
		if (!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage)) return;
		const available = Math.max(0, estimate.quota - estimate.usage);
		const required = Math.max(0, Number(requiredBytes) || 0);
		if (available < required * 1.1) {
			const label = operation === 'recording'
				? (locale === 'de' ? 'die Aufnahme' : 'recording')
				: operation === 'export'
					? (locale === 'de' ? 'den Export' : 'export')
					: operation === 'effect'
						? (locale === 'de' ? 'den Effekt' : 'effect processing')
					: (locale === 'de' ? 'den Import' : 'import');
			throw new Error(locale === 'de'
				? `Nicht genügend lokaler Speicher für ${label}. Benötigt werden ungefähr ${formatBytes(required)}.`
				: `Not enough local storage for ${label}. Approximately ${formatBytes(required)} is required.`);
		}
	}

	function activeSelection() {
		const selection = project?.selection;
		return selection && selection.endFrame > selection.startFrame ? selection : null;
	}
}

function cloneAudacityWorkerPayload(payload, transfer) {
	const cloneChannels = (channels) => (channels || []).map((channel) => {
		const copy = Float32Array.from(channel);
		transfer.push(copy.buffer);
		return copy;
	});
	const message = {
		...payload,
		channels: cloneChannels(payload.channels),
		params: structuredClone(payload.params || {}),
	};
	if (payload.context) {
		message.context = { ...payload.context };
		for (const key of ['controlChannels', 'beforeChannels', 'afterChannels']) {
			if (Array.isArray(payload.context[key])) message.context[key] = cloneChannels(payload.context[key]);
		}
	}
	return message;
}

function audacityEffectMemoryError(locale) {
	return new Error(locale === 'de'
		? 'Der geschätzte Spitzenspeicherbedarf des Effekts ist für die sichere Verarbeitung im Browser zu groß.'
		: 'The effect\'s estimated peak memory use is too large to process safely in this browser.');
}

async function writeBuffer(writer, buffer) {
	for (let start = 0; start < buffer.length; start += SOURCE_CHUNK_FRAMES) {
		const end = Math.min(buffer.length, start + SOURCE_CHUNK_FRAMES);
		await writer.write(Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel).slice(start, end)));
	}
}

async function readStoredAudioBuffer(store, source, context) {
	if (!context?.createBuffer) return null;
	return store.loadSourceAudioBuffer(source.id, context);
}

async function canonicalizeBuffer(input, context) {
	if (!input?.numberOfChannels || !input?.length) throw new Error('The decoded audio is empty.');
	let channels;
	if (input.numberOfChannels <= 2) {
		channels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
	} else {
		const left = new Float32Array(input.length);
		const right = new Float32Array(input.length);
		const sourceChannels = Array.from({ length: input.numberOfChannels }, (_, channel) => input.getChannelData(channel));
		const normalization = 1 + Math.max(0, input.numberOfChannels - 2) * 0.5;
		for (let frame = 0; frame < input.length; frame += 1) {
			left[frame] = sourceChannels[0][frame];
			right[frame] = sourceChannels[1]?.[frame] ?? sourceChannels[0][frame];
			for (let channel = 2; channel < sourceChannels.length; channel += 1) {
				if (channel % 2 === 0) left[frame] += sourceChannels[channel][frame] * 0.5;
				else right[frame] += sourceChannels[channel][frame] * 0.5;
			}
			left[frame] /= normalization;
			right[frame] /= normalization;
		}
		channels = [left, right];
	}
	if (input.sampleRate === AUDIO_EDITOR_SAMPLE_RATE && input.numberOfChannels <= 2) return input;
	const downmixed = await bufferFromChannels(channels, input.sampleRate, context);
	return input.sampleRate === AUDIO_EDITOR_SAMPLE_RATE ? downmixed : resampleBuffer(downmixed, AUDIO_EDITOR_SAMPLE_RATE, context);
}

async function bufferFromChannels(channels, sampleRate, context) {
	if (!channels?.length || !channels[0]?.length) throw new Error('The decoded audio is empty.');
	const buffer = await createAudioBuffer(channels.length, channels[0].length, sampleRate, context);
	for (let channel = 0; channel < channels.length; channel += 1) {
		if (channels[channel].length !== channels[0].length) throw new Error('Decoded channel lengths do not match.');
		if (buffer.copyToChannel) buffer.copyToChannel(channels[channel], channel);
		else buffer.getChannelData(channel).set(channels[channel]);
	}
	return buffer;
}

async function bufferFromAup3Channels(channels, sampleRate, context) {
	const outputLength = Math.max(1, Math.round(channels[0].length * AUDIO_EDITOR_SAMPLE_RATE / sampleRate));
	if (outputLength * channels.length * Float32Array.BYTES_PER_ELEMENT > 384 * 1024 * 1024) {
		throw new Error('The Audacity project is too long to resample safely in this browser.');
	}
	if (sampleRate >= 8000 && sampleRate <= 96000) return bufferFromChannels(channels, sampleRate, context);
	const resampled = channels.map((source) => {
		const output = new Float32Array(outputLength);
		for (let frame = 0; frame < outputLength; frame += 1) {
			const position = frame * sampleRate / AUDIO_EDITOR_SAMPLE_RATE;
			const first = Math.min(source.length - 1, Math.floor(position));
			const second = Math.min(source.length - 1, first + 1);
			const fraction = position - first;
			output[frame] = source[first] + (source[second] - source[first]) * fraction;
		}
		return output;
	});
	return bufferFromChannels(resampled, AUDIO_EDITOR_SAMPLE_RATE, context);
}

async function resampleBuffer(input, sampleRate, context) {
	if (input.sampleRate === sampleRate) return input;
	const length = Math.max(1, Math.round(input.length * sampleRate / input.sampleRate));
	const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
	if (OfflineContext) {
		try {
			const offline = new OfflineContext(input.numberOfChannels, length, sampleRate);
			const source = offline.createBufferSource();
			source.buffer = input;
			source.connect(offline.destination);
			source.start();
			return await offline.startRendering();
		} catch {
			// Use deterministic linear interpolation below.
		}
	}
	const channels = Array.from({ length: input.numberOfChannels }, (_, channel) => {
		const source = input.getChannelData(channel);
		const output = new Float32Array(length);
		for (let frame = 0; frame < length; frame += 1) {
			const position = frame * input.sampleRate / sampleRate;
			const first = Math.min(source.length - 1, Math.floor(position));
			const second = Math.min(source.length - 1, first + 1);
			const fraction = position - first;
			output[frame] = source[first] + (source[second] - source[first]) * fraction;
		}
		return output;
	});
	return bufferFromChannels(channels, sampleRate, context);
}

async function createAudioBuffer(channelCount, length, sampleRate, context) {
	if (context?.createBuffer) return context.createBuffer(channelCount, length, sampleRate);
	if (typeof globalThis.AudioBuffer === 'function') return new globalThis.AudioBuffer({ numberOfChannels: channelCount, length, sampleRate });
	const Context = globalThis.AudioContext || globalThis.webkitAudioContext;
	if (!Context) throw new Error('AudioBuffer creation is not supported in this browser.');
	const temporary = new Context({ sampleRate });
	const buffer = temporary.createBuffer(channelCount, length, sampleRate);
	await temporary.close?.();
	return buffer;
}
function audioBufferChannels(buffer) { return Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel)); }
function serializeAudacityNoiseProfile(profile) {
	if (!profile) return null;
	return {
		...profile,
		meanPowers: Array.from(profile.meanPowers || []),
	};
}
async function analyzeChannelsInWorker(channels, sampleRate, chunkFrames = 65_536) {
	if (typeof Worker !== 'function') return analyzeAudioChannels(channels, sampleRate);
	const worker = new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' });
	try {
		worker.postMessage({ type: 'start', options: { sampleRate, channelCount: channels.length, truePeakOversample: 4 } });
		await waitForAnalysisWorker(worker, 'ready');
		const frameCount = channels[0]?.length || 0;
		for (let offset = 0; offset < frameCount; offset += chunkFrames) {
			const chunks = channels.map((channel) => channel.slice(offset, Math.min(frameCount, offset + chunkFrames)));
			worker.postMessage({ type: 'chunk', channels: chunks.map((chunk) => chunk.buffer) }, chunks.map((chunk) => chunk.buffer));
			await waitForAnalysisWorker(worker, 'ack');
		}
		worker.postMessage({ type: 'finish' });
		return (await waitForAnalysisWorker(worker, 'result')).result;
	} finally {
		worker.terminate();
	}
}
async function generateWaveformPeaks(channels, chunkFrames = 65_536) {
	if (typeof Worker !== 'function') return generateWaveformPeaksFallback(channels);
	const worker = new Worker(new URL('./peaks-worker.js', import.meta.url), { type: 'module' });
	try {
		worker.postMessage({ type: 'start', channelCount: channels.length });
		await waitForAnalysisWorker(worker, 'ready');
		const frameCount = channels[0]?.length || 0;
		for (let offset = 0; offset < frameCount; offset += chunkFrames) {
			const chunks = channels.map((channel) => channel.slice(offset, Math.min(frameCount, offset + chunkFrames)));
			worker.postMessage({ type: 'chunk', channels: chunks.map((chunk) => chunk.buffer) }, chunks.map((chunk) => chunk.buffer));
			await waitForAnalysisWorker(worker, 'ack');
		}
		worker.postMessage({ type: 'finish' });
		const message = await waitForAnalysisWorker(worker, 'result');
		return { version: 1, levels: message.levels };
	} finally {
		worker.terminate();
	}
}
function generateWaveformPeaksFallback(channels) {
	const blockSizes = [64, 256, 1_024, 4_096, 16_384, 65_536];
	return {
		version: 1,
		levels: blockSizes.map((blockSize) => {
			const count = Math.ceil((channels[0]?.length || 0) / blockSize);
			const minimums = new Float32Array(count);
			const maximums = new Float32Array(count);
			for (let block = 0; block < count; block += 1) {
				let minimum = 1;
				let maximum = -1;
				for (let frame = block * blockSize; frame < Math.min(channels[0].length, (block + 1) * blockSize); frame += 1) {
					let sample = 0;
					for (const channel of channels) sample += channel[frame] / channels.length;
					minimum = Math.min(minimum, sample);
					maximum = Math.max(maximum, sample);
				}
				minimums[block] = minimum;
				maximums[block] = maximum;
			}
			return { blockSize, minimums, maximums };
		}),
	};
}
function peakCacheKey(sourceId) { return `audio-editor-peaks-v1:${sourceId}`; }
function waitForAnalysisWorker(worker, expectedType) {
	return new Promise((resolve, reject) => {
		worker.onmessage = ({ data = {} }) => {
			if (data.type === 'error') reject(new Error(data.message || 'Audio analysis failed.'));
			else if (data.type === expectedType) resolve(data);
		};
		worker.onerror = (event) => reject(event.error || new Error(event.message || 'Audio analysis worker failed.'));
	});
}
function mixToMono(channels) {
	const length = channels[0]?.length || 0;
	const mono = new Float32Array(length);
	for (const channel of channels) for (let index = 0; index < length; index += 1) mono[index] += channel[index] / channels.length;
	return mono;
}
async function createTemporaryFileSink(name) {
	let directory = null;
	let handle = null;
	let writable = null;
	const chunks = [];
	let queue = Promise.resolve();
	let closed = false;
	try {
		const root = await globalThis.navigator?.storage?.getDirectory?.();
		directory = await root?.getDirectoryHandle?.('audio-editor-exports', { create: true });
		handle = await directory?.getFileHandle?.(name, { create: true });
		writable = await handle?.createWritable?.();
	} catch {
		directory = null;
		handle = null;
		writable = null;
	}
	return {
		persistent: Boolean(writable),
		write(chunk) {
			if (closed) throw new Error('The temporary export sink is closed.');
			const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
			if (writable) queue = queue.then(() => writable.write(bytes));
			else chunks.push(bytes);
			return queue;
		},
		async close(mimeType) {
			if (closed) throw new Error('The temporary export sink is closed.');
			closed = true;
			await queue;
			if (writable) {
				await writable.close();
				return handle.getFile();
			}
			return new Blob(chunks, { type: mimeType });
		},
		async remove() {
			if (directory && handle) {
				try { await directory.removeEntry(name); } catch { /* Already removed. */ }
			}
		},
		async abort() {
			closed = true;
			try { await writable?.abort?.(); } catch { /* The writer may already be closed. */ }
			if (directory && handle) {
				try { await directory.removeEntry(name); } catch { /* Already removed. */ }
			}
		},
	};
}

async function createStreamingZipArchive(name, estimatedInputBytes = 0) {
	const sink = await createTemporaryFileSink(name);
	if (!sink.persistent && estimatedInputBytes > 96 * 1024 ** 2) {
		await sink.abort();
		throw new Error('Large stem archives require origin-private file storage in this browser.');
	}
	const { Zip, ZipPassThrough } = await import('fflate');
	let writeQueue = Promise.resolve();
	let closed = false;
	let failed = null;
	let resolveFinished;
	let rejectFinished;
	const finished = new Promise((resolve, reject) => {
		resolveFinished = resolve;
		rejectFinished = reject;
	});
	const zip = new Zip((error, chunk, final) => {
		if (error) {
			failed = error;
			rejectFinished(error);
			return;
		}
		if (chunk?.length) writeQueue = writeQueue.then(() => sink.write(chunk));
		if (final) {
			writeQueue
				.then(() => sink.close('application/zip'))
				.then((blob) => resolveFinished({ blob, cleanup: () => sink.remove() }), rejectFinished);
		}
	});

	return {
		async add(fileName, input, signal) {
			if (closed || failed) throw failed || new Error('The stem archive is closed.');
			throwIfAborted(signal);
			const entry = new ZipPassThrough(fileName);
			zip.add(entry);
			if (input instanceof Blob) {
				const reader = input.stream().getReader();
				try {
					while (true) {
						throwIfAborted(signal);
						const { done, value } = await reader.read();
						if (done) break;
						entry.push(value instanceof Uint8Array ? value : new Uint8Array(value), false);
					}
				} finally {
					reader.releaseLock();
				}
			} else {
				const bytes = input instanceof Uint8Array
					? input
					: ArrayBuffer.isView(input)
						? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
						: new Uint8Array(input || 0);
				if (bytes.length) entry.push(bytes, false);
			}
			entry.push(new Uint8Array(0), true);
			await writeQueue;
		},
		async finish() {
			if (closed) return finished;
			closed = true;
			zip.end();
			return finished;
		},
		async abort() {
			const wasClosed = closed;
			closed = true;
			if (!wasClosed) try { zip.terminate?.(); } catch { /* The stream may already be complete. */ }
			await sink.abort();
		},
	};
}

function stemProject(project, trackId) {
	const snapshot = cloneProject(project);
	snapshot.tracks = snapshot.tracks.map((track) => track.id === trackId
		? { ...track, mute: false, solo: false }
		: { ...track, mute: true, solo: false, effects: [] });
	snapshot.master = { gain: 1, effects: [] };
	return snapshot;
}

function classifyMobile() {
	if (globalThis.navigator?.userAgentData?.mobile != null) return Boolean(globalThis.navigator.userAgentData.mobile);
	return Boolean(globalThis.navigator?.maxTouchPoints > 0 && globalThis.matchMedia?.('(pointer: coarse)').matches && Math.min(globalThis.innerWidth || 9999, globalThis.innerHeight || 9999) < 900);
}

function normalizeLatencyOffset(value) {
	return Math.max(-500, Math.min(500, Number(value) || 0));
}

function formatBytes(value) {
	if (!Number.isFinite(value)) return '—';
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
	return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function isAup3File(file) { return /\.aup3$/i.test(String(file?.name || '').trim()); }
function formatAup3Warning(warning) {
	if (typeof warning === 'string') return warning.trim();
	if (warning?.message) return String(warning.message).trim();
	if (warning?.code) return String(warning.code).trim();
	return '';
}
function stripExtension(name) { return String(name || '').replace(/\.[^.]+$/, ''); }
function abortError() { return typeof DOMException === 'function' ? new DOMException('Aborted', 'AbortError') : Object.assign(new Error('Aborted'), { name: 'AbortError' }); }
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(); }
