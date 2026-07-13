import {
	AUDIO_EDITOR_SAMPLE_RATE,
	AUDIO_EFFECT_DEFINITIONS,
	analyzeAudioChannels,
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
	formatAudacityCurve,
	localized,
	normalizeAudacityEffectParams,
	parseAudacityCurve,
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

const controllers = new WeakMap();
const MIN_TIMELINE_SECONDS = 10;
const DEFAULT_PIXELS_PER_SECOND = 120;
const MAX_PIXELS_PER_SECOND = AUDIO_EDITOR_SAMPLE_RATE;
const MAX_TIMELINE_PIXELS = 16_000_000;
const SOURCE_CHUNK_FRAMES = 65_536;

export function initAudioEditors(root) {
	if (!(root instanceof HTMLElement)) return null;
	if (controllers.has(root)) return controllers.get(root);
	const controller = createAudioEditorController(root);
	controllers.set(root, controller);
	void controller.ready;
	return controller;
}

export function createAudioEditorController(root, options = {}) {
	const copy = parseJson(root.dataset.copy, {});
	const locale = root.dataset.locale === 'de' ? 'de' : 'en';
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
	const nodes = collectNodes(root);
	const state = {
		history: null,
		selectedTrackId: null,
		selectedClipId: null,
		clipboard: null,
		pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND,
		mobile: classifyMobile(),
		timelineWidth: MIN_TIMELINE_SECONDS * DEFAULT_PIXELS_PER_SECOND,
		timelineView: 'waveform',
		timelineDrawFrame: 0,
		resizeObserver: null,
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
		touchPointers: new Map(),
		pinch: null,
		disposed: false,
	};
	let project = null;

	bindStaticControls();
	const ready = bootstrap().catch(handleError);

	return {
		ready,
		get project() { return state.history?.present ?? null; },
		get engine() { return engine; },
		async dispose() {
			if (state.disposed) return;
			state.disposed = true;
			window.clearTimeout(state.autosaveTimer);
			window.clearTimeout(state.sourceGcTimer);
			if (state.timelineDrawFrame) cancelAnimationFrame(state.timelineDrawFrame);
			state.resizeObserver?.disconnect();
			state.audacityEffectWorker?.terminate();
			state.audacityEffectWorker = null;
			document.removeEventListener('keydown', handleKeyboard);
			document.removeEventListener('pointerdown', handleDocumentPointerDown);
			await stopRecording().catch(() => undefined);
			state.projectLock?.release();
			state.projectLock = null;
			if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
			await state.outputCleanup?.();
			ffmpeg.dispose();
			await engine.dispose();
			await store.close?.();
		},
	};

	async function bootstrap() {
		if (!engine || typeof engine.loadProject !== 'function') throw new Error('Web Audio is not supported in this browser.');
		await store.ready();
		await store.cleanupTemporaryAssets?.();
		void store.requestPersistentStorage();
		nodes.monitor.checked = Boolean(await store.loadSetting('input-monitor', false));
		nodes.latencyOffset.value = String(await store.loadSetting('recording-latency-offset-ms', 0));
		const lastProjectId = await store.loadSetting('last-project-id', null);
		const saved = lastProjectId ? await store.loadProject(lastProjectId) : null;
		if (saved) await openProject(saved);
		else await newProject();
		render();
		if (!state.readOnly) await saveNow();
		await refreshStorageUsage();
		if (state.missingSourceIds.size) setStatus(locale === 'de'
			? 'Einige lokale Audioquellen fehlen. Wiedergabe, Analyse und Export sind gesperrt, bis die betroffenen Clips entfernt werden.'
			: 'Some local audio sources are missing. Playback, analysis, and export are blocked until affected clips are removed.', 'error');
		else setStatus(copy.ready, 'success');
	}

	function bindStaticControls() {
		for (const button of root.querySelectorAll('[data-project-action]')) {
			button.addEventListener('click', () => void handleProjectAction(button.dataset.projectAction).catch(handleError));
		}
		nodes.importInput?.addEventListener('change', () => void importFiles(nodes.importInput.files));
		for (const button of root.querySelectorAll('[data-import-button]')) {
			button.addEventListener('click', () => nodes.importInput?.click());
		}
		for (const button of root.querySelectorAll('[data-add-track]')) {
			button.addEventListener('click', () => addTrack());
		}
		for (const button of root.querySelectorAll('[data-edit]')) {
			button.addEventListener('click', () => handleEdit(button.dataset.edit));
		}
		for (const button of root.querySelectorAll('[data-transport]')) {
			button.addEventListener('click', () => void handleTransport(button.dataset.transport).catch(handleError));
		}
		for (const button of root.querySelectorAll('[data-zoom]')) {
			button.addEventListener('click', () => updateZoom(button.dataset.zoom));
		}
		for (const button of root.querySelectorAll('[data-timeline-view]')) {
			button.addEventListener('click', () => setTimelineView(button.dataset.timelineView));
		}
		nodes.fileMenuToggle?.addEventListener('click', (event) => {
			event.stopPropagation();
			toggleMenu(nodes.fileMenuPanel, nodes.fileMenuToggle);
		});
		nodes.monitor?.addEventListener('change', () => {
			nodes.monitorWarning.hidden = !nodes.monitor.checked;
			state.recorder?.setMonitoring(nodes.monitor.checked);
			void store.saveSetting('input-monitor', nodes.monitor.checked);
		});
		nodes.latencyOffset?.addEventListener('change', () => {
			nodes.latencyOffset.value = String(Math.max(-500, Math.min(500, Number(nodes.latencyOffset.value) || 0)));
			void store.saveSetting('recording-latency-offset-ms', Number(nodes.latencyOffset.value));
		});
		for (const tab of root.querySelectorAll('[data-inspector-tab]')) {
			tab.addEventListener('click', () => selectInspectorTab(tab.dataset.inspectorTab));
			tab.addEventListener('keydown', handleInspectorTabKey);
		}
		nodes.inspectorToggle?.addEventListener('click', () => setInspectorOpen(true));
		nodes.inspectorClose?.addEventListener('click', () => setInspectorOpen(false));
		for (const field of root.querySelectorAll('[data-clip-field]')) field.addEventListener('change', () => updateClipField(field));
		for (const button of root.querySelectorAll('[data-clip-action]')) button.addEventListener('click', () => void handleClipAction(button.dataset.clipAction));
		nodes.addEffect?.addEventListener('click', addEffect);
		nodes.effectTarget?.addEventListener('change', renderEffects);
		nodes.audacityEffectType?.addEventListener('change', () => {
			state.audacityEffectType = nodes.audacityEffectType.value;
			renderAudacityEffectPanel();
			renderControls();
		});
		nodes.audacityControlTrack?.addEventListener('change', () => {
			state.audacityControlTrackId = nodes.audacityControlTrack.value || null;
			renderControls();
		});
		nodes.applyAudacityEffect?.addEventListener('click', () => void applySelectedAudacityEffect().catch(handleError));
		nodes.audacityNoiseProfile?.addEventListener('click', () => void captureSelectedNoiseProfile().catch(handleError));
		nodes.masterGain?.addEventListener('input', () => { nodes.masterGainValue.textContent = `${Number(nodes.masterGain.value).toFixed(1)} dB`; });
		nodes.masterGain?.addEventListener('change', () => {
			if (!editingBlocked()) commit({ type: 'master/update', changes: { gain: Math.min(4, dbToLinear(nodes.masterGain.value)) } });
		});
		for (const button of root.querySelectorAll('[data-analyze]')) button.addEventListener('click', () => void runAnalysis(button.dataset.analyze).catch(handleError));
		for (const field of root.querySelectorAll('[data-export-field]')) field.addEventListener('change', updateExportFields);
		for (const button of root.querySelectorAll('[data-export-action]')) button.addEventListener('click', () => void handleExportAction(button.dataset.exportAction));
		bindRulerSelection();
		bindPlayhead();
		bindTimelineGestures();
		updateExportFields();
		nodes.timeline.addEventListener('scroll', scheduleTimelineRedraw, { passive: true });
		state.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(scheduleTimelineRedraw) : null;
		state.resizeObserver?.observe(nodes.timeline);
		document.addEventListener('keydown', handleKeyboard);
		document.addEventListener('pointerdown', handleDocumentPointerDown);
		window.addEventListener('pagehide', handlePageHide, { once: true });
		document.addEventListener('visibilitychange', handleVisibility);
	}

	async function handleProjectAction(action) {
		closeMenu(nodes.fileMenuPanel, nodes.fileMenuToggle);
		if (action === 'new') {
			if (nodes.projectDialog?.open) nodes.projectDialog.close();
			return newProject();
		}
		if (action === 'open') return showProjects();
		if (action === 'rename') return renameProject();
		if (action === 'duplicate') return duplicateProject();
		if (action === 'delete') return deleteProject();
		if (action === 'clear') return clearLocalData();
	}

	async function newProject(options = {}) {
		const nextProject = createAudioEditorProject({ title: copy.untitledProject });
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
		window.clearTimeout(state.autosaveTimer);
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
		if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
		state.outputUrl = null;
		await state.outputCleanup?.();
		state.outputCleanup = null;
		nodes.exportDownload.hidden = true;
		for (const [key, value] of Object.entries({ peak: '−∞ dBFS', truePeak: '−∞ dBTP', rms: '−∞ dBFS', momentary: '—', shortTerm: '—', integrated: '—', lra: '—', correlation: '—', clipping: '0' })) setAnalysisValue(key, value);
		sourceBuffers.clear();
		sourcePeaks.clear();
		state.missingSourceIds.clear();
		await loadProjectSources(project);
		engine.loadProject(project, sourceBuffers);
		await store.saveSetting('last-project-id', nextProject.id);
		if (options.save && !state.readOnly) await store.saveProject(nextProject);
		render();
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

	async function showProjects() {
		await saveNow();
		const projects = await store.listProjects();
		nodes.projectList.replaceChildren();
		nodes.projectListEmpty.hidden = projects.length > 0;
		for (const project of projects) {
			const item = cloneTemplate(nodes.projectTemplate);
			item.querySelector('[data-project-item-name]').textContent = project.title;
			item.querySelector('[data-project-item-date]').textContent = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(project.updatedAt));
			item.querySelector('[data-project-open]').addEventListener('click', async () => {
				nodes.projectDialog.close();
				await openProject(project);
			});
			nodes.projectList.append(item);
		}
		nodes.projectDialog.showModal();
	}

	async function renameProject() {
		if (state.readOnly) return;
		const title = await requestProjectName(project.title);
		if (title) commit({ type: 'project/rename', title });
	}

	async function duplicateProject() {
		if (!project) return;
		await saveNow();
		const duplicated = await store.duplicateProject(project.id, { title: `${project.title} ${locale === 'de' ? 'Kopie' : 'copy'}` });
		await openProject(duplicated);
	}

	async function deleteProject() {
		if (!project || state.readOnly) return;
		const confirmed = await confirmDeletion();
		if (!confirmed) return;
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
	}

	async function garbageCollectSources() {
		if (!store.pruneUnreferencedSources) return;
		window.clearTimeout(state.sourceGcTimer);
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
			state.sourceGcTimer = window.setTimeout(() => {
				state.sourceGcTimer = 0;
				void garbageCollectSources().catch(handleError);
			}, delay);
		}
	}

	async function clearLocalData() {
		const confirmed = window.confirm(locale === 'de'
			? 'Alle lokalen Audio-Editor-Projekte und Aufnahmen endgültig löschen?'
			: 'Permanently delete every local audio-editor project and recording?');
		if (!confirmed) return;
		await stopRecording();
		nodes.projectDialog.close();
		state.projectLock?.release();
		state.projectLock = null;
		engine.stop();
		sourceBuffers.clear();
		sourcePeaks.clear();
		await store.clear();
		state.history = null;
		project = null;
		await newProject({ skipFlush: true });
	}

	function requestProjectName(current) {
		return new Promise((resolve) => {
			nodes.projectNameInput.value = current;
			const close = () => {
				nodes.nameDialog.removeEventListener('close', close);
				resolve(nodes.nameDialog.returnValue === 'save' ? nodes.projectNameInput.value.trim() : null);
			};
			nodes.nameDialog.addEventListener('close', close);
			nodes.nameDialog.showModal();
			nodes.projectNameInput.select();
		});
	}

	function confirmDeletion() {
		return new Promise((resolve) => {
			const close = () => {
				nodes.confirmDialog.removeEventListener('close', close);
				resolve(nodes.confirmDialog.returnValue === 'confirm');
			};
			nodes.confirmDialog.addEventListener('close', close);
			nodes.confirmDialog.showModal();
		});
	}

	async function importFiles(fileList) {
		const files = [...(fileList || [])];
		if (!files.length || editingBlocked()) return;
		state.importing = true;
		renderControls();
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
			if (nodes.importInput) nodes.importInput.value = '';
			if (!failures) setStatus(notices.length ? notices.join(' ') : copy.done, 'success');
			else setStatus(locale === 'de'
				? `${successes} Datei(en) importiert, ${failures} fehlgeschlagen.`
				: `${successes} file(s) imported, ${failures} failed.`, 'error');
		} finally {
			state.importing = false;
			renderControls();
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

	function addTrack() {
		if (editingBlocked()) return;
		const trackId = createStableId('track');
		commit(createAddTrackCommand({ id: trackId, name: `${copy.track} ${project.tracks.length + 1}`, armed: project.tracks.length === 0 }), { selectTrackId: trackId });
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
				renderControls();
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
		render();
		scheduleAutosave();
	}

	function scheduleAutosave() {
		if (state.readOnly) return;
		window.clearTimeout(state.autosaveTimer);
		state.saveGeneration += 1;
		const generation = state.saveGeneration;
		const snapshot = cloneProject(project);
		nodes.saveState.textContent = copy.projectSaving;
		nodes.saveState.dataset.state = 'saving';
		state.autosaveTimer = window.setTimeout(() => {
			state.autosaveTimer = 0;
			void saveSnapshot(snapshot, generation);
		}, 500);
	}

	async function saveNow() {
		if (!state.history || state.readOnly) return;
		window.clearTimeout(state.autosaveTimer);
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
				nodes.saveState.textContent = copy.projectSaved;
				nodes.saveState.dataset.state = 'saved';
			}
			await garbageCollectSources();
			await refreshStorageUsage();
		} catch (error) {
			nodes.saveState.textContent = copy.projectDirty;
			nodes.saveState.dataset.state = 'dirty';
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

	function render() {
		if (!project) return;
		root.dataset.projectId = project.id;
		root.dataset.trackCount = String(project.tracks.length);
		root.dataset.clipCount = String(project.clips.length);
		nodes.projectName.textContent = project.title;
		renderTimeline();
		renderInspector();
		renderControls();
		updatePlayhead(engine.getPositionFrames(), projectDurationFrames(project));
	}

	function renderTimeline() {
		const durationSeconds = Math.max(MIN_TIMELINE_SECONDS, projectDurationFrames(project) / AUDIO_EDITOR_SAMPLE_RATE);
		state.pixelsPerSecond = Math.min(state.pixelsPerSecond, MAX_TIMELINE_PIXELS / durationSeconds);
		state.timelineWidth = Math.max(1, Math.round(durationSeconds * state.pixelsPerSecond));
		root.style.setProperty('--timeline-width', `${state.timelineWidth}px`);
		root.dataset.timelineView = state.timelineView;
		nodes.trackList.replaceChildren();
		nodes.emptyState.hidden = project.tracks.length > 0 || project.clips.length > 0;
		for (const track of project.tracks) nodes.trackList.append(renderTrack(track));
		updateSelectionOverlay();
		redrawTimelineCanvases();
	}

	function setTimelineView(view) {
		state.timelineView = view === 'spectrogram' ? 'spectrogram' : 'waveform';
		root.dataset.timelineView = state.timelineView;
		for (const button of root.querySelectorAll('[data-timeline-view]')) button.setAttribute('aria-pressed', String(button.dataset.timelineView === state.timelineView));
		redrawTimelineCanvases();
	}

	function scheduleTimelineRedraw() {
		if (state.timelineDrawFrame) return;
		state.timelineDrawFrame = requestAnimationFrame(() => {
			state.timelineDrawFrame = 0;
			redrawTimelineCanvases();
		});
	}

	function redrawTimelineCanvases() {
		if (!project || !nodes.timeline?.isConnected) return;
		const headerWidth = Number.parseFloat(getComputedStyle(root).getPropertyValue('--track-header-width')) || 0;
		const viewportWidth = Math.max(1, nodes.timeline.clientWidth - headerWidth);
		const scrollOffset = Math.max(0, nodes.timeline.scrollLeft);
		const durationSeconds = Math.max(MIN_TIMELINE_SECONDS, projectDurationFrames(project) / AUDIO_EDITOR_SAMPLE_RATE);
		drawRuler(nodes.rulerCanvas, durationSeconds, state.pixelsPerSecond, viewportWidth, scrollOffset);
		for (const canvas of nodes.trackList.querySelectorAll('[data-clip-waveform]')) {
			const clip = findClip(project, canvas.closest('[data-clip]')?.dataset.clipId);
			if (clip) drawClipVisual(canvas, clip, sourceBuffers.get(clip.sourceId), sourcePeaks.get(clip.sourceId), { viewportWidth, scrollOffset });
		}
	}

	function drawClipVisual(canvas, clip, buffer, peaks, viewport = {}) {
		if (!canvas || !buffer) return;
		const headerWidth = Number.parseFloat(getComputedStyle(root).getPropertyValue('--track-header-width')) || 0;
		const viewportWidth = viewport.viewportWidth || Math.max(1, nodes.timeline.clientWidth - headerWidth);
		const scrollOffset = viewport.scrollOffset ?? Math.max(0, nodes.timeline.scrollLeft);
		const fullWidth = Math.max(12, framesToPixels(clip.durationFrames));
		const clipLeft = framesToPixels(clip.timelineStartFrame);
		const overscan = 48;
		const visibleStartPx = Math.max(0, scrollOffset - clipLeft - overscan);
		const visibleEndPx = Math.min(fullWidth, scrollOffset + viewportWidth - clipLeft + overscan);
		if (visibleEndPx <= visibleStartPx) {
			canvas.hidden = true;
			return;
		}
		canvas.hidden = false;
		canvas.style.left = `${visibleStartPx}px`;
		const options = { fullWidth, visibleStartPx, visibleWidth: visibleEndPx - visibleStartPx };
		if (state.timelineView === 'spectrogram') drawClipSpectrogram(canvas, clip, buffer, options);
		else drawClipWaveform(canvas, clip, buffer, peaks, options);
	}

	function renderTrack(track) {
		const row = cloneTemplate(nodes.trackTemplate);
		const blocked = editingBlocked();
		row.dataset.trackId = track.id;
		const header = row.querySelector('[data-track-header]');
		const lane = row.querySelector('[data-track-lane]');
		const name = row.querySelector('[data-track-name]');
		name.value = track.name;
		name.disabled = blocked;
		name.addEventListener('change', () => commit({ type: 'track/update', trackId: track.id, changes: { name: name.value.trim() || copy.track } }));
		lane.dataset.trackId = track.id;
		lane.setAttribute('aria-label', track.name);
		lane.setAttribute('aria-selected', String(state.selectedTrackId === track.id));
		lane.addEventListener('pointerdown', (event) => {
			if (event.target.closest('[data-clip]') || state.recordingStarting || state.recorder) return;
			state.selectedTrackId = track.id;
			state.selectedClipId = null;
			engine.seek(frameAtPointer(event, lane));
			render();
		});
		lane.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				state.selectedTrackId = track.id;
				state.selectedClipId = null;
				render();
			} else if (!state.recorder && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
				event.preventDefault();
				const amount = event.shiftKey ? Math.round(AUDIO_EDITOR_SAMPLE_RATE / 10) : 1;
				engine.seek(engine.getPositionFrames() + (event.key === 'ArrowLeft' ? -amount : amount));
			}
		});
		for (const button of row.querySelectorAll('[data-track-action]')) {
			button.disabled = blocked;
			const action = button.dataset.trackAction;
			if (action === 'mute' || action === 'solo' || action === 'arm') {
				button.setAttribute('aria-pressed', String(Boolean(track[action === 'arm' ? 'armed' : action])));
				button.addEventListener('click', () => commit({ type: 'track/update', trackId: track.id, changes: { [action === 'arm' ? 'armed' : action]: !track[action === 'arm' ? 'armed' : action] } }, { selectTrackId: track.id }));
			} else if (action === 'menu') {
				const menu = row.querySelector('[data-track-menu]');
				button.addEventListener('click', (event) => {
					event.stopPropagation();
					toggleMenu(menu, button);
				});
				header.addEventListener('contextmenu', (event) => {
					event.preventDefault();
					closeAllMenus();
					menu.hidden = false;
					button.setAttribute('aria-expanded', 'true');
				});
			}
		}
		for (const item of row.querySelectorAll('[data-track-menu-action]')) {
			item.disabled = blocked;
			item.addEventListener('click', () => {
				closeAllMenus();
				const action = item.dataset.trackMenuAction;
				if (action === 'rename') {
					name.focus();
					name.select();
				} else if (action === 'duplicate') duplicateTrack(track);
				else if (action === 'delete' && window.confirm(locale === 'de' ? `Spur „${track.name}“ löschen?` : `Delete track “${track.name}”?`)) {
					commit({ type: 'track/remove', trackId: track.id });
				}
			});
		}
		bindTrackSlider(row, track, 'gain');
		bindTrackSlider(row, track, 'pan');
		const clipLayer = row.querySelector('[data-clip-layer]');
		for (const clipId of track.clipIds) {
			const clip = findClip(project, clipId);
			if (clip) clipLayer.append(renderClip(clip, track));
		}
		return row;
	}

	function bindTrackSlider(row, track, property) {
		const input = row.querySelector(`[data-track-${property}]`);
		const output = row.querySelector(`[data-track-${property}-value]`);
		input.disabled = editingBlocked();
		if (property === 'gain') {
			input.value = String(linearToDb(track.gain));
			output.textContent = `${Number(input.value).toFixed(1)} dB`;
		} else {
			input.value = String(track.pan);
			output.textContent = panLabel(track.pan, copy.center);
		}
		input.addEventListener('input', () => {
			output.textContent = property === 'gain' ? `${Number(input.value).toFixed(1)} dB` : panLabel(Number(input.value), copy.center);
		});
		input.addEventListener('change', () => commit({ type: 'track/update', trackId: track.id, changes: { [property]: property === 'gain' ? dbToLinear(input.value) : Number(input.value) } }, { selectTrackId: track.id }));
	}

	function renderClip(clip, track) {
		const element = cloneTemplate(nodes.clipTemplate);
		const source = findSource(project, clip.sourceId);
		const left = framesToPixels(clip.timelineStartFrame);
		const width = Math.max(12, framesToPixels(clip.durationFrames));
		element.dataset.clipId = clip.id;
		element.dataset.trackId = track.id;
		element.style.left = `${left}px`;
		element.style.width = `${width}px`;
		element.setAttribute('aria-pressed', String(state.selectedClipId === clip.id));
		element.querySelector('[data-clip-label]').textContent = source?.name || copy.clip;
		element.querySelector('[data-clip-fade="in"]').style.setProperty('--fade-width', `${Math.min(width, framesToPixels(clip.fadeInFrames))}px`);
		element.querySelector('[data-clip-fade="out"]').style.setProperty('--fade-width', `${Math.min(width, framesToPixels(clip.fadeOutFrames))}px`);
		element.addEventListener('click', (event) => {
			event.stopPropagation();
			state.selectedTrackId = track.id;
			state.selectedClipId = clip.id;
			render();
		});
		element.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				state.selectedTrackId = track.id;
				state.selectedClipId = clip.id;
				render();
			}
		});
		bindClipDrag(element, clip, track);
		drawClipVisual(element.querySelector('[data-clip-waveform]'), clip, sourceBuffers.get(clip.sourceId), sourcePeaks.get(clip.sourceId));
		return element;
	}

	function duplicateTrack(track) {
		if (editingBlocked()) return;
		const trackId = createStableId('track');
		const commands = [createAddTrackCommand({ ...track, id: trackId, name: `${track.name} ${locale === 'de' ? 'Kopie' : 'copy'}`, armed: false, clipIds: [] })];
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

	function bindClipDrag(element, clip, track) {
		element.addEventListener('pointerdown', (event) => {
			if (editingBlocked() || event.button !== 0) return;
			event.stopPropagation();
			const handle = event.target.closest('[data-clip-handle]')?.dataset.clipHandle || 'move';
			const startX = event.clientX;
			const original = { ...clip };
			element.setPointerCapture(event.pointerId);
			const move = (nextEvent) => {
				const delta = pixelsToFrames(nextEvent.clientX - startX);
				if (handle === 'move') element.style.transform = `translateX(${framesToPixels(Math.max(-original.timelineStartFrame, delta))}px)`;
				else if (handle === 'start') {
					const clamped = Math.max(-original.timelineStartFrame, Math.min(original.durationFrames - 1, delta));
					element.style.transform = `translateX(${framesToPixels(clamped)}px)`;
					element.style.width = `${Math.max(12, framesToPixels(original.durationFrames - clamped))}px`;
				} else {
					const duration = Math.max(1, original.durationFrames + delta);
					element.style.width = `${Math.max(12, framesToPixels(duration))}px`;
				}
			};
			const up = (nextEvent) => {
				element.removeEventListener('pointermove', move);
				element.removeEventListener('pointerup', up);
				element.removeEventListener('pointercancel', cancel);
				if (root.dataset.pinching === 'true') { render(); return; }
				const delta = pixelsToFrames(nextEvent.clientX - startX);
				try {
					if (handle === 'move') {
						const targetLane = document.elementFromPoint(nextEvent.clientX, nextEvent.clientY)?.closest?.('[data-track-lane]');
						const targetTrackId = targetLane?.dataset.trackId || track.id;
						commit({ type: 'clip/move', clipId: clip.id, trackId: targetTrackId, timelineStartFrame: Math.max(0, original.timelineStartFrame + delta) }, { selectTrackId: targetTrackId, selectClipId: clip.id });
					}
					else if (handle === 'start') {
						const source = findSource(project, clip.sourceId);
						const sourceExtension = original.reversed
							? source.frameCount - original.sourceStartFrame - original.durationFrames
							: original.sourceStartFrame;
						const change = Math.max(-Math.min(original.timelineStartFrame, sourceExtension), Math.min(original.durationFrames - 1, delta));
						commit({ type: 'clip/trim', clipId: clip.id, timelineStartFrame: original.timelineStartFrame + change, sourceStartFrame: original.sourceStartFrame + (original.reversed ? 0 : change), durationFrames: original.durationFrames - change }, { selectTrackId: track.id, selectClipId: clip.id });
					} else {
						const source = findSource(project, clip.sourceId);
						const maximum = original.reversed
							? original.sourceStartFrame + original.durationFrames
							: source.frameCount - original.sourceStartFrame;
						const durationFrames = Math.max(1, Math.min(maximum, original.durationFrames + delta));
						const sourceStartFrame = original.reversed
							? original.sourceStartFrame + original.durationFrames - durationFrames
							: original.sourceStartFrame;
						commit({ type: 'clip/trim', clipId: clip.id, sourceStartFrame, durationFrames }, { selectTrackId: track.id, selectClipId: clip.id });
					}
				} catch (error) { handleError(error); render(); }
			};
			const cancel = () => { element.removeEventListener('pointermove', move); render(); };
			element.addEventListener('pointermove', move);
			element.addEventListener('pointerup', up);
			element.addEventListener('pointercancel', cancel);
		});
	}

	function bindRulerSelection() {
		nodes.ruler.addEventListener('pointerdown', (event) => {
			if (event.button !== 0 || state.recordingStarting || state.recorder) return;
			const startFrame = frameAtPointer(event, nodes.ruler);
			nodes.ruler.setPointerCapture(event.pointerId);
			const move = (nextEvent) => previewSelection(startFrame, frameAtPointer(nextEvent, nodes.ruler));
			const finish = (nextEvent) => {
				nodes.ruler.removeEventListener('pointermove', move);
				nodes.ruler.removeEventListener('pointerup', finish);
				const endFrame = frameAtPointer(nextEvent, nodes.ruler);
				if (Math.abs(endFrame - startFrame) < pixelsToFrames(3)) {
					engine.seek(endFrame);
					commit({ type: 'selection/set', startFrame: endFrame, endFrame });
				} else commit({ type: 'selection/set', startFrame, endFrame });
			};
			nodes.ruler.addEventListener('pointermove', move);
			nodes.ruler.addEventListener('pointerup', finish);
		});
	}

	function bindPlayhead() {
		const seekAt = (event) => engine.seek(frameAtPointer(event, nodes.ruler));
		nodes.playhead?.addEventListener('pointerdown', (event) => {
			if (state.recorder) return;
			event.preventDefault();
			event.stopPropagation();
			nodes.playhead.setPointerCapture(event.pointerId);
			seekAt(event);
			const move = (nextEvent) => seekAt(nextEvent);
			const finish = () => {
				nodes.playhead.removeEventListener('pointermove', move);
				nodes.playhead.removeEventListener('pointerup', finish);
				nodes.playhead.removeEventListener('pointercancel', finish);
			};
			nodes.playhead.addEventListener('pointermove', move);
			nodes.playhead.addEventListener('pointerup', finish);
			nodes.playhead.addEventListener('pointercancel', finish);
		});
		nodes.playhead?.addEventListener('keydown', (event) => {
			if (state.recorder) return;
			const amount = event.shiftKey ? Math.round(AUDIO_EDITOR_SAMPLE_RATE / 10) : 1;
			if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
				event.preventDefault();
				engine.seek(engine.getPositionFrames() + (event.key === 'ArrowLeft' ? -amount : amount));
			} else if (event.key === 'Home' || event.key === 'End') {
				event.preventDefault();
				engine.seek(event.key === 'Home' ? 0 : projectDurationFrames(project));
			}
		});
	}

	function bindTimelineGestures() {
		const updatePinch = () => {
			if (state.touchPointers.size !== 2) return;
			const points = [...state.touchPointers.values()];
			const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
			const midpoint = (points[0].x + points[1].x) / 2;
			if (!state.pinch) {
				state.pinch = { distance, pixelsPerSecond: state.pixelsPerSecond, midpoint, scrollLeft: nodes.timeline.scrollLeft };
				root.dataset.pinching = 'true';
				return;
			}
			const rect = nodes.timeline.getBoundingClientRect();
			const anchorSeconds = (state.pinch.scrollLeft + state.pinch.midpoint - rect.left) / state.pinch.pixelsPerSecond;
			state.pixelsPerSecond = Math.max(1, Math.min(MAX_PIXELS_PER_SECOND, state.pinch.pixelsPerSecond * distance / state.pinch.distance));
			renderTimeline();
			nodes.timeline.scrollLeft = Math.max(0, anchorSeconds * state.pixelsPerSecond - (midpoint - rect.left));
		};
		nodes.timeline.addEventListener('pointerdown', (event) => {
			if (event.pointerType !== 'touch') return;
			state.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			updatePinch();
		}, { capture: true });
		nodes.timeline.addEventListener('pointermove', (event) => {
			if (!state.touchPointers.has(event.pointerId)) return;
			state.touchPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (state.touchPointers.size === 2) {
				event.preventDefault();
				updatePinch();
			}
		}, { capture: true });
		const finish = (event) => {
			state.touchPointers.delete(event.pointerId);
			if (state.touchPointers.size < 2) {
				state.pinch = null;
				queueMicrotask(() => { delete root.dataset.pinching; });
			}
		};
		nodes.timeline.addEventListener('pointerup', finish, { capture: true });
		nodes.timeline.addEventListener('pointercancel', finish, { capture: true });
	}

	function renderInspector() {
		renderClipInspector();
		renderEffects();
	}

	function renderClipInspector() {
		const clip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const source = clip ? findSource(project, clip.sourceId) : null;
		nodes.noClip.hidden = Boolean(clip);
		const blocked = editingBlocked();
		root.querySelector('[data-clip-fields]')?.setAttribute('aria-disabled', String(!clip || blocked));
		for (const field of root.querySelectorAll('[data-clip-field]')) field.disabled = !clip || blocked;
		for (const button of root.querySelectorAll('[data-clip-action]')) button.disabled = !clip || blocked;
		if (!clip) return;
		setClipField('name', source?.name || copy.clip);
		root.querySelector('[data-clip-field="name"]').readOnly = true;
		setClipField('start', formatEditableTime(clip.timelineStartFrame));
		setClipField('sourceIn', formatEditableTime(clip.sourceStartFrame));
		setClipField('duration', formatEditableTime(clip.durationFrames));
		setClipField('startFrame', String(clip.timelineStartFrame));
		setClipField('sourceInFrame', String(clip.sourceStartFrame));
		setClipField('durationFrame', String(clip.durationFrames));
		setClipField('gain', linearToDb(clip.gain).toFixed(1));
		setClipField('fadeIn', (clip.fadeInFrames / AUDIO_EDITOR_SAMPLE_RATE).toFixed(3));
		setClipField('fadeOut', (clip.fadeOutFrames / AUDIO_EDITOR_SAMPLE_RATE).toFixed(3));
	}

	function updateClipField(field) {
		if (editingBlocked()) return;
		const clip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		if (!clip || field.dataset.clipField === 'name') return;
		try {
			const name = field.dataset.clipField;
			if (name === 'start') commit({ type: 'clip/move', clipId: clip.id, trackId: findClipTrack(project, clip.id).id, timelineStartFrame: parseTimeFrames(field.value) }, { selectClipId: clip.id });
			else if (name === 'sourceIn') commit({ type: 'clip/trim', clipId: clip.id, sourceStartFrame: parseTimeFrames(field.value) }, { selectClipId: clip.id });
			else if (name === 'startFrame') commit({ type: 'clip/move', clipId: clip.id, trackId: findClipTrack(project, clip.id).id, timelineStartFrame: parseFrameInput(field.value) }, { selectClipId: clip.id });
			else if (name === 'sourceInFrame') commit({ type: 'clip/trim', clipId: clip.id, sourceStartFrame: parseFrameInput(field.value) }, { selectClipId: clip.id });
			else if (name === 'duration') {
				const durationFrames = Math.max(1, parseTimeFrames(field.value));
				const sourceStartFrame = clip.reversed ? clip.sourceStartFrame + clip.durationFrames - durationFrames : clip.sourceStartFrame;
				commit({ type: 'clip/trim', clipId: clip.id, sourceStartFrame, durationFrames }, { selectClipId: clip.id });
			}
			else if (name === 'durationFrame') {
				const durationFrames = Math.max(1, parseFrameInput(field.value));
				const sourceStartFrame = clip.reversed ? clip.sourceStartFrame + clip.durationFrames - durationFrames : clip.sourceStartFrame;
				commit({ type: 'clip/trim', clipId: clip.id, sourceStartFrame, durationFrames }, { selectClipId: clip.id });
			}
			else if (name === 'gain') commit({ type: 'clip/update', clipId: clip.id, changes: { gain: dbToLinear(field.value) } }, { selectClipId: clip.id });
			else if (name === 'fadeIn' || name === 'fadeOut') commit({ type: 'clip/update', clipId: clip.id, changes: { [`${name}Frames`]: Math.min(clip.durationFrames, Math.max(0, Math.round(Number(field.value) * AUDIO_EDITOR_SAMPLE_RATE))) } }, { selectClipId: clip.id });
		} catch (error) { handleError(error); renderClipInspector(); }
	}

	async function handleClipAction(action) {
		if (editingBlocked()) return;
		const clip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
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

	function addEffect() {
		if (editingBlocked()) return;
		const scope = nodes.effectTarget.value;
		const trackId = state.selectedTrackId;
		if (scope === 'track' && !trackId) return handleError(new Error(locale === 'de' ? 'Wähle zuerst eine Spur.' : 'Select a track first.'));
		commit({ type: 'effect/add', scope, trackId, effect: createEffect(nodes.effectType.value) });
	}

	function renderEffects() {
		if (!state.history) return;
		nodes.masterGain.value = String(linearToDb(project.master.gain));
		nodes.masterGainValue.textContent = `${Number(nodes.masterGain.value).toFixed(1)} dB`;
		const scope = nodes.effectTarget.value;
		const rack = scope === 'master' ? project.master.effects : findTrack(project, state.selectedTrackId)?.effects || [];
		nodes.effectRack.querySelectorAll('[data-effect]').forEach((node) => node.remove());
		nodes.effectEmpty.hidden = rack.length > 0;
		for (const [index, effect] of rack.entries()) {
			const card = cloneTemplate(nodes.effectTemplate);
			card.dataset.effectId = effect.id;
			card.querySelector('[data-effect-name]').textContent = effectLabel(effect.type, copy);
			const enabled = card.querySelector('[data-effect-enabled]');
			enabled.checked = effect.enabled;
			enabled.disabled = editingBlocked();
			enabled.addEventListener('change', () => commit({ type: 'effect/update', scope, trackId: state.selectedTrackId, effectId: effect.id, changes: { enabled: enabled.checked } }));
			for (const button of card.querySelectorAll('[data-effect-action]')) {
				button.disabled = editingBlocked();
				button.addEventListener('click', () => {
					const action = button.dataset.effectAction;
					if (action === 'remove') commit({ type: 'effect/remove', scope, trackId: state.selectedTrackId, effectId: effect.id });
					else commit({ type: 'effect/reorder', scope, trackId: state.selectedTrackId, effectId: effect.id, toIndex: Math.max(0, Math.min(rack.length - 1, index + (action === 'up' ? -1 : 1))) });
				});
			}
			renderEffectParameters(card.querySelector('[data-effect-parameters]'), effect, scope);
			nodes.effectRack.append(card);
		}
		renderAudacityEffectPanel();
	}

	function renderEffectParameters(container, effect, scope) {
		container.replaceChildren();
		const addParameter = (label, value, path, range) => {
			const wrapper = document.createElement('label');
			wrapper.className = 'field';
			const caption = document.createElement('span');
			caption.textContent = label;
			const input = document.createElement('input');
			input.type = 'number';
			input.value = String(value);
			input.step = 'any';
			if (range) [input.min, input.max] = range.map(String);
			input.disabled = editingBlocked();
			input.addEventListener('change', () => {
				const params = structuredClone(effect.params);
				setPath(params, path, Number(input.value));
				commit({ type: 'effect/update', scope, trackId: state.selectedTrackId, effectId: effect.id, changes: { params } });
			});
			wrapper.append(caption, input);
			container.append(wrapper);
		};
		if (effect.type === 'eq') {
			effect.params.bands.forEach((band, index) => {
				addParameter(`B${index + 1} Hz`, band.frequency, ['bands', index, 'frequency'], [10, 24000]);
				addParameter(`B${index + 1} dB`, band.gain, ['bands', index, 'gain'], [-24, 24]);
				addParameter(`B${index + 1} Q`, band.q, ['bands', index, 'q'], [0.1, 30]);
			});
		} else {
			const ranges = AUDIO_EFFECT_DEFINITIONS[effect.type]?.ranges || {};
			for (const [key, value] of Object.entries(effect.params)) if (typeof value === 'number') addParameter(key, value, [key], ranges[key]);
		}
	}

	function renderAudacityEffectPanel() {
		if (!nodes.audacityEffectType || !nodes.audacityEffectParameters) return;
		const types = audacityEffectTypes();
		if (!AUDACITY_EFFECT_DEFINITIONS[state.audacityEffectType]) state.audacityEffectType = types[0];
		nodes.audacityEffectType.replaceChildren(...types.map((type) => {
			const option = document.createElement('option');
			option.value = type;
			option.textContent = audacityEffectLabel(type, locale);
			return option;
		}));
		nodes.audacityEffectType.value = state.audacityEffectType;
		const definition = AUDACITY_EFFECT_DEFINITIONS[state.audacityEffectType];
		const params = currentAudacityEffectParams();
		nodes.audacityEffectParameters.replaceChildren();
		for (const [name, descriptor] of Object.entries(definition.params)) {
			if (descriptor.kind === 'bands') renderAudacityBands(name, descriptor, params);
			else renderAudacityParameter(name, descriptor, params);
		}

		const controlTracks = project.tracks.filter((track) => track.id !== state.selectedTrackId);
		if (!controlTracks.some((track) => track.id === state.audacityControlTrackId)) {
			state.audacityControlTrackId = controlTracks[0]?.id ?? null;
		}
		nodes.audacityControlTrack.replaceChildren(...controlTracks.map((track) => {
			const option = document.createElement('option');
			option.value = track.id;
			option.textContent = track.name;
			return option;
		}));
		nodes.audacityControlTrack.value = state.audacityControlTrackId || '';
		nodes.audacityControlField.hidden = !definition.requiresControlTrack;
		nodes.audacityNoiseProfile.hidden = !definition.requiresNoiseProfile;
		const target = audacityEffectTarget();
		if (definition.requiresNoiseProfile) {
			nodes.audacityEffectHint.textContent = state.audacityNoiseProfile ? copy.noiseProfileReady : copy.noiseProfileMissing;
		} else nodes.audacityEffectHint.textContent = target ? formatAudacityTargetHint(target, locale) : copy.audacitySelectionHint;
	}

	function renderAudacityParameter(name, descriptor, params) {
		const wrapper = document.createElement('label');
		wrapper.className = descriptor.kind === 'curve' ? 'field wide' : descriptor.kind === 'boolean' ? 'check-field wide' : 'field';
		const caption = document.createElement('span');
		caption.textContent = localized(descriptor.label, locale);
		let input;
		if (descriptor.kind === 'boolean') {
			input = document.createElement('input');
			input.type = 'checkbox';
			input.checked = Boolean(params[name]);
			wrapper.append(input, caption);
		} else if (descriptor.kind === 'enum') {
			input = document.createElement('select');
			input.replaceChildren(...descriptor.options.map((item) => {
				const option = document.createElement('option');
				option.value = String(item.value);
				option.textContent = localized(item.label, locale);
				return option;
			}));
			input.value = String(params[name]);
			wrapper.append(caption, input);
		} else if (descriptor.kind === 'curve') {
			input = document.createElement('textarea');
			input.value = formatAudacityCurve(params[name]);
			wrapper.append(caption, input);
		} else {
			input = document.createElement('input');
			input.type = 'number';
			input.value = String(params[name]);
			input.min = String(descriptor.minimum);
			input.max = String(descriptor.maximum);
			input.step = String(descriptor.step ?? 'any');
			wrapper.append(caption, input);
			if (descriptor.unit) {
				const unit = document.createElement('small');
				unit.textContent = descriptor.unit;
				wrapper.append(unit);
			}
		}
		input.dataset.audacityParam = name;
		input.disabled = editingBlocked();
		input.addEventListener('change', () => updateAudacityParameter(name, descriptor, input));
		nodes.audacityEffectParameters.append(wrapper);
	}

	function renderAudacityBands(name, descriptor, params) {
		const container = document.createElement('fieldset');
		container.className = 'audacity-band-grid wide';
		const legend = document.createElement('legend');
		legend.textContent = localized(descriptor.label, locale);
		container.append(legend);
		descriptor.frequencies.forEach((frequency, index) => {
			const wrapper = document.createElement('label');
			wrapper.className = 'field';
			const caption = document.createElement('span');
			caption.textContent = `${frequency} Hz`;
			const input = document.createElement('input');
			input.type = 'number';
			input.min = String(descriptor.minimum);
			input.max = String(descriptor.maximum);
			input.step = String(descriptor.step);
			input.value = String(params[name][index]);
			input.disabled = editingBlocked();
			input.addEventListener('change', () => {
				const values = [...currentAudacityEffectParams()[name]];
				values[index] = Number(input.value);
				setAudacityEffectParams({ [name]: values });
				renderAudacityEffectPanel();
			});
			wrapper.append(caption, input);
			container.append(wrapper);
		});
		nodes.audacityEffectParameters.append(container);
	}

	function updateAudacityParameter(name, descriptor, input) {
		try {
			const value = descriptor.kind === 'boolean'
				? input.checked
				: descriptor.kind === 'curve'
					? parseAudacityCurve(input.value)
					: descriptor.kind === 'number'
						? Number(input.value)
						: input.value;
			setAudacityEffectParams({ [name]: value });
			renderAudacityEffectPanel();
			renderControls();
		} catch (error) {
			handleError(error);
			renderAudacityEffectPanel();
		}
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

	function audacityEffectTarget() {
		const selectedClip = state.selectedClipId ? findClip(project, state.selectedClipId) : null;
		const selectedClipTrack = selectedClip ? findClipTrack(project, selectedClip.id) : null;
		const track = findTrack(project, state.selectedTrackId) || selectedClipTrack;
		if (!track) return null;
		const selection = activeSelection();
		const startFrame = selection?.startFrame ?? selectedClip?.timelineStartFrame;
		const endFrame = selection?.endFrame ?? (selectedClip ? selectedClip.timelineStartFrame + selectedClip.durationFrames : null);
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
		renderControls();
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
			renderAudacityEffectPanel();
			renderControls();
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
		renderControls();
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
			renderAudacityEffectPanel();
			renderControls();
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
			showAnalysis(cached.result);
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
			await store.saveAnalysis(analysisKey, { result, createdAt: new Date().toISOString() });
			showAnalysis(result);
			drawAnalysisVisuals(channels, rendered.sampleRate);
			setStatus(copy.done, 'success');
		} catch (error) { handleError(error); }
	}

	async function handleExportAction(action) {
		if (action === 'cancel') {
			state.exportGeneration += 1;
			state.exportAbort?.abort();
			state.exportAbort = null;
			ffmpeg.dispose();
			toggleExport(false);
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
			const settings = exportSettings();
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
			nodes.exportDownload.href = state.outputUrl;
			nodes.exportDownload.download = fileName;
			nodes.exportDownload.textContent = fileName;
			nodes.exportDownload.hidden = false;
			setStatus(copy.done, 'success');
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

	async function startRecording() {
		if (state.readOnly || state.recordingStarting || state.recorder) return;
		const track = project.tracks.find((item) => item.armed);
		if (!track) throw new Error(locale === 'de' ? 'Aktiviere zuerst genau eine Spur für die Aufnahme.' : 'Arm one track before recording.');
		state.recordingStarting = true;
		renderControls();
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
			const manualLatency = Number(nodes.latencyOffset?.value || 0) / 1000;
			const latencyFrames = Math.max(0, Math.round((automaticLatency + manualLatency) * AUDIO_EDITOR_SAMPLE_RATE));
			state.recordingStartFrame = selection ? requestedStartFrame : Math.max(0, requestedStartFrame - latencyFrames);
			state.recordingSourceOffsetFrames = selection ? latencyFrames : Math.max(0, latencyFrames - requestedStartFrame);
			recorder = await createRecordingController({
				context,
				stream,
				channelCount,
				monitor: Boolean(nodes.monitor?.checked),
					onChunk: async ({ channels }) => {
					const canonicalChannels = resampler.push(channels);
					if (canonicalChannels[0]?.length) await writer.write(canonicalChannels);
					let peak = 0;
					for (const channel of channels) for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
					const db = peak > 0 ? 20 * Math.log10(peak) : -60;
					nodes.inputMeterFill.style.setProperty('--meter', `${meterPercent(db)}%`);
					nodes.inputMeter.setAttribute('aria-valuenow', String(Math.max(-60, db).toFixed(1)));
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
			nodes.monitorWarning.hidden = !nodes.monitor.checked;
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
			renderControls();
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
			nodes.inputMeterFill.style.setProperty('--meter', '0%');
			nodes.inputMeter.setAttribute('aria-valuenow', '-60');
			updateTransportState(engine.getState().state);
			renderControls();
		}
	}

	function renderControls() {
		const hasSelection = Boolean(activeSelection());
		const hasClip = Boolean(state.selectedClipId && findClip(project, state.selectedClipId));
		const blocked = editingBlocked();
		for (const button of root.querySelectorAll('[data-edit]')) {
			const action = button.dataset.edit;
			button.disabled = blocked || (action === 'undo' ? !canUndo(state.history) : action === 'redo' ? !canRedo(state.history) : action === 'paste' ? !state.clipboard : action === 'split' ? !hasClip : !hasSelection && !(action === 'delete' && hasClip));
		}
		for (const element of root.querySelectorAll('[data-project-action], [data-add-track], [data-import-input], [data-add-effect]')) {
			const safeReadOnlyProjectAction = element.matches('[data-project-action="new"], [data-project-action="open"], [data-project-action="duplicate"]');
			element.disabled = Boolean(state.importing || state.recordingStarting || state.recorder || state.exportAbort || state.audacityEffectProcessing || (state.readOnly && !safeReadOnlyProjectAction));
		}
		const recordButton = root.querySelector('[data-transport="record"]');
		if (recordButton) recordButton.disabled = state.readOnly || state.importing || state.recordingStarting || Boolean(state.exportAbort);
		const exportButton = root.querySelector('[data-export-action="start"]');
		if (exportButton) exportButton.disabled = state.importing || state.recordingStarting || Boolean(state.recorder) || Boolean(state.exportAbort) || state.missingSourceIds.size > 0;
		for (const element of root.querySelectorAll('[data-effect-target], [data-effect-type], [data-master-gain]')) element.disabled = blocked;
		for (const element of root.querySelectorAll('[data-track-name], [data-track-gain], [data-track-pan], [data-track-action], [data-track-menu-action], [data-effect] input, [data-effect] button')) element.disabled = blocked;
		for (const element of root.querySelectorAll('[data-audacity-effect-type], [data-audacity-control-track], [data-audacity-effect-parameters] input, [data-audacity-effect-parameters] select, [data-audacity-effect-parameters] textarea')) element.disabled = blocked;
		const audacityTarget = audacityEffectTarget();
		const audacityDefinition = AUDACITY_EFFECT_DEFINITIONS[state.audacityEffectType];
		if (nodes.applyAudacityEffect) nodes.applyAudacityEffect.disabled = blocked || !audacityTarget || (audacityDefinition?.requiresControlTrack && !state.audacityControlTrackId) || (audacityDefinition?.requiresNoiseProfile && !state.audacityNoiseProfile);
		if (nodes.audacityNoiseProfile) nodes.audacityNoiseProfile.disabled = blocked || !audacityTarget;
		for (const element of root.querySelectorAll('[data-clip-field], [data-clip-action]')) element.disabled = blocked || !hasClip;
		const loopButton = root.querySelector('[data-transport="loop"]');
		loopButton?.setAttribute('aria-pressed', String(Boolean(project.loop.enabled)));
	}

	function editingBlocked() {
		return Boolean(state.readOnly || state.importing || state.recordingStarting || state.recorder || state.exportAbort || state.audacityEffectProcessing);
	}

	function updatePlayhead(frame = 0, duration = project ? projectDurationFrames(project) : 0) {
		if (!nodes.playhead || !nodes.timeDisplay) return;
		nodes.timeDisplay.value = formatTime(frame / AUDIO_EDITOR_SAMPLE_RATE);
		nodes.playhead.style.setProperty('--playhead-x', `${framesToPixels(frame)}px`);
		nodes.playhead.setAttribute('aria-valuenow', String(frame));
		nodes.playhead.setAttribute('aria-valuemax', String(duration));
		nodes.playhead.dataset.duration = String(duration);
	}

	function updateTransportState(value) {
		const playing = value === 'playing';
		const recording = value === 'recording' || Boolean(state.recorder);
		const playButton = root.querySelector('[data-transport="play"]');
		const icon = playButton?.querySelector('[data-play-icon]');
		const label = playButton?.querySelector('[data-play-label]');
		if (icon) icon.textContent = playing ? 'Ⅱ' : '▶';
		if (label) label.textContent = playing ? copy.pause : copy.play;
		playButton?.setAttribute('aria-label', playing ? copy.pause : copy.play);
		root.querySelector('[data-transport="record"]')?.setAttribute('aria-pressed', String(recording));
	}

	function updateMeters(meters) {
		for (const [trackId, meter] of Object.entries(meters.tracks || {})) {
			const row = nodes.trackList.querySelector(`[data-track-id="${cssEscape(trackId)}"]`);
			for (const bar of row?.querySelectorAll('[data-track-meter-left], [data-track-meter-right]') || []) bar.style.setProperty('--meter', `${meterPercent(meter.dbfs)}%`);
			row?.querySelector('[data-track-meter]')?.setAttribute('aria-valuenow', String(Math.max(-60, Number.isFinite(meter.dbfs) ? meter.dbfs : -60).toFixed(1)));
		}
		if (meters.master) {
			setAnalysisValue('peak', formatDb(meters.master.dbfs, 'dBFS'));
			setAnalysisValue('rms', formatDb(meters.master.rms > 0 ? 20 * Math.log10(meters.master.rms) : -Infinity, 'dBFS'));
		}
	}

	function updateZoom(action) {
		if (action === 'fit') {
			const viewport = Math.max(320, nodes.timeline.clientWidth - 248);
			state.pixelsPerSecond = Math.max(1, viewport / Math.max(MIN_TIMELINE_SECONDS, projectDurationFrames(project) / AUDIO_EDITOR_SAMPLE_RATE));
		} else state.pixelsPerSecond = Math.max(1, Math.min(MAX_PIXELS_PER_SECOND, state.pixelsPerSecond * (action === 'in' ? 2 : 0.5)));
		renderTimeline();
		updatePlayhead(engine.getPositionFrames());
	}

	function updateSelectionOverlay() {
		const selection = activeSelection();
		for (const overlay of root.querySelectorAll('[data-selection-overlay], [data-track-selection]')) {
			overlay.hidden = !selection;
			if (selection) {
				overlay.style.left = `${framesToPixels(selection.startFrame)}px`;
				overlay.style.width = `${Math.max(1, framesToPixels(selection.endFrame - selection.startFrame))}px`;
			}
		}
	}

	function previewSelection(startFrame, endFrame) {
		const selection = { startFrame: Math.min(startFrame, endFrame), endFrame: Math.max(startFrame, endFrame) };
		for (const overlay of root.querySelectorAll('[data-selection-overlay], [data-track-selection]')) {
			overlay.hidden = false;
			overlay.style.left = `${framesToPixels(selection.startFrame)}px`;
			overlay.style.width = `${Math.max(1, framesToPixels(selection.endFrame - selection.startFrame))}px`;
		}
	}

	function selectInspectorTab(name) {
		for (const tab of root.querySelectorAll('[data-inspector-tab]')) {
			const selected = tab.dataset.inspectorTab === name;
			tab.setAttribute('aria-selected', String(selected));
			tab.tabIndex = selected ? 0 : -1;
		}
		for (const panel of root.querySelectorAll('[data-inspector-panel]')) panel.hidden = panel.dataset.inspectorPanel !== name;
		setInspectorOpen(true);
	}

	function handleInspectorTabKey(event) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		const tabs = [...root.querySelectorAll('[data-inspector-tab]')];
		const current = tabs.indexOf(event.currentTarget);
		const next = event.key === 'Home'
			? 0
			: event.key === 'End'
				? tabs.length - 1
				: (current + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length;
		selectInspectorTab(tabs[next].dataset.inspectorTab);
		tabs[next].focus();
	}

	function setInspectorOpen(open) {
		nodes.inspector.dataset.open = String(open);
		nodes.inspectorToggle?.setAttribute('aria-expanded', String(open));
	}

	function updateExportFields() {
		const format = root.querySelector('[data-export-field="format"]').value;
		nodes.bitDepthField.hidden = format === 'mp3' || format === 'opus';
		nodes.qualityField.hidden = format === 'wav';
		const quality = root.querySelector('[data-export-field="quality"]');
		quality.replaceChildren();
		const bitDepth = root.querySelector('[data-export-field="bitDepth"]');
		for (const option of bitDepth.options) option.disabled = format === 'flac' && option.value === '32f';
		if (format === 'flac' && bitDepth.value === '32f') bitDepth.value = '24';
		const values = format === 'mp3' ? [128, 192, 256, 320] : format === 'opus' ? [96, 128, 160, 192, 256] : format === 'flac' ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [];
		for (const value of values) {
			const option = document.createElement('option');
			option.value = String(value);
			option.textContent = format === 'flac' ? `${locale === 'de' ? 'Stufe' : 'Level'} ${value}` : `${value} kbps`;
			if ((format === 'mp3' && value === 192) || (format === 'opus' && value === 160) || (format === 'flac' && value === 5)) option.selected = true;
			quality.append(option);
		}
	}

	function exportSettings() {
		const value = (name) => root.querySelector(`[data-export-field="${name}"]`)?.value;
		const format = value('format');
		const quality = Number(value('quality'));
		return {
			mode: value('mode'), range: value('range'), format,
			bitDepth: value('bitDepth') === '32f' ? 32 : Number(value('bitDepth')),
			bitRate: format === 'mp3' || format === 'opus' ? quality : undefined,
			compressionLevel: format === 'flac' ? quality : undefined,
			sampleRate: Number(value('sampleRate')),
			includeTail: root.querySelector('[data-export-field="tails"]').checked,
		};
	}

	function toggleExport(active) {
		root.querySelector('[data-export-action="start"]').hidden = active;
		root.querySelector('[data-export-action="cancel"]').hidden = !active;
		nodes.exportProgress.hidden = !active;
		if (!active) nodes.exportProgress.value = 0;
		renderControls();
	}

	function updateExportProgress(progress) {
		nodes.exportProgress.value = Math.max(0, Math.min(1, progress));
	}

	function showAnalysis(result) {
		setAnalysisValue('peak', formatDb(result.peakDbfs, 'dBFS'));
		setAnalysisValue('truePeak', formatDb(result.truePeakDbtp, 'dBTP'));
		setAnalysisValue('rms', formatDb(result.rmsDbfs, 'dBFS'));
		setAnalysisValue('momentary', formatLufs(result.momentaryLufs));
		setAnalysisValue('shortTerm', formatLufs(result.shortTermLufs));
		setAnalysisValue('integrated', formatLufs(result.integratedLufs));
		setAnalysisValue('lra', Number.isFinite(result.loudnessRangeLufs) ? `${result.loudnessRangeLufs.toFixed(1)} LU` : '—');
		setAnalysisValue('correlation', Number.isFinite(result.stereoCorrelation) ? result.stereoCorrelation.toFixed(3) : '—');
		setAnalysisValue('clipping', String(result.clippedSamples));
	}

	function setAnalysisValue(key, value) {
		const node = root.querySelector(`[data-analysis-value="${key}"]`);
		if (node) node.textContent = value;
	}

	function drawAnalysisVisuals(channels, sampleRate) {
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
		drawSpectrum(nodes.analysisSpectrum, spectrum, sampleRate);
		drawSpectrogram(nodes.analysisSpectrogram, overview, sampleRate / step);
	}

	function handleKeyboard(event) {
		if (event.key === 'Escape') {
			closeAllMenus();
			return;
		}
		if (event.target instanceof Element && event.target.closest('[role="menu"]')) return;
		if (event.target !== document.body && event.target !== document.documentElement && !root.contains(event.target)) return;
		if (event.target.matches('input, select, textarea') || event.target.isContentEditable) return;
		const modifier = event.ctrlKey || event.metaKey;
		if (event.code === 'Space') { event.preventDefault(); void handleTransport('play'); }
		else if (event.key.toLowerCase() === 'r' && !modifier) { event.preventDefault(); void handleTransport('record').catch(handleError); }
		else if (event.key.toLowerCase() === 's' && !modifier) { event.preventDefault(); handleEdit('split'); }
		else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); handleEdit('delete'); }
		else if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); handleEdit(event.shiftKey ? 'redo' : 'undo'); }
		else if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); handleEdit('redo'); }
		else if (modifier && event.key.toLowerCase() === 'x') { event.preventDefault(); handleEdit('cut'); }
		else if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); handleEdit('copy'); }
		else if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); handleEdit('paste'); }
		else if (event.key === '+' || event.key === '=') { event.preventDefault(); updateZoom('in'); }
		else if (event.key === '-') { event.preventDefault(); updateZoom('out'); }
		else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
			event.preventDefault();
			const current = Math.max(0, project.tracks.findIndex((track) => track.id === state.selectedTrackId));
			const next = Math.max(0, Math.min(project.tracks.length - 1, current + (event.key === 'ArrowUp' ? -1 : 1)));
			const track = project.tracks[next];
			if (track) {
				state.selectedTrackId = track.id;
				state.selectedClipId = null;
				render();
				nodes.trackList.querySelector(`[data-track-id="${cssEscape(track.id)}"] [data-track-lane]`)?.focus();
			}
		}
	}

	function handleDocumentPointerDown(event) {
		if (!event.target.closest?.('.menu-shell')) closeAllMenus();
	}

	function toggleMenu(menu, toggle) {
		const open = Boolean(menu?.hidden);
		closeAllMenus();
		if (!menu || !open) return;
		menu.hidden = false;
		toggle?.setAttribute('aria-expanded', 'true');
		menu.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
	}

	function closeMenu(menu, toggle) {
		if (menu) menu.hidden = true;
		toggle?.setAttribute('aria-expanded', 'false');
	}

	function closeAllMenus() {
		for (const menu of root.querySelectorAll('.editor-menu')) {
			menu.hidden = true;
			menu.closest('.menu-shell')?.querySelector('[aria-haspopup="menu"]')?.setAttribute('aria-expanded', 'false');
		}
	}

	function handleVisibility() {
		if (document.visibilityState === 'hidden' && state.recorder) void stopRecording();
	}

	function handlePageHide() {
		void (async () => {
			if (state.recorder) await stopRecording().catch(() => undefined);
			await saveNow();
		})();
	}

	function setStatus(message, status = 'info') {
		nodes.status.textContent = message || copy.ready;
		nodes.status.dataset.state = status;
		nodes.live.textContent = message || '';
	}

	function handleError(error) {
		const message = error?.message || String(error) || (locale === 'de' ? 'Unbekannter Fehler' : 'Unknown error');
		setStatus(copy.genericError.replace('{message}', message), 'error');
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
		nodes.storageUsage.textContent = estimate.usage == null ? `${copy.storage}: —` : `${copy.storage}: ${formatBytes(estimate.usage)} / ${formatBytes(estimate.quota)}`;
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
	function framesToPixels(frames) { return frames / AUDIO_EDITOR_SAMPLE_RATE * state.pixelsPerSecond; }
	function pixelsToFrames(pixels) { return Math.round(pixels / state.pixelsPerSecond * AUDIO_EDITOR_SAMPLE_RATE); }
	function frameAtPointer(event, element) {
		const rect = element.getBoundingClientRect();
		return Math.max(0, Math.min(projectDurationFrames(project), pixelsToFrames(event.clientX - rect.left)));
	}
	function setClipField(name, value) { const field = root.querySelector(`[data-clip-field="${name}"]`); if (field) field.value = value; }
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

function formatAudacityTargetHint(target, locale) {
	const start = formatTime(target.startFrame / AUDIO_EDITOR_SAMPLE_RATE);
	const end = formatTime(target.endFrame / AUDIO_EDITOR_SAMPLE_RATE);
	return locale === 'de'
		? `${target.track.name}: ${start} bis ${end}`
		: `${target.track.name}: ${start} to ${end}`;
}

function collectNodes(root) {
	const query = (selector) => root.querySelector(selector);
	return {
		projectName: query('[data-project-name]'), saveState: query('[data-save-state]'), storageUsage: query('[data-storage-usage]'),
		fileMenuToggle: query('[data-file-menu-toggle]'), fileMenuPanel: query('[data-file-menu-panel]'),
		importInput: query('[data-import-input]'), status: query('[data-status]'), live: query('[data-live]'),
		timeline: query('[data-timeline]'), ruler: query('[data-ruler]'), rulerCanvas: query('[data-ruler-canvas]'), trackList: query('[data-track-list]'), emptyState: query('[data-empty-state]'),
		playhead: query('[data-playhead]'), timeDisplay: query('[data-time-display]'), monitor: query('[data-monitor]'), latencyOffset: query('[data-latency-offset]'), monitorWarning: query('[data-monitor-warning]'), inputMeter: query('[data-input-meter]'), inputMeterFill: query('[data-input-meter-fill]'),
		trackTemplate: query('[data-track-template]'), clipTemplate: query('[data-clip-template]'), effectTemplate: query('[data-effect-template]'), projectTemplate: query('[data-project-template]'),
		inspector: query('[data-inspector]'), inspectorToggle: query('[data-inspector-toggle]'), inspectorClose: query('[data-inspector-close]'), noClip: query('[data-no-clip]'),
		effectTarget: query('[data-effect-target]'), effectType: query('[data-effect-type]'), addEffect: query('[data-add-effect]'), effectRack: query('[data-effect-rack]'), effectEmpty: query('[data-effect-empty]'), masterGain: query('[data-master-gain]'), masterGainValue: query('[data-master-gain-value]'),
		audacityEffectType: query('[data-audacity-effect-type]'), audacityEffectParameters: query('[data-audacity-effect-parameters]'), audacityControlField: query('[data-audacity-control-field]'), audacityControlTrack: query('[data-audacity-control-track]'), audacityEffectHint: query('[data-audacity-effect-hint]'), audacityNoiseProfile: query('[data-audacity-noise-profile]'), applyAudacityEffect: query('[data-apply-audacity-effect]'),
		analysisSpectrum: query('[data-analysis-spectrum]'), analysisSpectrogram: query('[data-analysis-spectrogram]'),
		bitDepthField: query('[data-bit-depth-field]'), qualityField: query('[data-quality-field]'), exportProgress: query('[data-export-progress]'), exportDownload: query('[data-export-download]'),
		projectDialog: query('[data-project-dialog]'), projectList: query('[data-project-list]'), projectListEmpty: query('[data-project-list-empty]'),
		nameDialog: query('[data-name-dialog]'), projectNameInput: query('[data-project-name-input]'), confirmDialog: query('[data-confirm-dialog]'),
	};
}

function cloneTemplate(template) {
	return template.content.firstElementChild.cloneNode(true);
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

function drawRuler(canvas, durationSeconds, pixelsPerSecond, viewportWidth, scrollOffset = 0) {
	if (!canvas) return;
	const cssHeight = 38;
	const width = Math.max(1, Math.round(viewportWidth));
	const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
	canvas.style.width = `${width}px`;
	canvas.style.height = `${cssHeight}px`;
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(cssHeight * dpr);
	const context = canvas.getContext('2d');
	if (!context) return;
	context.scale(dpr, dpr);
	context.clearRect(0, 0, width, cssHeight);
	context.fillStyle = 'rgba(255,255,255,.62)';
	context.strokeStyle = 'rgba(255,255,255,.28)';
	context.font = '10px ui-monospace, monospace';
	const candidates = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120, 300, 600];
	const majorStep = candidates.find((step) => step * pixelsPerSecond >= 70) || 600;
	const minorStep = majorStep / 5;
	const firstTick = Math.max(0, Math.floor(scrollOffset / pixelsPerSecond / minorStep) * minorStep);
	const lastTick = Math.min(durationSeconds + minorStep / 2, (scrollOffset + width) / pixelsPerSecond + minorStep);
	for (let seconds = firstTick; seconds <= lastTick; seconds += minorStep) {
		const x = seconds * pixelsPerSecond - scrollOffset;
		const major = Math.abs(seconds / majorStep - Math.round(seconds / majorStep)) < 1e-5;
		context.beginPath();
		context.moveTo(x + 0.5, major ? 12 : 25);
		context.lineTo(x + 0.5, cssHeight);
		context.stroke();
		if (major) context.fillText(formatRulerTime(seconds, majorStep), x + 4, 11);
	}
}

function drawClipWaveform(canvas, clip, buffer, peaks, options = {}) {
	if (!canvas || !buffer) return;
	const fullWidth = Math.max(1, options.fullWidth || Number.parseFloat(canvas.parentElement?.style.width) || 300);
	const visibleStartPx = Math.max(0, options.visibleStartPx || 0);
	const cssWidth = Math.max(1, Math.round(options.visibleWidth || fullWidth));
	const cssHeight = 124;
	const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
	canvas.style.width = `${cssWidth}px`;
	canvas.style.height = '100%';
	canvas.width = Math.round(cssWidth * dpr);
	canvas.height = Math.round(cssHeight * dpr);
	const context = canvas.getContext('2d');
	if (!context) return;
	context.scale(dpr, dpr);
	context.clearRect(0, 0, cssWidth, cssHeight);
	context.strokeStyle = 'rgba(255,255,255,.88)';
	context.lineWidth = 1;
	context.beginPath();
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
	const framesPerPixel = clip.durationFrames / fullWidth;
	const peakLevel = (peaks?.levels || [])
		.filter((level) => level.blockSize <= framesPerPixel)
		.sort((first, second) => first.blockSize - second.blockSize)
		.at(-1);
	for (let x = 0; x < cssWidth; x += 1) {
		const localStart = Math.max(0, Math.floor((visibleStartPx + x) * framesPerPixel));
		const localEnd = Math.min(clip.durationFrames, Math.max(localStart + 1, Math.ceil((visibleStartPx + x + 1) * framesPerPixel)));
		let minimum = 1;
		let maximum = -1;
		if (peakLevel) {
			const sourceStart = clip.sourceStartFrame + (clip.reversed ? clip.durationFrames - localEnd : localStart);
			const sourceEnd = clip.sourceStartFrame + (clip.reversed ? clip.durationFrames - localStart : localEnd);
			const firstBlock = Math.max(0, Math.floor(sourceStart / peakLevel.blockSize));
			const lastBlock = Math.min(peakLevel.minimums.length, Math.ceil(sourceEnd / peakLevel.blockSize));
			for (let block = firstBlock; block < lastBlock; block += 1) {
				minimum = Math.min(minimum, peakLevel.minimums[block]);
				maximum = Math.max(maximum, peakLevel.maximums[block]);
			}
			const center = (localStart + localEnd) / 2;
			let envelope = 1;
			if (clip.fadeInFrames > 0 && center < clip.fadeInFrames) envelope *= center / clip.fadeInFrames;
			if (clip.fadeOutFrames > 0 && center > clip.durationFrames - clip.fadeOutFrames) envelope *= (clip.durationFrames - center) / clip.fadeOutFrames;
			const scale = clip.gain * Math.max(0, envelope);
			minimum *= scale;
			maximum *= scale;
		} else {
			for (let local = localStart; local < localEnd; local += 1) {
				const sourceLocal = clip.reversed ? clip.durationFrames - local - 1 : local;
				const sourceFrame = clip.sourceStartFrame + sourceLocal;
				let sample = 0;
				for (const channel of channels) sample += (channel[sourceFrame] || 0) / channels.length;
				let envelope = 1;
				if (clip.fadeInFrames > 0 && local < clip.fadeInFrames) envelope *= local / clip.fadeInFrames;
				if (clip.fadeOutFrames > 0 && local > clip.durationFrames - clip.fadeOutFrames) envelope *= (clip.durationFrames - local) / clip.fadeOutFrames;
				sample *= clip.gain * Math.max(0, envelope);
				minimum = Math.min(minimum, sample);
				maximum = Math.max(maximum, sample);
			}
		}
		if (maximum < minimum) minimum = maximum = 0;
		context.moveTo(x + 0.5, (1 - maximum) * cssHeight / 2);
		context.lineTo(x + 0.5, (1 - minimum) * cssHeight / 2);
	}
	context.stroke();
}

function drawClipSpectrogram(canvas, clip, buffer, options = {}) {
	if (!canvas || !buffer) return;
	const fullWidth = Math.max(1, options.fullWidth || Number.parseFloat(canvas.parentElement?.style.width) || 300);
	const visibleStartPx = Math.max(0, options.visibleStartPx || 0);
	const visibleWidth = Math.max(1, Math.round(options.visibleWidth || fullWidth));
	const firstLocalFrame = Math.max(0, Math.floor(visibleStartPx / fullWidth * clip.durationFrames));
	const lastLocalFrame = Math.min(clip.durationFrames, Math.ceil((visibleStartPx + visibleWidth) / fullWidth * clip.durationFrames));
	const sourceLength = Math.max(1, lastLocalFrame - firstLocalFrame);
	const stride = Math.max(1, Math.ceil(sourceLength / 65_536));
	const samples = new Float32Array(Math.ceil(sourceLength / stride));
	const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel));
	for (let index = 0; index < samples.length; index += 1) {
		const local = Math.min(lastLocalFrame - 1, firstLocalFrame + index * stride);
		const sourceLocal = clip.reversed ? clip.durationFrames - local - 1 : local;
		const sourceFrame = clip.sourceStartFrame + sourceLocal;
		let sample = 0;
		for (const channel of channels) sample += (channel[sourceFrame] || 0) / channels.length;
		let envelope = 1;
		if (clip.fadeInFrames > 0 && local < clip.fadeInFrames) envelope *= local / clip.fadeInFrames;
		if (clip.fadeOutFrames > 0 && local > clip.durationFrames - clip.fadeOutFrames) envelope *= (clip.durationFrames - local) / clip.fadeOutFrames;
		samples[index] = sample * clip.gain * Math.max(0, envelope);
	}
	canvas.style.width = `${visibleWidth}px`;
	canvas.style.height = '100%';
	drawSpectrogram(canvas, samples, buffer.sampleRate / stride);
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
function drawSpectrum(canvas, samples, sampleRate) {
	if (!canvas || !samples.length) return;
	const { context, width, height } = prepareCanvas(canvas, 360, 120);
	if (!context) return;
	context.fillStyle = '#17120f';
	context.fillRect(0, 0, width, height);
	context.strokeStyle = 'rgba(255,255,255,.12)';
	for (let row = 1; row < 4; row += 1) { context.beginPath(); context.moveTo(0, row * height / 4); context.lineTo(width, row * height / 4); context.stroke(); }
	const size = Math.min(2048, highestPowerOfTwo(samples.length));
	if (size < 32) return;
	const start = Math.max(0, Math.floor((samples.length - size) / 2));
	const bins = Math.min(160, Math.floor(size / 2));
	context.strokeStyle = '#f49a49';
	context.lineWidth = 1.5;
	context.beginPath();
	for (let bin = 0; bin < bins; bin += 1) {
		const frequency = 20 * ((sampleRate / 2) / 20) ** (bin / Math.max(1, bins - 1));
		const omega = 2 * Math.PI * frequency / sampleRate;
		let real = 0;
		let imaginary = 0;
		for (let index = 0; index < size; index += 1) {
			const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1));
			const sample = samples[start + index] * window;
			real += sample * Math.cos(omega * index);
			imaginary -= sample * Math.sin(omega * index);
		}
		const db = Math.max(-100, 20 * Math.log10(Math.hypot(real, imaginary) / Math.max(1, size) + 1e-9));
		const x = bin / (bins - 1) * width;
		const y = (1 - (db + 100) / 100) * height;
		if (bin === 0) context.moveTo(x, y); else context.lineTo(x, y);
	}
	context.stroke();
}

function drawSpectrogram(canvas, samples, sampleRate) {
	if (!canvas || !samples.length) return;
	const { context, width, height } = prepareCanvas(canvas, 360, 120);
	if (!context) return;
	context.fillStyle = '#17120f';
	context.fillRect(0, 0, width, height);
	const columns = Math.min(96, width);
	const bins = Math.min(64, height);
	const windowSize = Math.min(512, highestPowerOfTwo(samples.length));
	if (windowSize < 32) return;
	for (let column = 0; column < columns; column += 1) {
		const start = Math.min(samples.length - windowSize, Math.max(0, Math.round(column / Math.max(1, columns - 1) * (samples.length - windowSize))));
		for (let bin = 0; bin < bins; bin += 1) {
			const frequency = bin / bins * sampleRate / 2;
			const omega = 2 * Math.PI * frequency / sampleRate;
			let real = 0;
			let imaginary = 0;
			for (let index = 0; index < windowSize; index += 1) {
				const sample = samples[start + index] * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (windowSize - 1)));
				real += sample * Math.cos(omega * index);
				imaginary -= sample * Math.sin(omega * index);
			}
			const db = Math.max(-90, 20 * Math.log10(Math.hypot(real, imaginary) / windowSize + 1e-8));
			const amount = Math.max(0, Math.min(1, (db + 90) / 90));
			context.fillStyle = roseus(amount);
			const x0 = Math.floor(column * width / columns);
			const x1 = Math.ceil((column + 1) * width / columns);
			const y0 = Math.floor(height - (bin + 1) * height / bins);
			const y1 = Math.ceil(height - bin * height / bins);
			context.fillRect(x0, y0, x1 - x0, y1 - y0);
		}
	}
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

function parseJson(value, fallback) { try { return JSON.parse(value || '') || fallback; } catch { return fallback; } }
function parseTimeFrames(value) {
	const parts = String(value).trim().split(':').map(Number);
	if (parts.some((part) => !Number.isFinite(part) || part < 0)) throw new Error('Invalid time value.');
	const seconds = parts.reduce((total, part) => total * 60 + part, 0);
	return Math.round(seconds * AUDIO_EDITOR_SAMPLE_RATE);
}
function parseFrameInput(value) {
	const frame = Number(value);
	if (!Number.isSafeInteger(frame) || frame < 0) throw new Error('Invalid frame value.');
	return frame;
}
function formatEditableTime(frames) { return (frames / AUDIO_EDITOR_SAMPLE_RATE).toFixed(3); }
function formatTime(seconds) {
	const safe = Math.max(0, Number(seconds) || 0);
	const hours = Math.floor(safe / 3600);
	const minutes = Math.floor(safe % 3600 / 60);
	const whole = Math.floor(safe % 60);
	const milliseconds = Math.floor((safe % 1) * 1000);
	return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`;
}
function linearToDb(value) { return value > 0 ? 20 * Math.log10(value) : -60; }
function dbToLinear(value) { return Math.max(0, Math.min(16, 10 ** (Math.max(-60, Number(value) || -60) / 20))); }
function panLabel(value, center) { return Math.abs(value) < 0.01 ? center : `${Math.abs(Math.round(value * 100))}${value < 0 ? 'L' : 'R'}`; }
function meterPercent(db) { return Math.max(0, Math.min(100, (Number.isFinite(db) ? db + 60 : 0) / 60 * 100)); }
function formatDb(value, unit) { return Number.isFinite(value) ? `${value.toFixed(1)} ${unit}` : `−∞ ${unit}`; }
function formatLufs(value) { return Number.isFinite(value) ? `${value.toFixed(1)} LUFS` : '—'; }
function formatBytes(value) {
	if (!Number.isFinite(value)) return '—';
	const units = ['B', 'KB', 'MB', 'GB'];
	let size = value;
	let unit = 0;
	while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
	return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
function formatRulerTime(seconds, step) {
	if (step < 1) return `${seconds.toFixed(step < 0.01 ? 3 : 2)}s`;
	const minutes = Math.floor(seconds / 60);
	const remainder = Math.floor(seconds % 60);
	return minutes ? `${minutes}:${String(remainder).padStart(2, '0')}` : `${remainder}s`;
}
function prepareCanvas(canvas, fallbackWidth, fallbackHeight) {
	const width = Math.max(1, Math.round(canvas.clientWidth || fallbackWidth));
	const height = Math.max(1, Math.round(canvas.clientHeight || fallbackHeight));
	const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
	canvas.width = Math.round(width * dpr);
	canvas.height = Math.round(height * dpr);
	const context = canvas.getContext('2d');
	context?.scale(dpr, dpr);
	return { context, width, height };
}
function highestPowerOfTwo(value) {
	if (value < 1) return 0;
	return 2 ** Math.floor(Math.log2(value));
}
function roseus(amount) {
	const stops = [
		[0, 0, 0], [26, 14, 52], [71, 28, 88], [122, 44, 93],
		[174, 67, 82], [220, 105, 66], [246, 167, 89], [252, 235, 166],
	];
	const position = Math.max(0, Math.min(1, amount)) * (stops.length - 1);
	const lower = Math.floor(position);
	const upper = Math.min(stops.length - 1, lower + 1);
	const fraction = position - lower;
	const color = stops[lower].map((value, index) => Math.round(value + (stops[upper][index] - value) * fraction));
	return `rgb(${color.join(' ')})`;
}
function isAup3File(file) { return /\.aup3$/i.test(String(file?.name || '').trim()); }
function formatAup3Warning(warning) {
	if (typeof warning === 'string') return warning.trim();
	if (warning?.message) return String(warning.message).trim();
	if (warning?.code) return String(warning.code).trim();
	return '';
}
function stripExtension(name) { return String(name || '').replace(/\.[^.]+$/, ''); }
function effectLabel(type, copy) { return ({ highpass: copy.highPass, lowpass: copy.lowPass, eq: copy.parametricEq, compressor: copy.compressor, limiter: copy.limiter, gate: copy.gate, reverb: copy.reverb, delay: copy.delay })[type] || type; }
function setPath(target, path, value) { let current = target; for (let index = 0; index < path.length - 1; index += 1) current = current[path[index]]; current[path.at(-1)] = value; }
function cssEscape(value) { return globalThis.CSS?.escape ? CSS.escape(value) : String(value).replace(/[^a-z0-9_-]/gi, '\\$&'); }
function abortError() { return typeof DOMException === 'function' ? new DOMException('Aborted', 'AbortError') : Object.assign(new Error('Aborted'), { name: 'AbortError' }); }
function throwIfAborted(signal) { if (signal?.aborted) throw abortError(); }
