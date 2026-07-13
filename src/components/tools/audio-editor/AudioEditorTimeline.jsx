import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
	ContextMenu,
	ContextMenuItem,
	Menu,
	PlayheadCursor,
	TextInput,
	TimelineRuler,
	ToggleToolButton,
	TrackControlPanel,
	TrackNew,
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

const DESKTOP_TRACK_PANEL_WIDTH = 228;
const COMPACT_TRACK_PANEL_WIDTH = 164;
const TRACK_HEIGHT = 144;
const MINIMUM_TIMELINE_SECONDS = 10;
const MINIMUM_VISIBLE_CLIP_PIXELS = 48;

export default function AudioEditorTimeline({
	controller,
	snapshot,
	copy,
	mobile,
	onError,
	onOpenEffects,
	onOpenClipProperties,
}) {
	const project = snapshot.project;
	const [timelineRef, timelineSize] = useElementSize();
	const scrollRef = useRef(null);
	const pointerSession = useRef(null);
	const touchPointers = useRef(new Map());
	const pinchSession = useRef(null);
	const [scrollX, setScrollX] = useState(0);
	const [selectionPreview, setSelectionPreview] = useState(null);
	const [trackMenu, setTrackMenu] = useState(null);
	const [clipMenu, setClipMenu] = useState(null);
	const [draggingClipId, setDraggingClipId] = useState(null);
	const panelWidth = mobile ? COMPACT_TRACK_PANEL_WIDTH : DESKTOP_TRACK_PANEL_WIDTH;
	const viewportWidth = Math.max(1, timelineSize.width - panelWidth);
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

	const finishPointerSession = useCallback((event, cancelled = false) => {
		const session = pointerSession.current;
		pointerSession.current = null;
		setDraggingClipId(null);
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
			const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-track-lane]');
			const targetTrackId = target?.dataset.trackId || session.trackId;
			run(() => controller.actions.clip.move(
				clip.id,
				targetTrackId,
				Math.max(0, session.original.timelineStartFrame + deltaFrames),
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
			run(() => controller.actions.clip.trim(clip.id, {
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
			run(() => controller.actions.clip.trim(clip.id, {
				sourceStartFrame: session.original.reversed
					? session.original.sourceStartFrame + session.original.durationFrames - nextDuration
					: session.original.sourceStartFrame,
				durationFrames: nextDuration,
			}));
		}
	}, [controller, frameAtClientX, pixelsPerSecond, project, run]);

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
		}
	}, [controller, frameAtClientX, panelWidth, run]);

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
			ref={timelineRef}
			style={{ '--track-panel-width': `${panelWidth}px` }}
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
				<div className="audio-editor-timeline-inner" style={{ width: panelWidth + timelineWidth }}>
					<div className="audio-editor-ruler-row">
						<div className="audio-editor-ruler-corner" style={{ width: panelWidth }}>{copy.tracks}</div>
						<div
							className="audio-editor-ruler-viewport"
							data-ruler
							data-ruler-interaction
							data-track-lane
							data-track-id={snapshot.selectedTrackId || project.tracks[0]?.id || ''}
							style={{ left: panelWidth, width: viewportWidth }}
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
					</div>

					<div className="audio-editor-track-list" data-track-list>
						{project.tracks.map((track, trackIndex) => (
							<TrackRow
								key={track.id}
								controller={controller}
								project={project}
								track={track}
								trackIndex={trackIndex}
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
								blocked={snapshot.readOnly || snapshot.importing || snapshot.recording || snapshot.recordingStarting || snapshot.exporting || snapshot.processingEffect}
								copy={copy}
								run={run}
								onMenu={(anchor) => setTrackMenu({ trackId: track.id, anchor })}
								onOpenEffects={onOpenEffects}
								onOpenClipMenu={openClipMenu}
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
				items={menuTrack ? [
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
	blocked,
	copy,
	run,
	onMenu,
	onOpenEffects,
	onOpenClipMenu,
}) {
	const trackWindowRef = useRef(null);
	const clipLookup = useMemo(() => new Map(project.clips.map((clip) => [clip.id, clip])), [project.clips]);
	const clips = track.clipIds.map((clipId) => clipLookup.get(clipId)).filter(Boolean);
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

	useEffect(() => {
		const windowElement = trackWindowRef.current;
		if (!windowElement) return undefined;
		const exposeClipGroups = () => {
			for (const clipElement of windowElement.querySelectorAll('[data-clip-id][role="button"]')) {
				// TrackNew's outer clip wrapper contains its own header, menu and trim
				// controls. A group preserves the package keyboard handler without
				// exposing invalid nested buttons to assistive technology.
				clipElement.setAttribute('role', 'group');
			}
		};
		exposeClipGroups();
		const observer = new MutationObserver(exposeClipGroups);
		observer.observe(windowElement, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['role'],
		});
		return () => observer.disconnect();
	}, [projectedClips]);

	return (
		<div className="audio-editor-track-row" data-track-row data-track-id={track.id} style={{ height: TRACK_HEIGHT }}>
			<TrackControls
				controller={controller}
				track={track}
				panelWidth={panelWidth}
				selected={selectedTrackId === track.id}
				blocked={blocked}
				copy={copy}
				run={run}
				onMenu={onMenu}
				onOpenEffects={onOpenEffects}
			/>
			<div
				className="audio-editor-track-lane"
				data-track-lane
				data-track-id={track.id}
				aria-label={track.name}
				data-selected={selectedTrackId === track.id}
				style={{ marginLeft: panelWidth, width: timelineWidth, height: TRACK_HEIGHT }}
				onClick={(event) => {
					if (event.target.closest('[data-clip-id]')) return;
					run(() => controller.actions.timeline.selectTrack(track.id));
				}}
			>
				<div className="audio-editor-vertical-ruler">
					<VerticalRuler height={TRACK_HEIGHT} min={-1} max={1} majorDivisions={3} minorDivisions={1} width={30} />
				</div>
				<div ref={trackWindowRef} className="audio-editor-track-window" style={{ left: windowLeft, width: windowWidth }}>
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
						tabIndex={0}
						onClipClick={(clipId) => run(() => controller.actions.timeline.selectClip(String(clipId)))}
						onClipHeaderClick={(clipId) => run(() => controller.actions.timeline.selectClip(String(clipId)))}
						onClipMenuClick={onOpenClipMenu}
						onClipTrimEdge={() => {
							// Pointer geometry is committed by the frame-canonical adapter on pointer-up.
						}}
						onClipMove={() => {
							// Pointer geometry is committed by the frame-canonical adapter on pointer-up.
						}}
						onClipTrim={() => {
							// Pointer geometry is committed by the frame-canonical adapter on pointer-up.
						}}
					/>
				</div>
			</div>
		</div>
	);
}

function TrackControls({ controller, track, panelWidth, selected, blocked, copy, run, onMenu, onOpenEffects }) {
	const telemetry = useAudioEditorTelemetry(controller);
	const controlsRef = useRef(null);
	const meter = telemetry.meters?.tracks?.[track.id];
	const meterVolume = meterPercent(meter?.dbfs);
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
			<div className="audio-editor-track-adapters">
				<TrackNameEditor track={track} label={copy.trackName} blocked={blocked} controller={controller} run={run} />
				<span data-track-action="arm">
					<ToggleToolButton
						icon="record"
						isActive={track.armed}
						disabled={blocked}
						ariaLabel={`${copy.arm}: ${track.name}`}
						onClick={() => run(() => controller.actions.track.update(track.id, { armed: !track.armed }))}
					/>
				</span>
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
