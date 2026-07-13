import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	Button,
	ContextMenu,
	ContextMenuItem,
	Icon,
	Menu,
	PlayheadCursor,
	TextInput,
	TimelineRuler,
	ToggleToolButton,
	TrackControlPanel,
	TrackNew,
	useAccessibilityProfile,
	useTabOrder,
	VerticalRuler,
} from '@dilsonspickles/components';

import {
	designValueToPan,
	designVolumeToGainDb,
	framesToSeconds,
	gainDbToDesignVolume,
	panToDesignValue,
	prepareBoundedWaveformWindow,
	projectClipsToViewport,
	secondsToFrames,
} from '../../../lib/tools/audio-editor/design-system-adapters.js';
import { AUDIO_EDITOR_SAMPLE_RATE, projectDurationFrames } from '../../../lib/tools/audio-editor/project.js';
import { useAudioEditorTelemetry, useElementSize } from './DesignSystemRuntime.jsx';

const DESKTOP_TRACK_PANEL_WIDTH = 268;
const COMPACT_TRACK_PANEL_WIDTH = 164;
const TRACK_HEIGHT = 114;
const VERTICAL_RULER_WIDTH = 40;
const MINIMUM_TIMELINE_SECONDS = 10;
const MINIMUM_VISIBLE_CLIP_PIXELS = 48;

export default function AudioEditorTimeline({
	controller,
	snapshot,
	copy,
	mobile,
	showArmControls,
	onError,
	onOpenEffects,
	onOpenClipProperties,
	onToggleArmControls,
}) {
	const project = snapshot.project;
	const [timelineRef, timelineSize] = useElementSize();
	const navigationRootRef = useRef(null);
	const scrollRef = useRef(null);
	const pointerSession = useRef(null);
	const touchPointers = useRef(new Map());
	const pinchSession = useRef(null);
	const [scrollX, setScrollX] = useState(0);
	const [selectionPreview, setSelectionPreview] = useState(null);
	const [trackMenu, setTrackMenu] = useState(null);
	const [clipMenu, setClipMenu] = useState(null);
	const [draggingClipId, setDraggingClipId] = useState(null);
	const [clipDragPreview, setClipDragPreview] = useState(null);
	const { activeProfile } = useAccessibilityProfile();
	const isFlatNavigation = activeProfile.config.tabNavigation === 'sequential';
	const timelineRulerTabIndex = useTabOrder('timeline-ruler');
	const trackBaseTabIndex = useTabOrder('tracks');
	const addTrackTabIndex = useTabOrder('add-track');
	const panelWidth = mobile ? COMPACT_TRACK_PANEL_WIDTH : DESKTOP_TRACK_PANEL_WIDTH;
	const viewportWidth = Math.max(1, timelineSize.width - panelWidth - VERTICAL_RULER_WIDTH);
	const pixelsPerSecond = snapshot.timeline?.pixelsPerSecond || 120;
	const durationFrames = Math.max(
		AUDIO_EDITOR_SAMPLE_RATE * MINIMUM_TIMELINE_SECONDS,
		project ? projectDurationFrames(project) : 0,
	);
	const durationSeconds = framesToSeconds(durationFrames);
	const timelineWidth = Math.max(viewportWidth, Math.ceil(durationSeconds * pixelsPerSecond));
	const viewportStartFrame = Math.max(0, secondsToFrames(scrollX / pixelsPerSecond));
	const viewportDurationFrames = Math.max(1, secondsToFrames(viewportWidth / pixelsPerSecond));
	const documentSelection = selectionPreview || snapshot.selection;
	const timeSelection = documentSelection && documentSelection.endFrame > documentSelection.startFrame
		? {
			startTime: framesToSeconds(documentSelection.startFrame),
			endTime: framesToSeconds(documentSelection.endFrame),
		}
		: null;

	const focusTimelineRuler = useCallback(() => {
		return focusFirst(navigationRootRef.current?.querySelector('[data-ruler-focus]'));
	}, []);
	const focusTrackContainer = useCallback((trackIndex) => {
		return focusFirst(trackNavigationRow(navigationRootRef.current, trackIndex)?.querySelector('.track'));
	}, []);
	const focusTrackPanelControl = useCallback((trackIndex, last = false) => {
		const panel = trackNavigationRow(navigationRootRef.current, trackIndex)?.querySelector('.track-control-panel');
		return focusPanelControl(panel, last);
	}, []);
	const focusTrackClip = useCallback((trackIndex, last = false, clipId = null) => {
		const row = trackNavigationRow(navigationRootRef.current, trackIndex);
		if (clipId !== null) {
			const matchingClip = [...(row?.querySelectorAll('[data-clip-id][role="group"]') || [])]
				.find((element) => String(element.dataset.clipId) === String(clipId));
			if (matchingClip) return focusFirst(matchingClip);
		}
		return focusCandidate(row, '[data-clip-id][role="group"]', last);
	}, []);
	const focusTrackRuler = useCallback((trackIndex) => {
		return focusFirst(trackNavigationRow(navigationRootRef.current, trackIndex)?.querySelector('[data-track-ruler]'));
	}, []);
	const focusSelectionToolbar = useCallback(() => {
		const editor = navigationRootRef.current?.closest('#kw-audio-editor-design-system');
		const selectionToolbar = editor?.querySelector('[data-selection-toolbar] .selection-toolbar');
		return focusCandidate(selectionToolbar, '[role="group"], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])');
	}, []);
	const setTimelineNode = useCallback((node) => {
		timelineRef(node);
		navigationRootRef.current = node;
	}, [timelineRef]);

	useEffect(() => {
		const element = scrollRef.current;
		if (!element) return undefined;
		const update = () => setScrollX(Math.max(0, element.scrollLeft));
		update();
		element.addEventListener('scroll', update, { passive: true });
		return () => element.removeEventListener('scroll', update);
	}, []);

	const run = useCallback((action) => {
		try {
			const value = action();
			if (value && typeof value.catch === 'function') value.catch(onError);
			return value;
		} catch (error) {
			onError(error);
			return undefined;
		}
	}, [onError]);

	const openClipMenu = useCallback((clipId, x, y, openedViaKeyboard = false) => {
		const clip = project?.clips.find((item) => String(item.id) === String(clipId));
		if (!clip) return;
		run(() => controller.actions.timeline.selectClip(clip.id));
		setClipMenu({
			clipId: clip.id,
			x: Number.isFinite(x) ? x : 0,
			y: Number.isFinite(y) ? y : 0,
			autoFocus: Boolean(openedViaKeyboard),
		});
	}, [controller, project, run]);

	const onClipContextMenu = useCallback((event) => {
		const clipElement = event.target.closest?.('[data-clip-id]');
		if (!clipElement) return;
		event.preventDefault();
		event.stopPropagation();
		openClipMenu(clipElement.dataset.clipId, event.clientX, event.clientY);
	}, [openClipMenu]);

	const frameAtClientX = useCallback((clientX, lane) => {
		const rect = lane.getBoundingClientRect();
		return secondsToFrames(Math.max(0, (scrollX + clientX - rect.left) / pixelsPerSecond), {
			maximumFrame: durationFrames,
		});
	}, [durationFrames, pixelsPerSecond, scrollX]);

	const trackAtClientY = useCallback((clientY, fallbackTrackId) => {
		for (const lane of document.querySelectorAll('[data-track-lane]')) {
			const rect = lane.getBoundingClientRect();
			if (clientY >= rect.top && clientY < rect.bottom) return lane.dataset.trackId || fallbackTrackId;
		}
		return fallbackTrackId;
	}, []);

	const finishPointerSession = useCallback((event, cancelled = false) => {
		const session = pointerSession.current;
		pointerSession.current = null;
		setDraggingClipId(null);
		const dragPreview = session?.preview;
		setClipDragPreview(null);
		if (!session || cancelled || pinchSession.current || !project) return;
		const deltaFrames = secondsToFrames(
			Math.abs(event.clientX - session.startX) / pixelsPerSecond,
		) * Math.sign(event.clientX - session.startX);
		if (session.kind === 'selection') {
			const endFrame = frameAtClientX(event.clientX, session.lane);
			setSelectionPreview(null);
			if (Math.abs(endFrame - session.startFrame) < Math.max(1, secondsToFrames(3 / pixelsPerSecond))) {
				run(() => controller.actions.transport.seek(endFrame));
				run(() => controller.actions.timeline.clearSelection());
			} else {
				run(() => controller.actions.timeline.setSelection(session.startFrame, endFrame));
			}
			return;
		}
		const clip = project.clips.find((item) => item.id === session.clipId);
		if (!clip) return;
		if (session.kind === 'move') {
			run(() => controller.actions.clip.overwrite(
				clip.id,
				dragPreview?.trackId || trackAtClientY(event.clientY, session.trackId),
				{ timelineStartFrame: dragPreview?.timelineStartFrame ?? Math.max(0, session.original.timelineStartFrame + deltaFrames) },
			));
		} else if (session.kind === 'trim-left') {
			const source = project.sources.find((item) => item.id === clip.sourceId);
			const sourceExtension = session.original.reversed
				? source.frameCount - session.original.sourceStartFrame - session.original.durationFrames
				: session.original.sourceStartFrame;
			const change = Math.max(
				-Math.min(session.original.timelineStartFrame, sourceExtension),
				Math.min(session.original.durationFrames - 1, deltaFrames),
			);
			run(() => controller.actions.clip.overwrite(clip.id, session.trackId, {
				timelineStartFrame: session.original.timelineStartFrame + change,
				sourceStartFrame: session.original.sourceStartFrame + (session.original.reversed ? 0 : change),
				durationFrames: session.original.durationFrames - change,
			}));
		} else if (session.kind === 'trim-right') {
			const source = project.sources.find((item) => item.id === clip.sourceId);
			const maximum = session.original.reversed
				? session.original.sourceStartFrame + session.original.durationFrames
				: source.frameCount - session.original.sourceStartFrame;
			const nextDuration = Math.max(1, Math.min(maximum, session.original.durationFrames + deltaFrames));
			run(() => controller.actions.clip.overwrite(clip.id, session.trackId, {
				sourceStartFrame: session.original.reversed
					? session.original.sourceStartFrame + session.original.durationFrames - nextDuration
					: session.original.sourceStartFrame,
				durationFrames: nextDuration,
			}));
		}
	}, [controller, frameAtClientX, pixelsPerSecond, project, run, trackAtClientY]);

	const onPointerDown = useCallback((event) => {
		if (event.pointerType === 'touch') {
			touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (touchPointers.current.size === 2) {
				const points = [...touchPointers.current.values()];
				pinchSession.current = {
					distance: Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)),
					pixelsPerSecond,
					midpoint: (points[0].x + points[1].x) / 2,
					scrollLeft: scrollRef.current?.scrollLeft || 0,
				};
				pointerSession.current = null;
				return;
			}
		}
		if (event.button !== 0 || snapshot.readOnly || snapshot.recording || snapshot.recordingStarting) return;
		const interactiveControl = event.target.closest?.('button, input, textarea, select, [role="menuitem"]');
		if (interactiveControl && !interactiveControl.classList.contains('clip-display__handle')) return;
		const clipElement = event.target.closest('[data-clip-id]');
		const lane = event.target.closest('[data-track-lane]');
		if (!lane) return;
		if (!clipElement) {
			if (!event.target.closest('[data-ruler-interaction]')) return;
			const startFrame = frameAtClientX(event.clientX, lane);
			pointerSession.current = { kind: 'selection', startFrame, startX: event.clientX, lane };
			setSelectionPreview({ startFrame, endFrame: startFrame });
			event.currentTarget.setPointerCapture?.(event.pointerId);
			return;
		}
		const clipId = String(clipElement.dataset.clipId);
		const clip = project?.clips.find((item) => String(item.id) === clipId);
		const trackId = lane.dataset.trackId;
		if (!clip || !trackId) return;
		let kind = 'move';
		if (event.target.closest('.clip-display__handle--trim-left')) kind = 'trim-left';
		if (event.target.closest('.clip-display__handle--trim-right')) kind = 'trim-right';
		if (event.target.closest('.clip-display__handle--stretch-left, .clip-display__handle--stretch-right')) return;
		pointerSession.current = { kind, clipId: clip.id, trackId, original: { ...clip }, startX: event.clientX, lane };
		setDraggingClipId(clip.id);
		run(() => controller.actions.timeline.selectClip(clip.id));
		event.currentTarget.setPointerCapture?.(event.pointerId);
	}, [controller, frameAtClientX, pixelsPerSecond, project, run, snapshot.readOnly, snapshot.recording, snapshot.recordingStarting]);

	const onPointerMove = useCallback((event) => {
		if (touchPointers.current.has(event.pointerId)) {
			touchPointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
			if (touchPointers.current.size === 2 && pinchSession.current) {
				event.preventDefault();
				const points = [...touchPointers.current.values()];
				const distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y));
				const midpoint = (points[0].x + points[1].x) / 2;
				const session = pinchSession.current;
				const nextZoom = session.pixelsPerSecond * distance / session.distance;
				const rect = scrollRef.current?.getBoundingClientRect();
				const anchorSeconds = (session.scrollLeft + session.midpoint - (rect?.left || 0) - panelWidth) / session.pixelsPerSecond;
				run(() => controller.actions.timeline.setZoom(nextZoom));
				requestAnimationFrame(() => {
					if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, anchorSeconds * nextZoom - (midpoint - (rect?.left || 0) - panelWidth));
				});
			}
			return;
		}
		const session = pointerSession.current;
		if (session?.kind === 'selection') {
			const endFrame = frameAtClientX(event.clientX, session.lane);
			setSelectionPreview({
				startFrame: Math.min(session.startFrame, endFrame),
				endFrame: Math.max(session.startFrame, endFrame),
			});
		} else if (session?.kind === 'move') {
			const deltaFrames = secondsToFrames(
				Math.abs(event.clientX - session.startX) / pixelsPerSecond,
			) * Math.sign(event.clientX - session.startX);
			const preview = {
				clipId: session.clipId,
				trackId: trackAtClientY(event.clientY, session.trackId),
				timelineStartFrame: Math.max(0, session.original.timelineStartFrame + deltaFrames),
			};
			session.preview = preview;
			setClipDragPreview((current) => (
				current?.clipId === preview.clipId
				&& current.trackId === preview.trackId
				&& current.timelineStartFrame === preview.timelineStartFrame
					? current
					: preview
			));
		}
	}, [controller, frameAtClientX, panelWidth, pixelsPerSecond, run, trackAtClientY]);

	const finishTouch = useCallback((event) => {
		touchPointers.current.delete(event.pointerId);
		if (touchPointers.current.size < 2) pinchSession.current = null;
	}, []);

	if (!project) {
		return <div className="audio-editor-timeline-loading" role="status">{copy.loading}</div>;
	}

	const menuTrack = trackMenu ? project.tracks.find((track) => track.id === trackMenu.trackId) : null;
	const menuClip = clipMenu ? project.clips.find((clip) => clip.id === clipMenu.clipId) : null;
	const mutationsBlocked = snapshot.readOnly
		|| snapshot.importing
		|| snapshot.recording
		|| snapshot.recordingStarting
		|| snapshot.exporting
		|| snapshot.processingEffect;
	return (
		<section
			className="audio-editor-timeline-panel"
			aria-label={copy.timeline}
			ref={setTimelineNode}
			style={{
				'--track-panel-width': `${panelWidth}px`,
				'--timeline-viewport-width': `${viewportWidth}px`,
				'--vertical-ruler-width': `${VERTICAL_RULER_WIDTH}px`,
			}}
		>
			<div
				className="audio-editor-timeline-scroll"
				data-timeline
				ref={scrollRef}
				onPointerDownCapture={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={(event) => { finishTouch(event); finishPointerSession(event); }}
				onPointerCancel={(event) => { finishTouch(event); finishPointerSession(event, true); }}
				onContextMenu={onClipContextMenu}
				onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
				onDrop={(event) => {
					event.preventDefault();
					const files = [...event.dataTransfer.files];
					if (files.length) run(() => controller.actions.project.importFiles(files));
				}}
			>
				<div className="audio-editor-timeline-inner" style={{ width: panelWidth + timelineWidth + VERTICAL_RULER_WIDTH }}>
					<div className="audio-editor-ruler-row">
						<div className="audio-editor-ruler-corner" style={{ width: panelWidth }}>
							<span>{copy.tracks}</span>
							<Button
								variant="secondary"
								size="small"
								icon={<Icon name="plus" size={14} />}
								disabled={mutationsBlocked}
								tabIndex={addTrackTabIndex}
								onClick={() => run(() => controller.actions.track.add())}
							>
								{copy.addTrack}
							</Button>
						</div>
						<div
							className="audio-editor-ruler-viewport"
							data-ruler
							data-ruler-focus
							data-ruler-interaction
							data-track-lane
							data-track-id={snapshot.selectedTrackId || project.tracks[0]?.id || ''}
							role="region"
							aria-label={copy.timeline}
							tabIndex={timelineRulerTabIndex}
							style={{ left: panelWidth, width: viewportWidth }}
							onKeyDown={(event) => {
								if (event.key === 'Tab' && !event.shiftKey && project.tracks.length) {
									event.preventDefault();
									focusTrackContainer(0);
								} else if (event.key === 'Escape') {
									event.currentTarget.blur();
								}
							}}
						>
							<TelemetryTimelineRuler
								controller={controller}
								pixelsPerSecond={pixelsPerSecond}
								scrollX={scrollX}
								totalDuration={durationSeconds}
								width={timelineWidth}
								viewportWidth={viewportWidth}
								timeSelection={timeSelection}
								loopRegionEnabled={Boolean(project.loop?.enabled)}
								loopRegionStart={framesToSeconds(project.loop?.startFrame || 0)}
								loopRegionEnd={framesToSeconds(project.loop?.endFrame || 0)}
								onLoopRegionEnabledToggle={() => run(() => controller.actions.transport.toggleLoop())}
							/>
						</div>
						<div
							className="audio-editor-ruler-scale-corner"
							aria-hidden="true"
							style={{ left: panelWidth + viewportWidth, width: VERTICAL_RULER_WIDTH }}
						/>
					</div>

					<div className="audio-editor-track-list" data-track-list>
						{project.tracks.map((track, trackIndex) => (
							<TrackRow
								key={track.id}
								controller={controller}
								project={project}
								track={track}
								trackIndex={trackIndex}
								trackCount={project.tracks.length}
								isFlatNavigation={isFlatNavigation}
								trackBaseTabIndex={trackBaseTabIndex}
								panelWidth={panelWidth}
								viewportWidth={viewportWidth}
								viewportStartFrame={viewportStartFrame}
								viewportDurationFrames={viewportDurationFrames}
								pixelsPerSecond={pixelsPerSecond}
								timelineWidth={timelineWidth}
								selection={timeSelection}
								selectedTrackId={snapshot.selectedTrackId}
								selectedClipId={snapshot.selectedClipId}
								timelineView={snapshot.timeline?.view}
								draggingClipId={draggingClipId}
								clipDragPreview={clipDragPreview}
								blocked={snapshot.readOnly || snapshot.importing || snapshot.recording || snapshot.recordingStarting || snapshot.exporting || snapshot.processingEffect}
								showArmControls={showArmControls}
								copy={copy}
								run={run}
								onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
								onOpenEffects={onOpenEffects}
								onOpenClipMenu={openClipMenu}
								onFocusTimelineRuler={focusTimelineRuler}
								onFocusTrackContainer={focusTrackContainer}
								onFocusTrackPanelControl={focusTrackPanelControl}
								onFocusTrackClip={focusTrackClip}
								onFocusTrackRuler={focusTrackRuler}
								onFocusSelectionToolbar={focusSelectionToolbar}
							/>
						))}
					</div>

					{project.tracks.length === 0 && project.clips.length === 0 && (
						<div className="audio-editor-empty-state" style={{ left: panelWidth + 24 }}>
							<strong>{copy.emptyTitle}</strong>
							<p>{copy.emptyText}</p>
						</div>
					)}

					<TelemetryPlayhead
						controller={controller}
						copy={copy}
						durationFrames={durationFrames}
						panelWidth={panelWidth}
						viewportWidth={viewportWidth}
						pixelsPerSecond={pixelsPerSecond}
						height={Math.max(TRACK_HEIGHT, project.tracks.length * TRACK_HEIGHT)}
						scrollX={scrollX}
						run={run}
					/>
				</div>
			</div>

			<Menu
				isOpen={Boolean(trackMenu && menuTrack)}
				anchorEl={trackMenu?.anchor || null}
				onClose={() => setTrackMenu(null)}
				className="audio-editor-track-menu"
				items={menuTrack ? [
					{ label: copy.showArmControls, checked: showArmControls, onClick: onToggleArmControls },
					{ divider: true, label: '' },
					{ label: copy.duplicateTrack, disabled: snapshot.readOnly, onClick: () => run(() => controller.actions.track.duplicate(menuTrack.id)) },
					{ divider: true, label: '' },
					{ label: copy.deleteTrack, disabled: snapshot.readOnly, onClick: () => run(() => controller.actions.track.remove(menuTrack.id)) },
				] : []}
			/>

			<ContextMenu
				isOpen={Boolean(clipMenu && menuClip)}
				x={clipMenu?.x || 0}
				y={clipMenu?.y || 0}
				autoFocus={Boolean(clipMenu?.autoFocus)}
				onClose={() => setClipMenu(null)}
				className="audio-editor-clip-context-menu"
			>
				<ContextMenuItem
					label={copy.clipPropertiesCommand || (copy.fileMenu === 'Datei' ? 'Clip-Eigenschaften…' : 'Clip properties…')}
					disabled={!menuClip}
					onClick={() => {
						if (!menuClip) return;
						run(() => controller.actions.timeline.selectClip(menuClip.id));
						const clipElement = document.querySelector(`[data-clip-id="${menuClip.id}"]`);
						clipElement?.focus?.({ preventScroll: true });
						onOpenClipProperties?.(menuClip.id);
					}}
					onClose={() => setClipMenu(null)}
				/>
				<ContextMenuItem isDivider />
				<ContextMenuItem
					label={copy.split}
					disabled={mutationsBlocked || !menuClip}
					onClick={() => menuClip && run(() => controller.actions.edit.split())}
					onClose={() => setClipMenu(null)}
				/>
				<ContextMenuItem
					label={copy.reverse}
					disabled={mutationsBlocked || !menuClip}
					onClick={() => menuClip && run(() => controller.actions.clip.reverse(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ContextMenuItem
					label={copy.normalizePeak}
					disabled={mutationsBlocked || !menuClip}
					onClick={() => menuClip && run(() => controller.actions.clip.normalizePeak(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
				<ContextMenuItem isDivider />
				<ContextMenuItem
					label={copy.deleteClip || copy.liftDelete}
					disabled={mutationsBlocked || !menuClip}
					onClick={() => menuClip && run(() => controller.actions.clip.remove(menuClip.id))}
					onClose={() => setClipMenu(null)}
				/>
			</ContextMenu>
		</section>
	);
}

function TelemetryTimelineRuler({ controller, ...props }) {
	const telemetry = useAudioEditorTelemetry(controller);
	return <TimelineRuler {...props} cursorPosition={framesToSeconds(telemetry.positionFrame || 0)} />;
}

function TelemetryPlayhead({
	controller,
	copy,
	durationFrames,
	panelWidth,
	viewportWidth,
	pixelsPerSecond,
	height,
	scrollX,
	run,
}) {
	const telemetry = useAudioEditorTelemetry(controller);
	return (
		<div
			className="audio-editor-playhead-boundary"
			data-playhead
			role="slider"
			tabIndex={0}
			aria-label={copy.playhead}
			aria-valuemin={0}
			aria-valuemax={durationFrames}
			aria-valuenow={telemetry.positionFrame || 0}
			style={{ left: panelWidth, width: viewportWidth }}
			onKeyDown={(event) => {
				const amount = event.shiftKey ? Math.round(AUDIO_EDITOR_SAMPLE_RATE / 10) : 1;
				if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
					event.preventDefault();
					run(() => controller.actions.transport.seek((telemetry.positionFrame || 0) + (event.key === 'ArrowLeft' ? -amount : amount)));
				} else if (event.key === 'Home' || event.key === 'End') {
					event.preventDefault();
					run(() => controller.actions.transport.seek(event.key === 'Home' ? 0 : durationFrames));
				}
			}}
		>
			<PlayheadCursor
				position={framesToSeconds(telemetry.positionFrame || 0)}
				pixelsPerSecond={pixelsPerSecond}
				height={height}
				showTopIcon
				iconTopOffset={-17}
				scrollX={scrollX}
				minPosition={0}
				onPositionChange={(seconds) => run(() => controller.actions.transport.seek(secondsToFrames(seconds, { maximumFrame: durationFrames })))}
			/>
		</div>
	);
}

function TrackRow({
	controller,
	project,
	track,
	trackIndex,
	trackCount,
	isFlatNavigation,
	trackBaseTabIndex,
	panelWidth,
	viewportWidth,
	viewportStartFrame,
	viewportDurationFrames,
	pixelsPerSecond,
	timelineWidth,
	selection,
	selectedTrackId,
	selectedClipId,
	timelineView,
	draggingClipId,
	clipDragPreview,
	blocked,
	showArmControls,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onOpenClipMenu,
	onFocusTimelineRuler,
	onFocusTrackContainer,
	onFocusTrackPanelControl,
	onFocusTrackClip,
	onFocusTrackRuler,
	onFocusSelectionToolbar,
}) {
	const trackWindowRef = useRef(null);
	const clipLookup = useMemo(() => new Map(project.clips.map((clip) => [clip.id, clip])), [project.clips]);
	const clips = useMemo(() => {
		const trackClips = track.clipIds.map((clipId) => clipLookup.get(clipId)).filter(Boolean);
		if (!clipDragPreview) return trackClips;
		const draggedClip = clipLookup.get(clipDragPreview.clipId);
		if (!draggedClip) return trackClips;
		if (track.id === clipDragPreview.trackId) {
			const previewClip = { ...draggedClip, timelineStartFrame: clipDragPreview.timelineStartFrame };
			return trackClips.some((clip) => clip.id === draggedClip.id)
				? trackClips.map((clip) => (clip.id === draggedClip.id ? previewClip : clip))
				: [...trackClips, previewClip];
		}
		return trackClips.filter((clip) => clip.id !== draggedClip.id);
	}, [clipDragPreview, clipLookup, track.clipIds, track.id]);
	const projection = useMemo(() => projectClipsToViewport(clips, {
		viewportStartFrame,
		viewportDurationFrames,
	}), [clips, viewportDurationFrames, viewportStartFrame]);
	const windowLeft = framesToSeconds(projection.overscanStartFrame) * pixelsPerSecond;
	const windowFrames = Math.max(1, projection.overscanEndFrame - projection.overscanStartFrame);
	const windowWidth = Math.max(1, framesToSeconds(windowFrames) * pixelsPerSecond);
	const projectedClips = projection.clips.map((clip) => toDesignClip(controller, project, clip, projection.overscanStartFrame, pixelsPerSecond, selectedClipId));
	const projectedSelection = selection ? {
		startTime: selection.startTime - framesToSeconds(projection.overscanStartFrame),
		endTime: selection.endTime - framesToSeconds(projection.overscanStartFrame),
	} : null;
	const tabIndexFor = (offset) => isFlatNavigation ? 0 : trackBaseTabIndex + trackIndex * 4 + offset;

	useEffect(() => {
		const root = trackWindowRef.current;
		if (!root) return undefined;
		const normalize = () => normalizeClipSemantics(root, {
			flat: isFlatNavigation,
			tabIndex: tabIndexFor(2),
		});
		normalize();
		const observer = new MutationObserver(normalize);
		observer.observe(root, {
			attributes: true,
			attributeFilter: ['role', 'tabindex'],
			childList: true,
			subtree: true,
		});
		return () => observer.disconnect();
	}, [isFlatNavigation, projectedClips, trackBaseTabIndex, trackIndex]);
	const focusBeforeTrack = () => {
		if (trackIndex === 0) return onFocusTimelineRuler();
		const previousTrack = trackIndex - 1;
		if (onFocusTrackRuler(previousTrack)) return true;
		if (onFocusTrackClip(previousTrack, true)) return true;
		if (onFocusTrackPanelControl(previousTrack, true)) return true;
		return onFocusTrackContainer(previousTrack);
	};
	const focusAfterPanel = () => {
		if (onFocusTrackClip(trackIndex)) return true;
		return onFocusTrackRuler(trackIndex);
	};
	const focusBeforeRuler = () => {
		if (onFocusTrackClip(trackIndex, true)) return true;
		if (onFocusTrackPanelControl(trackIndex, true)) return true;
		return onFocusTrackContainer(trackIndex);
	};
	const focusAfterRuler = () => {
		if (trackIndex + 1 < trackCount) return onFocusTrackContainer(trackIndex + 1);
		return onFocusSelectionToolbar();
	};
	const moveClipBySeconds = (clipId, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const deltaFrames = secondsDeltaToFrames(deltaSeconds);
		if (!clip || !deltaFrames) return;
		run(() => controller.actions.clip.move(
			clip.id,
			track.id,
			Math.max(0, clip.timelineStartFrame + deltaFrames),
		));
	};
	const moveClipToTrack = (clipId, direction) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const targetTrackIndex = trackIndex + direction;
		const targetTrack = project.tracks[targetTrackIndex];
		if (!clip || !targetTrack) return;
		const moved = run(() => controller.actions.clip.move(clip.id, targetTrack.id, clip.timelineStartFrame));
		if (!moved) return;
		requestAnimationFrame(() => requestAnimationFrame(() => {
			onFocusTrackClip(targetTrackIndex, false, clip.id);
		}));
	};
	const navigateClipVertical = (clipId, direction) => {
		const sourceClip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		if (!sourceClip || trackCount < 2) return;
		for (let distance = 1; distance < trackCount; distance += 1) {
			const candidateIndex = (trackIndex + direction * distance + trackCount) % trackCount;
			const candidateClips = project.tracks[candidateIndex].clipIds
				.map((candidateId) => clipLookup.get(candidateId))
				.filter(Boolean);
			if (!candidateClips.length) continue;
			const closest = candidateClips.reduce((best, candidate) => (
				Math.abs(candidate.timelineStartFrame - sourceClip.timelineStartFrame)
					< Math.abs(best.timelineStartFrame - sourceClip.timelineStartFrame)
					? candidate
					: best
			));
			onFocusTrackClip(candidateIndex, false, closest.id);
			return;
		}
	};
	const trimClipBySeconds = (clipId, edge, deltaSeconds) => {
		if (blocked) return;
		const clip = clipLookup.get(String(clipId)) || clipLookup.get(clipId);
		const source = clip ? project.sources.find((item) => item.id === clip.sourceId) : null;
		const deltaFrames = secondsDeltaToFrames(deltaSeconds);
		if (!clip || !source || !deltaFrames) return;
		if (edge === 'left') {
			const sourceExtension = clip.reversed
				? source.frameCount - clip.sourceStartFrame - clip.durationFrames
				: clip.sourceStartFrame;
			const change = Math.max(
				-Math.min(clip.timelineStartFrame, sourceExtension),
				Math.min(clip.durationFrames - 1, deltaFrames),
			);
			if (!change) return;
			run(() => controller.actions.clip.trim(clip.id, {
				timelineStartFrame: clip.timelineStartFrame + change,
				sourceStartFrame: clip.sourceStartFrame + (clip.reversed ? 0 : change),
				durationFrames: clip.durationFrames - change,
			}));
			return;
		}
		const maximumDuration = clip.reversed
			? clip.sourceStartFrame + clip.durationFrames
			: source.frameCount - clip.sourceStartFrame;
		const nextDuration = Math.max(1, Math.min(maximumDuration, clip.durationFrames - deltaFrames));
		if (nextDuration === clip.durationFrames) return;
		run(() => controller.actions.clip.trim(clip.id, {
			sourceStartFrame: clip.reversed
				? clip.sourceStartFrame + clip.durationFrames - nextDuration
				: clip.sourceStartFrame,
			durationFrames: nextDuration,
		}));
	};

	return (
		<div
			className="audio-editor-track-row"
			data-track-row
			data-track-id={track.id}
			data-track-index={trackIndex}
			style={{ height: TRACK_HEIGHT }}
		>
			<TrackControls
				controller={controller}
				track={track}
				panelWidth={panelWidth}
				selected={selectedTrackId === track.id}
				blocked={blocked}
				showArmControls={showArmControls}
				isFlatNavigation={isFlatNavigation}
				copy={copy}
				run={run}
				onMenu={onMenu}
				onOpenEffects={onOpenEffects}
				onTabOut={focusAfterPanel}
				onShiftTabOut={() => onFocusTrackContainer(trackIndex)}
				onNavigateVertical={(direction) => {
					const targetIndex = trackIndex + (direction === 'down' ? 1 : -1);
					if (targetIndex >= 0 && targetIndex < trackCount) {
						onFocusTrackPanelControl(targetIndex);
					}
				}}
			/>
			<div
				className="audio-editor-track-lane"
				data-track-lane
				data-track-id={track.id}
				aria-label={track.name}
				data-selected={selectedTrackId === track.id}
				style={{ marginLeft: panelWidth, width: timelineWidth + VERTICAL_RULER_WIDTH, height: TRACK_HEIGHT }}
				onClick={(event) => {
					if (event.target.closest('[data-clip-id]')) return;
					run(() => controller.actions.timeline.selectTrack(track.id));
				}}
			>
				<div
					ref={trackWindowRef}
					className="audio-editor-track-window"
					style={{ left: windowLeft, width: windowWidth }}
					onFocusCapture={(event) => {
						if (isFlatNavigation || !event.target.matches?.('[data-clip-id][role="group"]')) return;
						for (const clip of clipGroups(trackWindowRef.current)) clip.tabIndex = -1;
						event.target.tabIndex = tabIndexFor(2);
					}}
					onKeyDownCapture={(event) => {
						if (
							!event.target.matches?.('[data-clip-id][role="group"]')
							|| event.altKey
							|| event.ctrlKey
							|| event.metaKey
							|| event.shiftKey
							|| (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
						) return;
						const clips = clipGroups(trackWindowRef.current);
						const currentIndex = clips.indexOf(event.target);
						if (currentIndex < 0 || clips.length < 2) return;
						event.preventDefault();
						event.stopPropagation();
						const direction = event.key === 'ArrowRight' ? 1 : -1;
						const next = clips[(currentIndex + direction + clips.length) % clips.length];
						if (!isFlatNavigation) {
							for (const clip of clips) clip.tabIndex = clip === next ? tabIndexFor(2) : -1;
						}
						focusFirst(next);
					}}
				>
					<TrackNew
						clips={projectedClips}
						height={TRACK_HEIGHT}
						trackIndex={trackIndex}
						isSelected={selectedTrackId === track.id}
						isMuted={track.mute}
						pixelsPerSecond={pixelsPerSecond}
						width={windowWidth}
						spectrogramMode={timelineView === 'spectrogram'}
						timeSelection={projectedSelection}
						clipStyle="colourful"
						draggingClipIds={draggingClipId ? new Set([draggingClipId]) : undefined}
						tabIndex={tabIndexFor(2)}
						trackTabIndex={tabIndexFor(0)}
						onTrackNavigateVertical={(direction) => {
							const targetIndex = trackIndex + direction;
							if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackContainer(targetIndex);
						}}
						onContainerFocusChange={(hasFocus) => {
							if (hasFocus && selectedTrackId !== track.id) {
								run(() => controller.actions.timeline.selectTrack(track.id));
							}
						}}
						onEnterPanel={() => onFocusTrackPanelControl(trackIndex)}
						onShiftTabOut={focusBeforeTrack}
						onContainerEnter={() => run(() => controller.actions.timeline.selectTrack(track.id))}
						onTabFromLastClip={() => onFocusTrackRuler(trackIndex)}
						onClipClick={(clipId) => run(() => controller.actions.timeline.selectClip(String(clipId)))}
						onClipHeaderClick={(clipId) => run(() => controller.actions.timeline.selectClip(String(clipId)))}
						onClipMenuClick={onOpenClipMenu}
						onClipTrimEdge={() => {
							// Pointer geometry is committed by the frame-canonical adapter on pointer-up.
						}}
						onClipMove={moveClipBySeconds}
						onClipMoveToTrack={moveClipToTrack}
						onClipNavigateVertical={navigateClipVertical}
						onClipTrim={trimClipBySeconds}
					/>
				</div>
				<div
					className="audio-editor-vertical-ruler"
					data-track-ruler
					role="region"
					aria-label={`${track.name}: ${timelineView === 'spectrogram' ? copy.spectrogramView : copy.waveformView}`}
					tabIndex={tabIndexFor(3)}
					onKeyDown={(event) => {
						if (event.key === 'Tab') {
							event.preventDefault();
							if (event.shiftKey) focusBeforeRuler();
							else focusAfterRuler();
						} else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
							event.preventDefault();
							const targetIndex = trackIndex + (event.key === 'ArrowDown' ? 1 : -1);
							if (targetIndex >= 0 && targetIndex < trackCount) onFocusTrackRuler(targetIndex);
						} else if (event.key === 'Escape') {
							event.preventDefault();
							onFocusTrackContainer(trackIndex);
						}
					}}
				>
					<VerticalRuler height={TRACK_HEIGHT} min={-1} max={1} majorDivisions={3} minorDivisions={1} width={VERTICAL_RULER_WIDTH} />
				</div>
			</div>
		</div>
	);
}

function TrackControls({
	controller,
	track,
	panelWidth,
	selected,
	blocked,
	showArmControls,
	isFlatNavigation,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onTabOut,
	onShiftTabOut,
	onNavigateVertical,
}) {
	const telemetry = useAudioEditorTelemetry(controller);
	const controlsRef = useRef(null);
	const meter = telemetry.meters?.tracks?.[track.id];
	const meterVolume = meterPercent(meter?.dbfs);
	const focusAdapterControl = (last = false) => focusCandidate(
		controlsRef.current?.querySelector('.audio-editor-track-adapters'),
		'input:not([disabled]), button:not([disabled])',
		last,
	);

	useEffect(() => {
		const adapters = controlsRef.current?.querySelectorAll(
			'.audio-editor-track-adapters input:not([disabled]), .audio-editor-track-adapters button:not([disabled])',
		);
		for (const adapter of adapters || []) adapter.tabIndex = isFlatNavigation ? 0 : -1;
	}, [blocked, isFlatNavigation, track.id]);

	return (
		<div ref={controlsRef} className="audio-editor-track-controls" data-track-header style={{ width: panelWidth }}>
			<TrackControlPanel
				trackName={track.name}
				trackType="stereo"
				volume={gainDbToDesignVolume(linearToDb(track.gain))}
				pan={panToDesignValue(track.pan)}
				isMuted={track.mute}
				isSolo={track.solo}
				isFocused={selected}
				height={panelWidth <= COMPACT_TRACK_PANEL_WIDTH ? 'truncated' : 'default'}
				trackHeight={TRACK_HEIGHT}
				meterLevelLeft={meterVolume}
				meterLevelRight={meterVolume}
				meterClippedLeft={(meter?.peak || 0) >= 1}
				meterClippedRight={(meter?.peak || 0) >= 1}
				tabIndex={-1}
				onTabOut={() => {
					if (!focusAdapterControl()) onTabOut?.();
				}}
				onShiftTabOut={onShiftTabOut}
				onNavigateVertical={onNavigateVertical}
				onVolumeChange={(volume) => !blocked && run(() => controller.actions.track.update(track.id, {
					gain: dbToLinear(designVolumeToGainDb(volume)),
				}))}
				onPanChange={(pan) => !blocked && run(() => controller.actions.track.update(track.id, { pan: designValueToPan(pan) }))}
				onMuteToggle={() => !blocked && run(() => controller.actions.track.update(track.id, { mute: !track.mute }))}
				onSoloToggle={() => !blocked && run(() => controller.actions.track.update(track.id, { solo: !track.solo }))}
				onEffectsClick={() => {
					if (!selected) run(() => controller.actions.timeline.selectTrack(track.id));
					onOpenEffects?.(track.id, controlsRef.current?.getBoundingClientRect() || null);
				}}
				onMenuClick={(event) => onMenu(event.currentTarget)}
				onClick={() => !selected && run(() => controller.actions.timeline.selectTrack(track.id))}
			/>
			<div className="audio-editor-track-adapters" onKeyDownCapture={(event) => {
				if (event.key !== 'Tab') return;
				const adapters = [...event.currentTarget.querySelectorAll('input:not([disabled]), button:not([disabled])')];
				const currentIndex = adapters.indexOf(document.activeElement);
				if (currentIndex < 0) return;
				event.preventDefault();
				event.stopPropagation();
				if (event.shiftKey) {
					if (currentIndex > 0) focusFirst(adapters[currentIndex - 1]);
					else if (!focusPanelControl(controlsRef.current?.querySelector('.track-control-panel'), true)) onShiftTabOut?.();
				} else if (currentIndex < adapters.length - 1) {
					focusFirst(adapters[currentIndex + 1]);
				} else {
					onTabOut?.();
				}
			}}>
				<TrackNameEditor track={track} label={copy.trackName} blocked={blocked} controller={controller} run={run} />
				{showArmControls && (
					<span data-track-action="arm">
						<ToggleToolButton
							icon="record"
							isActive={track.armed}
							disabled={blocked}
							ariaLabel={`${copy.arm}: ${track.name}`}
							onClick={() => run(() => controller.actions.track.update(track.id, { armed: !track.armed }))}
						/>
					</span>
				)}
			</div>
		</div>
	);
}

function TrackNameEditor({ track, label, blocked, controller, run }) {
	const [name, setName] = useState(track.name);
	useEffect(() => setName(track.name), [track.name]);
	const commit = () => {
		const nextName = name.trim();
		if (!nextName) {
			setName(track.name);
			return;
		}
		if (nextName !== track.name) run(() => controller.actions.track.update(track.id, { name: nextName }));
	};
	return (
		<label data-track-name onBlur={commit} onKeyDown={(event) => {
			if (event.key === 'Enter') {
				event.preventDefault();
				commit();
				event.currentTarget.querySelector('input')?.blur();
			} else if (event.key === 'Escape') {
				setName(track.name);
				event.currentTarget.querySelector('input')?.blur();
			}
		}}>
			<span className="kw-audio-editor-sr-only">{label}: {track.name}</span>
			<TextInput value={name} disabled={blocked} width="100%" onChange={setName} />
		</label>
	);
}

function toDesignClip(controller, project, clip, overscanStartFrame, pixelsPerSecond, selectedClipId) {
	const visual = controller.getClipVisualData(clip.id);
	const source = visual?.source || project.sources.find((item) => item.id === clip.sourceId);
	const output = {
		id: clip.id,
		name: source?.name || 'Clip',
		start: framesToSeconds(Math.max(0, Math.max(clip.timelineStartFrame, overscanStartFrame) - overscanStartFrame)),
		duration: Math.max(
			framesToSeconds(clip.waveformEndFrame - clip.waveformStartFrame),
			MINIMUM_VISIBLE_CLIP_PIXELS / pixelsPerSecond,
		),
		selected: selectedClipId === clip.id,
		trimStart: framesToSeconds(clip.waveformStartFrame),
		fullDuration: framesToSeconds(clip.durationFrames),
	};
	if (!visual?.buffer || !clip.isVisible) return output;
	try {
		const channels = Array.from(
			{ length: visual.buffer.numberOfChannels },
			(_, channel) => visual.buffer.getChannelData(channel),
		);
		const maximumSamples = Math.max(32, Math.min(4096, Math.ceil(clip.duration * pixelsPerSecond * 2)));
		const waveform = prepareBoundedWaveformWindow(channels, clip, {
			startFrame: clip.waveformStartFrame,
			endFrame: clip.waveformEndFrame,
			maxSamples: maximumSamples,
		});
		if (waveform.channels.length > 1) {
			output.waveformLeft = [...waveform.channels[0]];
			output.waveformRight = [...waveform.channels[1]];
		} else {
			output.waveform = [...waveform.channels[0]];
		}
	} catch {
		// The source may still be loading. TrackNew renders a bounded placeholder.
	}
	return output;
}

function trackNavigationRow(root, trackIndex) {
	return root?.querySelector(`.audio-editor-track-row[data-track-index="${trackIndex}"]`) || null;
}

function clipGroups(root) {
	return [...(root?.querySelectorAll('[data-clip-id][role="group"]') || [])];
}

function normalizeClipSemantics(root, { flat, tabIndex }) {
	const clips = [...root.querySelectorAll('[data-clip-id]')]
		.filter((element) => element.parentElement?.closest('[data-clip-id]') === null);
	const activeClip = clips.includes(document.activeElement) ? document.activeElement : null;
	clips.forEach((clip, index) => {
		if (clip.getAttribute('role') !== 'group') clip.setAttribute('role', 'group');
		const nextTabIndex = flat ? 0 : clip === activeClip || (!activeClip && index === 0) ? tabIndex : -1;
		if (clip.tabIndex !== nextTabIndex) clip.tabIndex = nextTabIndex;
		for (const control of clip.querySelectorAll('button, input, select, textarea, [role="button"]')) {
			if (control.tabIndex !== -1) control.tabIndex = -1;
		}
	});
}

function focusPanelControl(panel, last = false) {
	return focusCandidate(
		panel,
		'button:not([disabled]):not([aria-label="Track icon"]), input:not([disabled]), [role="slider"]:not([aria-disabled="true"])',
		last,
	) || focusFirst(panel);
}

function focusCandidate(root, selector, last = false) {
	const candidates = [...(root?.querySelectorAll(selector) || [])]
		.filter((element) => element.getAttribute('aria-disabled') !== 'true');
	if (last) candidates.reverse();
	for (const candidate of candidates) {
		if (focusFirst(candidate)) return true;
	}
	return false;
}

function focusFirst(element) {
	if (!element || typeof element.focus !== 'function') return false;
	try {
		element.focus({ preventScroll: true });
	} catch {
		element.focus();
	}
	if (document.activeElement !== element) return false;
	element.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
	return true;
}

function secondsDeltaToFrames(seconds) {
	const value = Number(seconds);
	if (!Number.isFinite(value) || value === 0) return 0;
	return secondsToFrames(Math.abs(value)) * Math.sign(value);
}

function linearToDb(value) {
	const number = Number(value);
	return number > 0 ? Math.max(-60, Math.min(12, 20 * Math.log10(number))) : -60;
}

function dbToLinear(value) {
	const db = Math.max(-60, Math.min(12, Number(value) || 0));
	return 10 ** (db / 20);
}

function meterPercent(dbfs) {
	const value = Number.isFinite(dbfs) ? dbfs : -60;
	return (Math.max(-60, Math.min(0, value)) + 60) / 60 * 100;
}
