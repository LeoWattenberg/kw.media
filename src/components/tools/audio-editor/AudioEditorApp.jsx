import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	DialogHeader,
	MasterMeter,
	NumberStepper,
	SelectionToolbar,
	TimeCode,
	TextInput,
	ToggleToolButton,
	Toolbar,
	ToolbarButtonGroup,
	ToolbarDivider,
	TrackMeter,
	TransportButton,
	ToolButton,
} from '@dilsonspickles/components';
import '@dilsonspickles/components/style.css';

import { createAudioEditorController } from '../../../lib/tools/audio-editor/app.js';
import { framesToSeconds, secondsToFrames } from '../../../lib/tools/audio-editor/design-system-adapters.js';
import { AUDIO_EDITOR_SAMPLE_RATE, projectDurationFrames } from '../../../lib/tools/audio-editor/project.js';
import {
	AnalysisDialog,
	AudioEditorEffectsOverlay,
	ClipPropertiesDialog,
	ExportDialog,
	SelectionEffectsDialog,
} from './AudioEditorInspector.jsx';
import AudioEditorMenuBar from './AudioEditorMenuBar.jsx';
import AudioEditorTimeline from './AudioEditorTimeline.jsx';
import {
	DesignSystemProviders,
	useAudioEditorSnapshot,
	useAudioEditorTelemetry,
} from './DesignSystemRuntime.jsx';
import './audio-editor-design-system.css';

export default function AudioEditorApp(props) {
	return (
		<AudioEditorErrorBoundary copy={props.copy}>
			<DesignSystemProviders>
				<AudioEditorWorkspace {...props} />
			</DesignSystemProviders>
		</AudioEditorErrorBoundary>
	);
}

class AudioEditorErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	render() {
		if (!this.state.error) return this.props.children;
		const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
		return (
			<div id="kw-audio-editor-design-system" className="kw-audio-editor-error" role="alert" data-audio-editor-bound="false">
				<strong>{this.props.copy.title}</strong>
				<p>{this.props.copy.genericError.replace('{message}', message)}</p>
			</div>
		);
	}
}

function AudioEditorWorkspace({ locale, copy }) {
	const controller = useMemo(() => createAudioEditorController(null, {
		headless: true,
		locale,
		copy,
	}), [copy, locale]);
	const snapshot = useAudioEditorSnapshot(controller);
	const [activeSurface, setActiveSurface] = useState(null);
	const [effectsOverlay, setEffectsOverlay] = useState(null);
	const [dialog, setDialog] = useState(null);
	const [dialogValue, setDialogValue] = useState('');
	const [localError, setLocalError] = useState('');
	const [isFullscreen, setIsFullscreen] = useState(false);
	const [showArmControls, setShowArmControls] = useState(false);
	const importInputRef = useRef(null);
	const workspaceRef = useRef(null);
	const isCompact = useMediaQuery('(max-width: 900px)');
	const project = snapshot.project;
	const blocked = Boolean(
		snapshot.importing
		|| snapshot.recordingStarting
		|| snapshot.recording
		|| snapshot.exporting
		|| snapshot.processingEffect,
	);
	const editBlocked = blocked || snapshot.readOnly;
	const selectionActive = Boolean(snapshot.selection);
	const selectedClip = project?.clips.find((clip) => clip.id === snapshot.selectedClipId) || null;

	useEffect(() => () => { void controller.dispose(); }, [controller]);

	const onError = useCallback((error) => {
		const message = error instanceof Error ? error.message : String(error || 'Unknown error');
		setLocalError(copy.genericError.replace('{message}', message));
	}, [copy.genericError]);

	const run = useCallback((action) => {
		setLocalError('');
		try {
			const value = action();
			if (value && typeof value.catch === 'function') value.catch(onError);
			return value;
		} catch (error) {
			onError(error);
			return undefined;
		}
	}, [onError]);

	const toggleFullscreen = useCallback(() => {
		setIsFullscreen((current) => !current);
	}, []);

	const toggleRecording = useCallback(() => {
		if (snapshot.recording) return run(() => controller.actions.recording.stop());
		const trackId = showArmControls ? undefined : snapshot.selectedTrackId || project?.tracks[0]?.id;
		return run(() => controller.actions.recording.start({ trackId }));
	}, [controller, project?.tracks, run, showArmControls, snapshot.recording, snapshot.selectedTrackId]);

	const openProjects = useCallback(() => {
		setDialog('projects');
		run(() => controller.actions.project.list());
	}, [controller, run]);

	const openSurface = useCallback((surface) => {
		setEffectsOverlay(null);
		setActiveSurface(surface);
	}, []);

	const openEffects = useCallback((trackId, anchorRect = null) => {
		if (!trackId) return;
		setActiveSurface(null);
		setEffectsOverlay((current) => {
			if (current?.trackId === trackId) {
				requestAnimationFrame(() => current.returnFocus?.focus?.({ preventScroll: true }));
				return null;
			}
			return {
				trackId,
				anchorRect,
				returnFocus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
			};
		});
	}, []);

	const closeEffects = useCallback(() => {
		setEffectsOverlay((current) => {
			requestAnimationFrame(() => current?.returnFocus?.focus?.({ preventScroll: true }));
			return null;
		});
	}, []);

	useEffect(() => {
		if (!effectsOverlay) return undefined;
		const onKeyDown = (event) => {
			if (event.key !== 'Escape') return;
			if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="listbox"], [role="menu"]')) return;
			event.preventDefault();
			closeEffects();
		};
		document.addEventListener('keydown', onKeyDown, true);
		return () => document.removeEventListener('keydown', onKeyDown, true);
	}, [closeEffects, effectsOverlay]);

	const durationFrames = project ? projectDurationFrames(project) : 0;
	const statusMessage = localError || snapshot.status?.message || copy.ready;
	const statusState = localError ? 'error' : snapshot.status?.state || 'info';
	const saveText = snapshot.save?.state === 'saving'
		? copy.projectSaving
		: snapshot.save?.state === 'dirty'
			? copy.projectDirty
			: copy.projectSaved;
	const recordLabel = showArmControls ? copy.record : copy.recordActiveTrack;

	const editItems = [
		{ action: 'undo', label: copy.undo, icon: 'undo', disabled: editBlocked || !snapshot.history?.canUndo },
		{ action: 'redo', label: copy.redo, icon: 'redo', disabled: editBlocked || !snapshot.history?.canRedo },
		{ action: 'cut', label: copy.cut, icon: 'cut', disabled: editBlocked || !selectionActive },
		{ action: 'copy', label: copy.copy, icon: 'copy', disabled: editBlocked || !selectionActive },
		{ action: 'paste', label: copy.paste, icon: 'paste', disabled: editBlocked || !snapshot.history?.hasClipboard },
		{ action: 'split', label: copy.split, icon: 'split', disabled: editBlocked || !selectedClip },
		{ action: 'delete', label: copy.liftDelete, icon: 'trash', disabled: editBlocked || (!selectionActive && !selectedClip) },
		{ action: 'rippleDelete', label: copy.rippleDelete, icon: 'trim', disabled: editBlocked || !selectionActive },
	];

	const executeEdit = (action) => run(() => controller.actions.edit[action]());
	const openSelectionEffect = useCallback((type = null) => {
		if (type) run(() => controller.actions.effects.setSelectionType(type));
		openSurface('selection-effect');
	}, [controller, openSurface, run]);
	const applicationMenus = createApplicationMenus({
		copy,
		project,
		snapshot,
		blocked,
		editBlocked,
		showArmControls,
		recordLabel,
		selectionActive,
		selectedClip,
		durationFrames,
		effectsOverlay,
		actions: {
			newProject: () => run(() => controller.actions.project.create()),
			openProjects,
			saveProject: () => run(() => controller.actions.project.save()),
			importAudio: () => importInputRef.current?.click(),
			exportAudio: () => openSurface('export'),
			renameProject: () => { setDialogValue(project?.title || ''); setDialog('rename'); },
			duplicateProject: () => run(() => controller.actions.project.duplicate()),
			deleteProject: () => setDialog('delete'),
			clearData: () => setDialog('clear'),
			executeEdit,
			openClipProperties: () => openSurface('clip'),
			selectAll: () => run(() => controller.actions.timeline.setSelection(0, durationFrames)),
			selectNone: () => run(() => controller.actions.timeline.clearSelection()),
			setTimelineView: (view) => run(() => controller.actions.timeline.setView(view)),
			zoomIn: () => run(() => controller.actions.timeline.zoomIn()),
			zoomOut: () => run(() => controller.actions.timeline.zoomOut()),
			zoomFit: () => run(() => controller.actions.timeline.zoomFit()),
			fullscreen: () => run(toggleFullscreen),
			record: toggleRecording,
			toggleArmControls: () => setShowArmControls((current) => !current),
			stop: () => run(() => controller.actions.transport.stop()),
			playPause: () => run(() => controller.actions.transport.playPause()),
			toggleMonitoring: () => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled)),
			openRecordingOffset: () => {
				setDialogValue(String(snapshot.monitor?.latencyOffsetMs ?? 0));
				setDialog('recording-offset');
			},
			addTrack: () => run(() => controller.actions.track.add()),
			duplicateTrack: () => snapshot.selectedTrackId && run(() => controller.actions.track.duplicate(snapshot.selectedTrackId)),
			removeTrack: () => snapshot.selectedTrackId && run(() => controller.actions.track.remove(snapshot.selectedTrackId)),
			toggleTrackMute: () => {
				const track = project?.tracks.find((candidate) => candidate.id === snapshot.selectedTrackId);
				if (track) run(() => controller.actions.track.update(track.id, { mute: !track.mute }));
			},
			openEffects: () => openEffects(snapshot.selectedTrackId),
			openSelectionEffect,
			openAnalysis: () => openSurface('analysis'),
			quickHelp: () => workspaceRef.current?.querySelector('.kw-audio-editor__keyboard-help')?.focus?.(),
		},
	});
	const effectsPosition = effectsOverlay
		? resolveEffectsOverlayPosition(workspaceRef.current, effectsOverlay.anchorRect, isCompact)
		: null;

	return (
		<div
			id="kw-audio-editor-design-system"
			className={`kw-audio-editor ${isCompact ? 'kw-audio-editor--compact' : ''}${isFullscreen ? ' kw-audio-editor--viewport-fullscreen' : ''}`}
			data-audio-editor
			data-audio-editor-bound="true"
			data-project-id={project?.id || ''}
			data-track-count={project?.tracks.length || 0}
			data-clip-count={project?.clips.length || 0}
			data-timeline-view={snapshot.timeline?.view || 'waveform'}
			onKeyDown={(event) => handleWorkspaceKeyboard(event, controller, snapshot, run, {
				openProjects,
				openExport: () => openSurface('export'),
				importAudio: () => importInputRef.current?.click(),
				fullscreen: () => run(toggleFullscreen),
				toggleRecording,
				quickHelp: () => workspaceRef.current?.querySelector('.kw-audio-editor__keyboard-help')?.focus?.(),
			})}
		>
			<AudioEditorMenuBar
				appName={copy.title}
				copy={copy}
				menus={applicationMenus}
				projectName={project?.title || copy.untitledProject}
				saveState={snapshot.save?.state || 'saved'}
				saveText={saveText}
				onFullscreen={() => run(toggleFullscreen)}
			/>

			<input
				ref={importInputRef}
				className="kw-audio-editor__file-input"
				data-import-input
				aria-label={copy.importAudio}
				type="file"
				tabIndex={-1}
				accept="audio/*,.aif,.aiff,.aup3,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.webm"
				multiple
				onChange={(event) => {
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					if (files.length) run(() => controller.actions.project.importFiles(files));
				}}
			/>

			<div className="kw-audio-editor__toolbars">
				<EditorToolToolbar
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					isCompact={isCompact}
					blocked={blocked}
					selectionActive={selectionActive}
					durationFrames={durationFrames}
					editItems={editItems}
					executeEdit={executeEdit}
					recordLabel={recordLabel}
					toggleRecording={toggleRecording}
					run={run}
				/>
			</div>

			{snapshot.monitor?.enabled && (
				<div className="kw-audio-editor__monitor-warning" role="alert">{copy.monitorWarning}</div>
			)}

			<div ref={workspaceRef} className="kw-audio-editor__workspace">
				<main className="kw-audio-editor__canvas">
					<AudioEditorTimeline
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						mobile={isCompact}
						showArmControls={showArmControls}
						onError={onError}
						onOpenEffects={openEffects}
						onOpenClipProperties={() => openSurface('clip')}
						onToggleArmControls={() => setShowArmControls((current) => !current)}
					/>
					<p className="kw-audio-editor__keyboard-help" tabIndex={-1}>{copy.keyboardHelp}</p>
				</main>

				{effectsOverlay && effectsPosition && (
					<div
						className="kw-audio-editor__effects-surface"
						data-effects-overlay
						style={{
							'--effects-left': `${effectsPosition.left}px`,
							'--effects-top': `${effectsPosition.top}px`,
							'--effects-width': `${effectsPosition.width}px`,
							'--effects-panel-height': `${effectsPosition.panelHeight}px`,
						}}
					>
						<AudioEditorEffectsOverlay
							isOpen
							controller={controller}
							snapshot={snapshot}
							copy={copy}
							locale={locale}
							onClose={closeEffects}
							position={{
								left: effectsPosition.left,
								top: effectsPosition.top,
								width: effectsPosition.width,
								height: effectsPosition.panelHeight,
							}}
						/>
					</div>
				)}
			</div>

			<AccessibleSelectionToolbar
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				statusMessage={statusMessage}
				statusState={statusState}
				durationFrames={durationFrames}
				disabled={editBlocked}
				run={run}
			/>

			{activeSurface === 'clip' && (
				<div data-editor-surface="clip">
					<ClipPropertiesDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{activeSurface === 'selection-effect' && (
				<div data-editor-surface="selection-effect">
					<SelectionEffectsDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{activeSurface === 'analysis' && (
				<div data-editor-surface="analysis">
					<AnalysisDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}
			{activeSurface === 'export' && (
				<div data-editor-surface="export">
					<ExportDialog
						isOpen
						controller={controller}
						snapshot={snapshot}
						copy={copy}
						locale={locale}
						onClose={() => setActiveSurface(null)}
					/>
				</div>
			)}

			{dialog && (
				<EditorDialog
					type={dialog}
					value={dialogValue}
					onValueChange={setDialogValue}
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					locale={locale}
					run={run}
					onClose={() => setDialog(null)}
				/>
			)}
		</div>
	);
}

function EditorToolToolbar({
	controller,
	snapshot,
	copy,
	isCompact,
	blocked,
	selectionActive,
	durationFrames,
	editItems,
	executeEdit,
	recordLabel,
	toggleRecording,
	run,
}) {
	const telemetry = useAudioEditorTelemetry(controller);
	const project = snapshot.project;
	const masterMeter = telemetry.meters?.master;
	const inputMeterDb = telemetry.inputMeterDb ?? -60;
	return (
		<div
			data-editor-tool-toolbar
			onKeyDownCapture={handleEditorToolbarKeyDown}
			onFocusCapture={handleEditorToolbarFocus}
			onBlurCapture={handleEditorToolbarBlur}
		>
			<Toolbar
				height={48}
				className="kw-audio-editor__tool-toolbar"
				enableTabGroup
				tabGroupId="tool-toolbar"
				showGripper
			>
				<ToolbarButtonGroup className="kw-audio-editor__transport" gap={2}>
					<TransportButton
						icon={telemetry.transportState === 'playing' ? 'pause' : 'play'}
						ariaLabel={telemetry.transportState === 'playing' ? copy.pause : copy.play}
						disabled={blocked && !snapshot.recording}
						active={telemetry.transportState === 'playing'}
						onClick={() => run(() => controller.actions.transport.playPause())}
					/>
					<TransportButton icon="stop" ariaLabel={copy.stop} onClick={() => run(() => controller.actions.transport.stop())} />
					<span data-transport="record">
						<AccessibleTransportButton
							icon="record"
							ariaLabel={recordLabel}
							recording={snapshot.recording}
							pressed={Boolean(snapshot.recording)}
							disabled={snapshot.readOnly || snapshot.importing || snapshot.exporting}
							onClick={toggleRecording}
						/>
					</span>
					<TransportButton icon="skip-back" ariaLabel={copy.jumpStart} disabled={blocked} onClick={() => run(() => controller.actions.transport.jumpStart())} />
					<TransportButton icon="skip-forward" ariaLabel={copy.jumpEnd} disabled={blocked} onClick={() => run(() => controller.actions.transport.jumpEnd())} />
					<AccessibleTransportButton
						icon="loop"
						ariaLabel={copy.loop}
						active={Boolean(project?.loop?.enabled)}
						pressed={Boolean(project?.loop?.enabled)}
						disabled={!selectionActive}
						onClick={() => run(() => controller.actions.transport.toggleLoop())}
					/>
				</ToolbarButtonGroup>

				<ToolbarDivider />
				<ToolbarButtonGroup className="kw-audio-editor__view-actions" gap={2}>
					<ToggleToolButton icon="waveform" isActive={snapshot.timeline?.view === 'waveform'} ariaLabel={copy.waveformView} onClick={() => run(() => controller.actions.timeline.setView('waveform'))} />
					<ToggleToolButton icon="spectrogram" isActive={snapshot.timeline?.view === 'spectrogram'} ariaLabel={copy.spectrogramView} onClick={() => run(() => controller.actions.timeline.setView('spectrogram'))} />
				</ToolbarButtonGroup>

				<ToolbarButtonGroup className="kw-audio-editor__zoom-actions" gap={2}>
					<ToolButton icon="zoom-in" ariaLabel={copy.zoomIn} onClick={() => run(() => controller.actions.timeline.zoomIn())} />
					<ToolButton icon="zoom-out" ariaLabel={copy.zoomOut} onClick={() => run(() => controller.actions.timeline.zoomOut())} />
					<ToolButton icon="zoom-to-fit" ariaLabel={copy.zoomFit} onClick={() => run(() => controller.actions.timeline.zoomFit())} />
				</ToolbarButtonGroup>

				<ToolbarButtonGroup className="kw-audio-editor__edit-actions" gap={2}>
					{editItems.map((item) => (
						<span key={item.action} data-edit={item.action === 'rippleDelete' ? 'ripple-delete' : item.action}>
							<ToolButton icon={item.icon} ariaLabel={item.label} disabled={item.disabled} onClick={() => executeEdit(item.action)} />
						</span>
					))}
				</ToolbarButtonGroup>

				<div className="kw-audio-editor__timecode" data-time-display>
					<AccessibleTimeCode
						ariaLabel={`${copy.playhead}: ${copy.format}`}
						value={framesToSeconds(telemetry.positionFrame || 0)}
						sampleRate={AUDIO_EDITOR_SAMPLE_RATE}
						showFormatSelector={!isCompact}
						disabled={snapshot.recording}
						onChange={(seconds) => run(() => controller.actions.transport.seek(secondsToFrames(seconds, { maximumFrame: durationFrames })))}
					/>
				</div>

				<ToolbarButtonGroup className="kw-audio-editor__recording-meter" gap={4}>
					<span data-monitor-input>
						<ToggleToolButton
							icon="microphone"
							isActive={Boolean(snapshot.monitor?.enabled)}
							ariaLabel={copy.monitor}
							disabled={snapshot.recordingStarting}
							onClick={() => run(() => controller.actions.recording.setMonitoring(!snapshot.monitor?.enabled))}
						/>
					</span>
					<div
						className="kw-audio-editor__input-meter"
						data-input-meter
						role="meter"
						aria-label={copy.inputLevel}
						aria-valuemin={-60}
						aria-valuemax={0}
						aria-valuenow={inputMeterDb}
					>
						<TrackMeter volume={meterPercent(inputMeterDb)} clipped={inputMeterDb >= 0} variant="stereo" />
					</div>
				</ToolbarButtonGroup>

				<ToolbarButtonGroup className="kw-audio-editor__playback-meter" gap={6}>
					<ToolButton
						icon="volume"
						ariaLabel={copy.playbackVolume}
						onClick={(event) => {
							const group = event.currentTarget.closest('.kw-audio-editor__playback-meter');
							group?.querySelector('[role="slider"], input')?.focus?.();
						}}
					/>
					<div className="kw-audio-editor__master-meter" aria-label={copy.metering}>
						<MasterMeter
							levelLeft={masterMeter?.dbfs ?? -60}
							levelRight={masterMeter?.dbfs ?? -60}
							clippedLeft={(masterMeter?.peak || 0) >= 1}
							clippedRight={(masterMeter?.peak || 0) >= 1}
							volume={Math.min(1, project?.master?.gain ?? 1)}
							onVolumeChange={(gain) => run(() => controller.actions.effects.setMasterGain(gain))}
							defaultWidth={isCompact ? 165 : 280}
							minWidth={120}
							resizable={!isCompact}
					/>
					</div>
				</ToolbarButtonGroup>
			</Toolbar>
		</div>
	);
}

function AccessibleTimeCode({ ariaLabel, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('.timecode__format-button')?.setAttribute('aria-label', ariaLabel);
	}, [ariaLabel]);
	return <span ref={wrapperRef}><TimeCode {...props} /></span>;
}

function AccessibleTransportButton({ pressed, ...props }) {
	const wrapperRef = useRef(null);
	useEffect(() => {
		wrapperRef.current?.querySelector('button')?.setAttribute('aria-pressed', String(Boolean(pressed)));
	}, [pressed]);
	return <span ref={wrapperRef} className="kw-audio-editor__transport-state"><TransportButton {...props} /></span>;
}

function AccessibleSelectionToolbar({
	controller,
	snapshot,
	copy,
	statusMessage,
	statusState,
	durationFrames,
	disabled,
	run,
}) {
	const wrapperRef = useRef(null);
	const [format, setFormat] = useState('hh:mm:ss+milliseconds');
	const [durationFormat, setDurationFormat] = useState('hh:mm:ss+milliseconds');
	const selection = snapshot.selection;
	const canEdit = Boolean(selection && !disabled);
	const selectionStart = selection ? framesToSeconds(selection.startFrame) : null;
	const selectionEnd = selection ? framesToSeconds(selection.endFrame) : null;

	useEffect(() => {
		const root = wrapperRef.current;
		if (!root) return;
		const toolbar = root.querySelector('.selection-toolbar');
		if (toolbar) {
			toolbar.setAttribute('role', 'toolbar');
			toolbar.setAttribute('aria-label', 'Selection toolbar');
		}
		const status = root.querySelector('.selection-toolbar__status-text');
		if (status) {
			status.setAttribute('data-status', '');
			status.setAttribute('data-editor-status', '');
			status.setAttribute('data-state', statusState);
			status.setAttribute('role', 'status');
			status.setAttribute('aria-live', 'polite');
		}
		const timecodes = [...root.querySelectorAll('.selection-toolbar__timecodes .timecode')];
		const timecodeLabels = [
			copy.selectionStart || `${copy.selection}: ${copy.clipStart}`,
			copy.selectionEnd || `${copy.selection}: ${copy.clipStart} + ${copy.clipDuration}`,
			copy.selectionDuration || copy.clipDuration,
		];
		timecodes.forEach((timecode, index) => {
			timecode.setAttribute('aria-label', timecodeLabels[index] || copy.selection);
			timecode.setAttribute('aria-disabled', String(!canEdit && index < 2));
			timecode.querySelector('.timecode__format-button')?.setAttribute(
				'aria-label',
				`${timecodeLabels[index] || copy.selection}: ${copy.format}`,
			);
		});
	}, [canEdit, copy, format, durationFormat, statusMessage, statusState]);

	const updateStart = (seconds) => {
		if (!canEdit) return;
		const startFrame = secondsToFrames(seconds, { maximumFrame: selection.endFrame });
		run(() => controller.actions.timeline.setSelection(startFrame, selection.endFrame));
	};
	const updateEnd = (seconds) => {
		if (!canEdit) return;
		const endFrame = secondsToFrames(seconds, {
			minimumFrame: selection.startFrame,
			maximumFrame: Math.max(selection.startFrame, durationFrames),
		});
		run(() => controller.actions.timeline.setSelection(selection.startFrame, endFrame));
	};

	return (
		<div
			ref={wrapperRef}
			className="kw-audio-editor__selection-surface"
			data-selection-toolbar
			aria-disabled={disabled ? 'true' : 'false'}
		>
			<SelectionToolbar
				selectionStart={selectionStart}
				selectionEnd={selectionEnd}
				status={statusMessage}
				instructionText={copy.timelineHint}
				format={format}
				durationFormat={durationFormat}
				sampleRate={AUDIO_EDITOR_SAMPLE_RATE}
				onFormatChange={setFormat}
				onDurationFormatChange={setDurationFormat}
				onSelectionStartChange={updateStart}
				onSelectionEndChange={updateEnd}
				showDuration
			/>
		</div>
	);
}

function EditorDialog({ type, value, onValueChange, controller, snapshot, copy, locale, run, onClose }) {
	const panelRef = useRef(null);
	useEffect(() => {
		const previouslyFocused = document.activeElement;
		const panel = panelRef.current;
		const focusableSelector = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
		const focusInitial = () => {
			const initial = type === 'rename' ? panel?.querySelector('input') : panel?.querySelector(focusableSelector);
			(initial || panel)?.focus();
		};
		focusInitial();
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== 'Tab' || !panel) return;
			const focusable = [...panel.querySelectorAll(focusableSelector)];
			if (!focusable.length) {
				event.preventDefault();
				panel.focus();
				return;
			}
			const first = focusable[0];
			const last = focusable.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		};
		document.addEventListener('keydown', onKeyDown);
		return () => {
			document.removeEventListener('keydown', onKeyDown);
			if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
		};
	}, [type]);

	const title = type === 'projects'
		? copy.projectsTitle
		: type === 'rename'
			? copy.renameProject
			: type === 'recording-offset'
				? copy.recordingOffset
			: type === 'clear'
				? copy.clearData
				: copy.deleteTitle;
	return (
		<div className="kw-audio-editor-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section ref={panelRef} tabIndex={-1} className="kw-audio-editor-dialog" role="dialog" aria-modal="true" aria-label={title}>
				<DialogHeader title={title} os="windows" onClose={onClose} />
				<div className="kw-audio-editor-dialog__body">
					{type === 'projects' && (
						<>
							<p>{copy.projectsDescription}</p>
							<ul className="kw-audio-editor-project-list" data-project-list>
								{snapshot.projects?.map((project) => (
									<li key={project.id}>
										<Button variant="secondary" onClick={() => { run(() => controller.actions.project.openById(project.id)); onClose(); }}>
											<span>{project.title}</span>
											<small>{copy.lastEdited}: {formatDate(project.updatedAt, locale)}</small>
										</Button>
									</li>
								))}
							</ul>
							{!snapshot.projects?.length && <p data-project-list-empty>{copy.noProjects}</p>}
						</>
					)}
					{type === 'rename' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							if (!value.trim()) return;
							run(() => controller.actions.project.rename(value));
							onClose();
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.projectName}</span>
								<span data-project-name-input>
									<TextInput value={value} onChange={onValueChange} width="100%" />
								</span>
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit" disabled={!value.trim()}>{copy.saveName}</Button>
							</div>
						</form>
					)}
					{type === 'recording-offset' && (
						<form onSubmit={(event) => {
							event.preventDefault();
							run(() => controller.actions.recording.setLatencyOffset(value));
							onClose();
						}}>
							<label className="kw-audio-editor-dialog__field">
								<span>{copy.latencyOffset}</span>
								<NumberStepper
									value={String(value)}
									min={-500}
									max={500}
									step={1}
									width="100%"
									onChange={onValueChange}
								/>
							</label>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button type="submit">{copy.save}</Button>
							</div>
						</form>
					)}
					{(type === 'delete' || type === 'clear') && (
						<>
							<p>{type === 'delete' ? copy.deleteDescription : copy.clearData}</p>
							<div className="kw-audio-editor-dialog__actions">
								<Button variant="secondary" onClick={onClose}>{copy.cancel}</Button>
								<Button onClick={() => {
									run(() => type === 'delete' ? controller.actions.project.remove() : controller.actions.project.clear());
									onClose();
								}}>{type === 'delete' ? copy.confirmDelete : copy.clearData}</Button>
							</div>
						</>
					)}
				</div>
			</section>
		</div>
	);
}

const EFFECT_MENU_GROUPS = Object.freeze([
	['volumeCompression', ['audacity-amplify', 'audacity-auto-duck', 'audacity-compressor', 'audacity-legacy-compressor', 'audacity-limiter', 'audacity-loudness-normalization', 'audacity-normalize']],
	['fading', ['audacity-fade-in', 'audacity-fade-out']],
	['eqFilters', ['audacity-bass-treble', 'audacity-filter-curve-eq', 'audacity-graphic-eq', 'audacity-classic-filters']],
	['noiseRepair', ['audacity-click-removal', 'audacity-noise-reduction', 'audacity-repair']],
	['delayReverb', ['audacity-echo']],
	['distortionModulation', ['audacity-distortion', 'audacity-phaser', 'audacity-wahwah']],
	['specialEffects', ['audacity-invert', 'audacity-paulstretch', 'audacity-repeat', 'audacity-reverse', 'audacity-truncate-silence']],
]);

function createApplicationMenus({
	copy,
	project,
	snapshot,
	blocked,
	editBlocked,
	showArmControls,
	recordLabel,
	selectionActive,
	selectedClip,
	durationFrames,
	effectsOverlay,
	actions,
}) {
	const divider = () => ({ divider: true });
	const unavailable = (id, label) => ({ id, label, disabled: true });
	const selectedTrack = project?.tracks.find((track) => track.id === snapshot.selectedTrackId) || null;
	const effectLabels = new Map((snapshot.effects?.selectionTypes || []).map(({ type, label }) => [type, label]));
	const effectGroups = EFFECT_MENU_GROUPS.map(([labelKey, types]) => ({
		id: labelKey,
		label: copy[labelKey],
		items: types.filter((type) => effectLabels.has(type)).map((type) => ({
			id: type,
			label: effectLabels.get(type),
			disabled: editBlocked || !snapshot.selectedTrackId,
			onClick: () => actions.openSelectionEffect(type),
		})),
	})).filter((group) => group.items.length);

	return [
		{
			id: 'file',
			label: copy.fileMenu,
			items: [
				{ id: 'new-project', label: copy.newProject, shortcut: 'Ctrl+N', disabled: blocked, onClick: actions.newProject },
				{ id: 'open-project', label: copy.openProject, shortcut: 'Ctrl+O', disabled: blocked, onClick: actions.openProjects },
				{ id: 'recent-projects', label: copy.recentProjects, disabled: blocked, onClick: actions.openProjects },
				divider(),
				{ id: 'save-project', label: copy.saveProject, shortcut: 'Ctrl+S', disabled: snapshot.readOnly || blocked, onClick: actions.saveProject },
				unavailable('backup-project', copy.backupProject),
				divider(),
				{ id: 'import-audio', label: copy.importAudio, shortcut: 'Ctrl+I', disabled: blocked, onClick: actions.importAudio },
				{ id: 'export-audio', label: copy.exportAudio, shortcut: 'Ctrl+Shift+E', disabled: blocked, onClick: actions.exportAudio },
				unavailable('export-multiple', copy.exportMultiple),
				divider(),
				{ id: 'rename-project', label: copy.renameProject, disabled: editBlocked, onClick: actions.renameProject },
				{ id: 'duplicate-project', label: copy.duplicateProject, disabled: blocked, onClick: actions.duplicateProject },
				{ id: 'delete-project', label: copy.deleteProject, disabled: editBlocked, onClick: actions.deleteProject },
				{ id: 'clear-data', label: copy.clearData, disabled: blocked, onClick: actions.clearData },
			],
		},
		{
			id: 'edit',
			label: copy.editMenu,
			items: [
				{ id: 'undo', label: copy.undo, shortcut: 'Ctrl+Z', disabled: editBlocked || !snapshot.history?.canUndo, onClick: () => actions.executeEdit('undo') },
				{ id: 'redo', label: copy.redo, shortcut: 'Ctrl+Shift+Z', disabled: editBlocked || !snapshot.history?.canRedo, onClick: () => actions.executeEdit('redo') },
				divider(),
				{ id: 'cut', label: copy.cut, shortcut: 'Ctrl+X', disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('cut') },
				{ id: 'delete', label: copy.liftDelete, shortcut: 'Delete', disabled: editBlocked || (!selectionActive && !selectedClip), onClick: () => actions.executeEdit('delete') },
				{ id: 'copy', label: copy.copy, shortcut: 'Ctrl+C', disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('copy') },
				{ id: 'paste', label: copy.paste, shortcut: 'Ctrl+V', disabled: editBlocked || !snapshot.history?.hasClipboard, onClick: () => actions.executeEdit('paste') },
				unavailable('duplicate-audio', copy.duplicateAudio),
				{
					id: 'remove-special',
					label: copy.removeSpecial,
					items: [
						{ id: 'ripple-delete', label: copy.rippleDelete, disabled: editBlocked || !selectionActive, onClick: () => actions.executeEdit('rippleDelete') },
						unavailable('split-delete', copy.splitDelete),
						unavailable('silence-audio', copy.silenceAudio),
					],
				},
				{
					id: 'clip-boundaries',
					label: copy.clipBoundaries,
					items: [
						{ id: 'split', label: copy.split, shortcut: 'S', disabled: editBlocked || !selectedClip, onClick: () => actions.executeEdit('split') },
						{ id: 'clip-properties', label: copy.clipPropertiesCommand, disabled: !selectedClip, onClick: actions.openClipProperties },
					],
				},
				divider(),
				unavailable('labels', copy.editLabels),
				unavailable('metadata', copy.metadata),
				unavailable('preferences', copy.preferences),
			],
		},
		{
			id: 'select',
			label: copy.selectMenu,
			items: [
				{ id: 'select-all', label: copy.selectAll, shortcut: 'Ctrl+A', disabled: editBlocked || durationFrames <= 0, onClick: actions.selectAll },
				{ id: 'select-none', label: copy.selectNone, shortcut: 'Ctrl+Shift+A', disabled: !selectionActive, onClick: actions.selectNone },
				divider(),
				{ id: 'select-tracks', label: copy.selectTracks, items: [unavailable('select-all-tracks', copy.allTracks), unavailable('select-no-tracks', copy.noTracks)] },
				{
					id: 'select-region',
					label: copy.selectRegion,
					items: [
						unavailable('left-at-playback', copy.leftAtPlayback),
						unavailable('right-at-playback', copy.rightAtPlayback),
						unavailable('track-start-cursor', copy.trackStartToCursor),
						unavailable('cursor-track-end', copy.cursorToTrackEnd),
					],
				},
				unavailable('store-selection', copy.storeSelection),
				unavailable('retrieve-selection', copy.retrieveSelection),
				unavailable('zero-crossings', copy.zeroCrossings),
			],
		},
		{
			id: 'view',
			label: copy.viewMenu,
			items: [
				{
					id: 'toolbars',
					label: copy.toolbarsMenu,
					items: [
						{ id: 'transport-toolbar', label: copy.transportToolbar, checked: true, disabled: true },
						{ id: 'selection-toolbar', label: copy.selectionToolbar, checked: true, disabled: true },
					],
				},
				{ id: 'show-effects', label: copy.showEffects, checked: Boolean(effectsOverlay), disabled: !snapshot.selectedTrackId, onClick: actions.openEffects },
				{ id: 'show-arm-controls', label: copy.showArmControls, checked: showArmControls, onClick: actions.toggleArmControls },
				unavailable('show-rms', copy.showRms),
				{ id: 'show-rulers', label: copy.showVerticalRulers, checked: true, disabled: true },
				divider(),
				{ id: 'waveform-view', label: copy.waveformView, checked: snapshot.timeline?.view === 'waveform', onClick: () => actions.setTimelineView('waveform') },
				{ id: 'spectrogram-view', label: copy.spectrogramView, checked: snapshot.timeline?.view === 'spectrogram', onClick: () => actions.setTimelineView('spectrogram') },
				{
					id: 'zoom',
					label: copy.zoomMenu,
					items: [
						{ id: 'zoom-in', label: copy.zoomIn, shortcut: 'Ctrl+1', onClick: actions.zoomIn },
						{ id: 'zoom-out', label: copy.zoomOut, shortcut: 'Ctrl+3', onClick: actions.zoomOut },
						{ id: 'zoom-fit', label: copy.zoomFit, shortcut: 'Ctrl+F', onClick: actions.zoomFit },
					],
				},
				divider(),
				{ id: 'fullscreen', label: copy.fullscreen, shortcut: 'F11', onClick: actions.fullscreen },
			],
		},
		{
			id: 'record',
			label: copy.recordMenu,
			items: [
				{ id: 'record', label: snapshot.recording ? copy.stopRecording : recordLabel, shortcut: 'R', disabled: snapshot.readOnly || snapshot.importing || snapshot.exporting, onClick: actions.record },
				unavailable('record-new-track', copy.recordNewTrack),
				{ id: 'stop', label: copy.stop, onClick: actions.stop },
				unavailable('pause-recording', copy.pauseRecording),
				divider(),
				{ id: 'monitor-input', label: copy.monitor, checked: Boolean(snapshot.monitor?.enabled), disabled: snapshot.recordingStarting, onClick: actions.toggleMonitoring },
				{ id: 'recording-offset', label: copy.recordingOffset, onClick: actions.openRecordingOffset },
				unavailable('lead-in-time', copy.leadInTime),
				unavailable('sound-activated', copy.soundActivatedRecording),
			],
		},
		{
			id: 'tracks',
			label: copy.tracksMenu,
			items: [
				{
					id: 'add-new-track',
					label: copy.addNewTrack,
					items: [
						{ id: 'audio-track', label: copy.audioTrack, disabled: editBlocked, onClick: actions.addTrack },
						unavailable('label-track', copy.labelTrack),
						unavailable('midi-track', copy.midiTrack),
					],
				},
				{ id: 'duplicate-track', label: copy.duplicateTrack, disabled: editBlocked || !selectedTrack, onClick: actions.duplicateTrack },
				{ id: 'remove-track', label: copy.removeTracks, disabled: editBlocked || !selectedTrack, onClick: actions.removeTrack },
				divider(),
				{ id: 'mute-track', label: selectedTrack?.mute ? copy.unmuteTrack : copy.muteTrack, disabled: editBlocked || !selectedTrack, onClick: actions.toggleTrackMute },
				unavailable('mute-all', copy.muteAllTracks),
				unavailable('unmute-all', copy.unmuteAllTracks),
				{ id: 'mix', label: copy.mixMenu, items: [unavailable('mix-render', copy.mixRender), unavailable('mix-render-new', copy.mixRenderNew)] },
				unavailable('resample', copy.resample),
				unavailable('align', copy.alignTracks),
				unavailable('sort', copy.sortTracks),
			],
		},
		{
			id: 'generate',
			label: copy.generateMenu,
			items: [
				unavailable('plugin-manager', copy.pluginManager),
				unavailable('repeat-generator', copy.repeatLastGenerator),
				divider(),
				unavailable('silence-generator', copy.silenceGenerator),
				unavailable('tone-generator', copy.toneGenerator),
				unavailable('chirp-generator', copy.chirpGenerator),
				unavailable('dtmf-generator', copy.dtmfGenerator),
				unavailable('noise-generator', copy.noiseGenerator),
				unavailable('rhythm-generator', copy.rhythmTrackGenerator),
				unavailable('pluck-generator', copy.pluckGenerator),
				unavailable('risset-generator', copy.rissetDrumGenerator),
			],
		},
		{
			id: 'effect',
			label: copy.effectMenu,
			items: [
				unavailable('effect-plugin-manager', copy.pluginManager),
				{ id: 'realtime-effects', label: copy.addRealtimeEffects, disabled: !snapshot.selectedTrackId, onClick: actions.openEffects },
				unavailable('repeat-effect', copy.repeatLastEffect),
				divider(),
				...effectGroups,
				{ id: 'pitch-tempo', label: copy.pitchTempo, items: [unavailable('change-pitch', copy.changePitch), unavailable('change-tempo', copy.changeTempo)] },
			],
		},
		{
			id: 'analyze',
			label: copy.analyzeMenu,
			items: [
				unavailable('analyze-plugin-manager', copy.pluginManager),
				unavailable('repeat-analyzer', copy.repeatLastAnalyzer),
				divider(),
				{ id: 'analysis', label: copy.analysisCommand, onClick: actions.openAnalysis },
				{ id: 'plot-spectrum', label: copy.plotSpectrum, onClick: actions.openAnalysis },
				{ id: 'find-clipping', label: copy.findClipping, onClick: actions.openAnalysis },
				unavailable('contrast', copy.contrast),
				unavailable('beat-finder', copy.beatFinder),
				unavailable('silence-finder', copy.silenceFinder),
				unavailable('sound-finder', copy.soundFinder),
			],
		},
		{
			id: 'tools',
			label: copy.toolsMenu,
			items: [
				unavailable('tools-plugin-manager', copy.pluginManager),
				unavailable('macro-manager', copy.macroManager),
				unavailable('nyquist-prompt', copy.nyquistPrompt),
			],
		},
		{
			id: 'extra',
			label: copy.extraMenu,
			items: [
				{ id: 'extra-transport', label: copy.extraTransport, items: [
					{ id: 'extra-play', label: copy.play, shortcut: 'Space', onClick: actions.playPause },
					{ id: 'extra-record', label: recordLabel, shortcut: 'R', disabled: snapshot.readOnly, onClick: actions.record },
				] },
				{ id: 'extra-edit', label: copy.extraEdit, items: [
					{ id: 'extra-undo', label: copy.undo, disabled: !snapshot.history?.canUndo, onClick: () => actions.executeEdit('undo') },
					{ id: 'extra-redo', label: copy.redo, disabled: !snapshot.history?.canRedo, onClick: () => actions.executeEdit('redo') },
				] },
				unavailable('extra-select', copy.extraSelect),
				unavailable('extra-tracks', copy.extraTracks),
				unavailable('extra-export', copy.extraExport),
				unavailable('play-at-speed', copy.playAtSpeed),
			],
		},
		{
			id: 'help',
			label: copy.helpMenu,
			items: [
				{ id: 'quick-help', label: copy.quickHelp, shortcut: 'F1', onClick: actions.quickHelp },
				unavailable('manual', copy.manual),
				unavailable('support', copy.support),
				divider(),
				unavailable('diagnostics', copy.diagnostics),
				unavailable('updates', copy.checkUpdates),
				unavailable('about', copy.aboutEditor),
			],
		},
	];
}

function handleWorkspaceKeyboard(event, controller, snapshot, run, commands = {}) {
	if (event.defaultPrevented) return;
	const modifier = event.metaKey || event.ctrlKey;
	const key = event.key.toLowerCase();
	if (!modifier && event.key === 'F1') {
		event.preventDefault();
		commands.quickHelp?.();
		return;
	}
	if (!modifier && event.key === 'F11') {
		event.preventDefault();
		commands.fullscreen?.();
		return;
	}
	if (modifier && !event.shiftKey && !event.altKey && key === '1') {
		event.preventDefault();
		run(() => controller.actions.timeline.zoomIn());
		return;
	}
	if (modifier && !event.shiftKey && !event.altKey && key === '3') {
		event.preventDefault();
		run(() => controller.actions.timeline.zoomOut());
		return;
	}
	if (modifier && !event.shiftKey && !event.altKey && key === 'f') {
		event.preventDefault();
		run(() => controller.actions.timeline.zoomFit());
		return;
	}
	if (event.target.closest('input, textarea, select, button, a, [contenteditable="true"], [role="menu"], [role="menubar"], [role="toolbar"], [role="slider"], [role="spinbutton"]')) return;
	if (modifier && key === 'n') {
		event.preventDefault();
		run(() => controller.actions.project.create());
		return;
	}
	if (modifier && key === 'o') {
		event.preventDefault();
		commands.openProjects?.();
		return;
	}
	if (modifier && key === 's') {
		event.preventDefault();
		run(() => controller.actions.project.save());
		return;
	}
	if (modifier && key === 'i') {
		event.preventDefault();
		commands.importAudio?.();
		return;
	}
	if (modifier && event.shiftKey && key === 'e') {
		event.preventDefault();
		commands.openExport?.();
		return;
	}
	if (modifier && key === 'a') {
		event.preventDefault();
		if (event.shiftKey) run(() => controller.actions.timeline.clearSelection());
		else if (snapshot.project) run(() => controller.actions.timeline.setSelection(0, projectDurationFrames(snapshot.project)));
		return;
	}
	if (modifier && event.key.toLowerCase() === 'z') {
		event.preventDefault();
		run(() => event.shiftKey ? controller.actions.edit.redo() : controller.actions.edit.undo());
		return;
	}
	if (modifier && key === 'c') { event.preventDefault(); return void run(() => controller.actions.edit.copy()); }
	if (modifier && key === 'x') { event.preventDefault(); return void run(() => controller.actions.edit.cut()); }
	if (modifier && key === 'v') { event.preventDefault(); return void run(() => controller.actions.edit.paste()); }
	if (event.key === ' ') {
		event.preventDefault();
		run(() => controller.actions.transport.playPause());
	} else if (event.key.toLowerCase() === 'r' && !modifier) {
		event.preventDefault();
		commands.toggleRecording?.();
	} else if (event.key.toLowerCase() === 's' && !modifier) {
		event.preventDefault();
		run(() => controller.actions.edit.split());
	} else if (event.key === 'Delete' || event.key === 'Backspace') {
		event.preventDefault();
		run(() => controller.actions.edit.delete());
	}
}

function handleEditorToolbarKeyDown(event) {
	if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const current = focusables.findIndex((element) => element === document.activeElement || element.contains(document.activeElement));
	if (current < 0 || !focusables.length) return;
	event.preventDefault();
	event.stopPropagation();
	let next = current;
	if (event.key === 'Home') next = 0;
	else if (event.key === 'End') next = focusables.length - 1;
	else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % focusables.length;
	else next = (current - 1 + focusables.length) % focusables.length;
	const activeTabIndex = Math.max(0, Number.parseInt(focusables[current].getAttribute('tabindex') || '0', 10));
	focusables.forEach((element, index) => { element.tabIndex = index === next ? activeTabIndex : -1; });
	focusables[next].focus({ preventScroll: true });
	focusables[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function handleEditorToolbarFocus(event) {
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const current = focusables.findIndex((element) => element === event.target || element.contains(event.target));
	if (current < 0) return;
	const activeTabIndex = Math.max(0, ...focusables.map((element) => Number.parseInt(element.getAttribute('tabindex') || '-1', 10)));
	focusables.forEach((element, index) => { element.tabIndex = index === current ? activeTabIndex : -1; });
}

function handleEditorToolbarBlur(event) {
	if (event.currentTarget.contains(event.relatedTarget)) return;
	const toolbar = event.currentTarget.querySelector('.toolbar[role="toolbar"]');
	if (!toolbar) return;
	const focusables = editorToolbarFocusables(toolbar);
	const activeTabIndex = Math.max(0, ...focusables.map((element) => Number.parseInt(element.getAttribute('tabindex') || '-1', 10)));
	focusables.forEach((element, index) => { element.tabIndex = index === 0 ? activeTabIndex : -1; });
}

function editorToolbarFocusables(toolbar) {
	return [...toolbar.querySelectorAll('button, select, input, [role="group"]')].filter((element) => {
		if (element.matches(':disabled, [aria-disabled="true"]')) return false;
		if (element.getAttribute('role') !== 'group' && element.closest('[role="group"]')) return false;
		return element.getClientRects().length > 0;
	});
}

function useMediaQuery(query) {
	const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
	useEffect(() => {
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener('change', update);
		return () => media.removeEventListener('change', update);
	}, [query]);
	return matches;
}

function resolveEffectsOverlayPosition(workspace, anchorRect, compact) {
	const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
	const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
	const bounds = workspace?.getBoundingClientRect() || {
		left: 0,
		top: 0,
		width: viewportWidth,
		height: viewportHeight,
	};
	const inset = 8;
	const adapterHeight = 78;
	const width = Math.max(240, Math.min(compact ? 372 : 340, bounds.width - inset * 2));
	const availableHeight = Math.max(320, bounds.height - inset * 2);
	const totalHeight = Math.min(compact ? 520 : 570, availableHeight);
	const panelHeight = Math.max(250, totalHeight - adapterHeight);
	let left = anchorRect
		? anchorRect.right - bounds.left + 6
		: inset;
	if (left + width + inset > bounds.width) {
		left = anchorRect
			? anchorRect.left - bounds.left - width - 6
			: bounds.width - width - inset;
	}
	left = Math.max(inset, Math.min(left, Math.max(inset, bounds.width - width - inset)));
	let top = anchorRect ? anchorRect.top - bounds.top : inset;
	top = Math.max(inset, Math.min(top, Math.max(inset, bounds.height - totalHeight - inset)));
	return { left, top, width, panelHeight, totalHeight };
}

function meterPercent(dbfs) {
	const value = Number.isFinite(dbfs) ? dbfs : -60;
	return (Math.max(-60, Math.min(0, value)) + 60) / 60 * 100;
}

function formatDate(value, locale) {
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale === 'de' ? 'de-DE' : 'en-US');
}
