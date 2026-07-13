import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	DialogHeader,
	GhostButton,
	LabeledCheckbox,
	MasterMeter,
	Menu,
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
	const [commandMenu, setCommandMenu] = useState(null);
	const [overflowMenu, setOverflowMenu] = useState(null);
	const [activeSurface, setActiveSurface] = useState(null);
	const [effectsOverlay, setEffectsOverlay] = useState(null);
	const [dialog, setDialog] = useState(null);
	const [dialogValue, setDialogValue] = useState('');
	const [localError, setLocalError] = useState('');
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
	const showAllEditButtons = !isCompact;
	const commandMenus = [
		['file', copy.fileMenu],
		['edit', copy.editMenu],
		['view', copy.viewMenu],
		['tracks', copy.tracksMenu],
		['effect', copy.effectMenu],
		['analyze', copy.analyzeMenu],
	];
	const commandItems = {
		file: [
			{ label: copy.newProject, disabled: blocked, onClick: () => run(() => controller.actions.project.create()) },
			{ label: copy.openProject, disabled: blocked, onClick: openProjects },
			{ label: copy.importAudio, disabled: blocked, onClick: () => importInputRef.current?.click() },
			{ divider: true, label: '' },
			{ label: copy.exportAudio, disabled: blocked, onClick: () => openSurface('export') },
			{ divider: true, label: '' },
			{ label: copy.renameProject, disabled: editBlocked, onClick: () => { setDialogValue(project?.title || ''); setDialog('rename'); } },
			{ label: copy.duplicateProject, disabled: blocked, onClick: () => run(() => controller.actions.project.duplicate()) },
			{ label: copy.deleteProject, disabled: editBlocked, onClick: () => setDialog('delete') },
			{ divider: true, label: '' },
			{ label: copy.clearData, disabled: blocked, onClick: () => setDialog('clear') },
		],
		edit: [
			...editItems.map((item) => ({
				label: item.label,
				disabled: item.disabled,
				onClick: () => executeEdit(item.action),
			})),
			{ divider: true, label: '' },
			{ label: copy.clipPropertiesCommand, disabled: !selectedClip, onClick: () => openSurface('clip') },
		],
		view: [
			{ label: copy.waveformView, checked: snapshot.timeline?.view === 'waveform', onClick: () => run(() => controller.actions.timeline.setView('waveform')) },
			{ label: copy.spectrogramView, checked: snapshot.timeline?.view === 'spectrogram', onClick: () => run(() => controller.actions.timeline.setView('spectrogram')) },
			{ divider: true, label: '' },
			{ label: copy.zoomOut, onClick: () => run(() => controller.actions.timeline.zoomOut()) },
			{ label: copy.zoomIn, onClick: () => run(() => controller.actions.timeline.zoomIn()) },
			{ label: copy.zoomFit, onClick: () => run(() => controller.actions.timeline.zoomFit()) },
		],
		tracks: [
			{ label: copy.addTrack, disabled: editBlocked, onClick: () => run(() => controller.actions.track.add()) },
			{ label: copy.clipPropertiesCommand, disabled: !selectedClip, onClick: () => openSurface('clip') },
		],
		effect: [
			{ label: copy.trackMasterEffects, disabled: !snapshot.selectedTrackId, onClick: () => openEffects(snapshot.selectedTrackId) },
			{ label: copy.applyEffect, disabled: !snapshot.selectedTrackId, onClick: () => openSurface('selection-effect') },
		],
		analyze: [
			{ label: copy.analysisCommand, onClick: () => openSurface('analysis') },
		],
	};
	const activeCommandItems = commandMenu ? commandItems[commandMenu.id] || [] : [];
	const effectsPosition = effectsOverlay
		? resolveEffectsOverlayPosition(workspaceRef.current, effectsOverlay.anchorRect, isCompact)
		: null;

	return (
		<div
			id="kw-audio-editor-design-system"
			className={`kw-audio-editor ${isCompact ? 'kw-audio-editor--compact' : ''}`}
			data-audio-editor
			data-audio-editor-bound="true"
			data-project-id={project?.id || ''}
			data-track-count={project?.tracks.length || 0}
			data-clip-count={project?.clips.length || 0}
			data-timeline-view={snapshot.timeline?.view || 'waveform'}
			onKeyDown={(event) => handleWorkspaceKeyboard(event, controller, snapshot, run)}
		>
			<Toolbar
				height={44}
				className="kw-audio-editor__titlebar"
				rightContent={(
					<div className="kw-audio-editor__title-actions">
						<span data-save-state data-state={snapshot.save?.state || 'saved'}>{saveText}</span>
					</div>
				)}
			>
				<div className="kw-audio-editor__title-left">
					<div className="kw-audio-editor__brand" aria-label="kw.media audio editor">
						<span className="kw-audio-editor__brand-mark" aria-hidden="true">kw</span>
						<span>
							<small>{copy.project}</small>
							<strong data-project-name>{project?.title || copy.untitledProject}</strong>
						</span>
					</div>
				</div>
			</Toolbar>

			<div className="kw-audio-editor__command-bar" role="toolbar" aria-label={copy.applicationCommands} data-command-toolbar>
				<Toolbar
					height={42}
					className="kw-audio-editor__command-toolbar"
					rightContent={(
						<ToolbarButtonGroup className="kw-audio-editor__project-actions" gap={3}>
							<GhostButton icon="plus" size="medium" label={isCompact ? undefined : copy.importAudio} ariaLabel={copy.importAudio} disabled={blocked} onClick={() => importInputRef.current?.click()} />
							<GhostButton icon="waveform" size="medium" label={isCompact ? undefined : copy.addTrack} ariaLabel={copy.addTrack} disabled={editBlocked} onClick={() => run(() => controller.actions.track.add())} />
							<GhostButton icon="mixer" size="medium" label={isCompact ? undefined : copy.mixer} ariaLabel={`${copy.mixer} (${copy.unavailable})`} disabled />
							<GhostButton icon="cloud" size="medium" label={isCompact ? undefined : copy.share} ariaLabel={`${copy.share} (${copy.unavailable})`} disabled />
						</ToolbarButtonGroup>
					)}
				>
					<ToolbarButtonGroup className="kw-audio-editor__application-menus" gap={0}>
						{commandMenus.map(([id, label]) => (
							<GhostButton
								key={id}
								size="medium"
								label={label}
								ariaLabel={label}
								onClick={(event) => setCommandMenu({ id, anchor: event.currentTarget })}
							/>
						))}
					</ToolbarButtonGroup>
				</Toolbar>
			</div>

			<Menu
				isOpen={Boolean(commandMenu)}
				anchorEl={commandMenu?.anchor || null}
				onClose={() => setCommandMenu(null)}
				items={activeCommandItems}
			/>

			<input
				ref={importInputRef}
				className="kw-audio-editor__file-input"
				data-import-input
				aria-label={copy.importAudio}
				type="file"
				accept="audio/*,.aif,.aiff,.aup3,.flac,.m4a,.mp3,.oga,.ogg,.opus,.wav,.webm"
				multiple
				onChange={(event) => {
					const files = [...event.currentTarget.files];
					event.currentTarget.value = '';
					if (files.length) run(() => controller.actions.project.importFiles(files));
				}}
			/>

			<div className="kw-audio-editor__toolbars">
				<Toolbar height={50} className="kw-audio-editor__edit-toolbar" enableTabGroup tabGroupId="kw-editor-actions">
					<ToolbarButtonGroup gap={2}>
						{editItems.slice(0, showAllEditButtons ? editItems.length : 2).map((item) => (
							<span key={item.action} data-edit={item.action === 'rippleDelete' ? 'ripple-delete' : item.action}>
								<GhostButton icon={item.icon} size="medium" ariaLabel={item.label} disabled={item.disabled} onClick={() => executeEdit(item.action)} />
							</span>
						))}
						{isCompact && (
							<GhostButton icon="menu" size="medium" ariaLabel={copy.editControls} onClick={(event) => setOverflowMenu(event.currentTarget)} />
						)}
					</ToolbarButtonGroup>
					<ToolbarDivider />
					<ToolbarButtonGroup className="kw-audio-editor__zoom-actions" gap={2}>
						<ToggleToolButton icon="waveform" isActive={snapshot.timeline?.view === 'waveform'} ariaLabel={copy.waveformView} onClick={() => run(() => controller.actions.timeline.setView('waveform'))} />
						<ToggleToolButton icon="spectrogram" isActive={snapshot.timeline?.view === 'spectrogram'} ariaLabel={copy.spectrogramView} onClick={() => run(() => controller.actions.timeline.setView('spectrogram'))} />
						<GhostButton icon="zoom-out" size="medium" ariaLabel={copy.zoomOut} onClick={() => run(() => controller.actions.timeline.zoomOut())} />
						<GhostButton icon="zoom-in" size="medium" ariaLabel={copy.zoomIn} onClick={() => run(() => controller.actions.timeline.zoomIn())} />
						<GhostButton icon="zoom-to-fit" size="medium" ariaLabel={copy.zoomFit} onClick={() => run(() => controller.actions.timeline.zoomFit())} />
					</ToolbarButtonGroup>
				</Toolbar>

				<EditorTransportToolbars
					controller={controller}
					snapshot={snapshot}
					copy={copy}
					isCompact={isCompact}
					blocked={blocked}
					selectionActive={selectionActive}
					durationFrames={durationFrames}
					run={run}
				/>
			</div>

			<Menu
				isOpen={Boolean(overflowMenu)}
				anchorEl={overflowMenu}
				onClose={() => setOverflowMenu(null)}
				items={[
					...editItems.slice(2).map((item) => ({ label: item.label, disabled: item.disabled, onClick: () => executeEdit(item.action) })),
					{ divider: true, label: '' },
					{ label: copy.zoomOut, onClick: () => run(() => controller.actions.timeline.zoomOut()) },
					{ label: copy.zoomIn, onClick: () => run(() => controller.actions.timeline.zoomIn()) },
					{ label: copy.zoomFit, onClick: () => run(() => controller.actions.timeline.zoomFit()) },
				]}
			/>

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
						onError={onError}
						onOpenEffects={openEffects}
						onOpenClipProperties={() => openSurface('clip')}
					/>
					<p className="kw-audio-editor__keyboard-help">{copy.keyboardHelp}</p>
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

function EditorTransportToolbars({
	controller,
	snapshot,
	copy,
	isCompact,
	blocked,
	selectionActive,
	durationFrames,
	run,
}) {
	const telemetry = useAudioEditorTelemetry(controller);
	const project = snapshot.project;
	const masterMeter = telemetry.meters?.master;
	return (
		<>
			<Toolbar
				height={58}
				className="kw-audio-editor__transport-toolbar"
				rightContent={(
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
				)}
			>
				<ToolbarButtonGroup className="kw-audio-editor__transport" gap={2}>
					<TransportButton icon="skip-back" ariaLabel={copy.jumpStart} disabled={blocked} onClick={() => run(() => controller.actions.transport.jumpStart())} />
					<TransportButton icon="rewind" ariaLabel={copy.rewind} disabled={blocked} onClick={() => run(() => controller.actions.transport.rewind())} />
					<TransportButton
						icon={telemetry.transportState === 'playing' ? 'pause' : 'play'}
						ariaLabel={telemetry.transportState === 'playing' ? copy.pause : copy.play}
						disabled={blocked && !snapshot.recording}
						active={telemetry.transportState === 'playing'}
						onClick={() => run(() => controller.actions.transport.playPause())}
					/>
					<TransportButton icon="stop" ariaLabel={copy.stop} onClick={() => run(() => controller.actions.transport.stop())} />
					<TransportButton icon="forward" ariaLabel={copy.forward} disabled={blocked} onClick={() => run(() => controller.actions.transport.forward())} />
					<TransportButton icon="skip-forward" ariaLabel={copy.jumpEnd} disabled={blocked} onClick={() => run(() => controller.actions.transport.jumpEnd())} />
					<AccessibleTransportButton
						icon="loop"
						ariaLabel={copy.loop}
						active={Boolean(project?.loop?.enabled)}
						pressed={Boolean(project?.loop?.enabled)}
						disabled={!selectionActive}
						onClick={() => run(() => controller.actions.transport.toggleLoop())}
					/>
					<span data-transport="record">
						<AccessibleTransportButton
							icon="record"
							ariaLabel={copy.record}
							recording={snapshot.recording}
							pressed={Boolean(snapshot.recording)}
							disabled={snapshot.readOnly || snapshot.importing || snapshot.exporting}
							onClick={() => run(() => snapshot.recording ? controller.actions.recording.stop() : controller.actions.recording.start())}
						/>
					</span>
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
			</Toolbar>

			<Toolbar height={46} className="kw-audio-editor__recording-toolbar">
				<ToolbarButtonGroup gap={8}>
					<LabeledCheckbox
						label={copy.monitor}
						checked={snapshot.monitor?.enabled}
						onChange={(checked) => run(() => controller.actions.recording.setMonitoring(checked))}
					/>
					<div className="kw-audio-editor__input-meter" data-input-meter role="meter" aria-label={copy.inputLevel} aria-valuemin={-60} aria-valuemax={0} aria-valuenow={telemetry.inputMeterDb ?? -60}>
						<span>{copy.inputLevel}</span>
						<TrackMeter volume={meterPercent(telemetry.inputMeterDb)} clipped={(telemetry.inputMeterDb || -60) >= 0} variant="stereo" />
					</div>
					<label className="kw-audio-editor__latency">
						<span>{copy.latencyOffset}</span>
						<NumberStepper
							value={String(snapshot.monitor?.latencyOffsetMs ?? 0)}
							min={-500}
							max={500}
							step={1}
							width={88}
							onChange={(value) => run(() => controller.actions.recording.setLatencyOffset(value))}
						/>
					</label>
				</ToolbarButtonGroup>
			</Toolbar>
		</>
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

function handleWorkspaceKeyboard(event, controller, snapshot, run) {
	if (event.defaultPrevented || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
	const modifier = event.metaKey || event.ctrlKey;
	if (modifier && event.key.toLowerCase() === 'z') {
		event.preventDefault();
		run(() => event.shiftKey ? controller.actions.edit.redo() : controller.actions.edit.undo());
		return;
	}
	if (modifier && event.key.toLowerCase() === 'c') return void run(() => controller.actions.edit.copy());
	if (modifier && event.key.toLowerCase() === 'x') return void run(() => controller.actions.edit.cut());
	if (modifier && event.key.toLowerCase() === 'v') return void run(() => controller.actions.edit.paste());
	if (event.key === ' ') {
		event.preventDefault();
		run(() => controller.actions.transport.playPause());
	} else if (event.key.toLowerCase() === 'r' && !modifier) {
		event.preventDefault();
		run(() => snapshot.recording ? controller.actions.recording.stop() : controller.actions.recording.start());
	} else if (event.key.toLowerCase() === 's' && !modifier) {
		event.preventDefault();
		run(() => controller.actions.edit.split());
	} else if (event.key === 'Delete' || event.key === 'Backspace') {
		event.preventDefault();
		run(() => controller.actions.edit.delete());
	}
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
