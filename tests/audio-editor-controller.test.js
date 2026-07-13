import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const assetLoader = `
	export async function resolve(specifier, context, nextResolve) {
		if (specifier === '@ffmpeg/core?url' || specifier === '@ffmpeg/core/wasm?url') {
			return {
				url: 'data:text/javascript,export default "mock-ffmpeg-asset"',
				shortCircuit: true,
			};
		}
		return nextResolve(specifier, context);
	}
`;

register(`data:text/javascript,${encodeURIComponent(assetLoader)}`, import.meta.url);

const { createAudioEditorController } = await import('../src/lib/tools/audio-editor/app.js');

const COPY = Object.freeze({
	ready: 'Ready',
	untitledProject: 'Untitled project',
	track: 'Track',
	projectSaving: 'Saving',
	projectSaved: 'Saved',
	projectDirty: 'Unsaved',
	storage: 'Storage',
	genericError: 'Error: {message}',
});

test('headless audio editor exposes cached snapshots, subscriptions, and frame-accurate grouped actions', async () => {
	const store = createMemoryStore();
	const engine = createMemoryEngine();
	const ffmpeg = createMemoryFfmpeg();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine,
		ffmpeg,
	});

	const readySnapshot = await controller.ready;
	assert.equal(readySnapshot.ready, true);
	assert.equal(readySnapshot.phase, 'ready');
	assert.equal(readySnapshot.headless, true);
	assert.equal(readySnapshot.project.sampleRate, 48_000);
	assert.equal(readySnapshot.project.tracks.length, 1);
	assert.strictEqual(controller.getSnapshot(), readySnapshot);
	assert.strictEqual(controller.getSnapshot(), controller.getSnapshot());
	assert.strictEqual(controller.getTelemetrySnapshot(), controller.getTelemetrySnapshot());

	assert.deepEqual(Object.keys(controller.actions), [
		'project', 'edit', 'transport', 'recording', 'timeline',
		'track', 'clip', 'effects', 'analysis', 'export',
	]);

	let documentNotifications = 0;
	let telemetryNotifications = 0;
	const unsubscribeDocument = controller.subscribe(() => { documentNotifications += 1; });
	const unsubscribeTelemetry = controller.subscribeTelemetry(() => { telemetryNotifications += 1; });

	controller.actions.edit.copy();
	const errorSnapshot = controller.getSnapshot();
	assert.equal(errorSnapshot.status.state, 'error');
	assert.match(errorSnapshot.status.message, /Create a time selection first/);
	assert.notStrictEqual(errorSnapshot, readySnapshot);

	const originalTrackId = errorSnapshot.project.tracks[0].id;
	controller.actions.edit.commit({
		type: 'batch',
		commands: [
			{
				type: 'source/add',
				source: {
					id: 'source-controller-test',
					name: 'fixture.wav',
					storageKey: 'source-controller-test',
					mimeType: 'audio/wav',
					frameCount: 144_000,
					channelCount: 2,
				},
			},
			{
				type: 'clip/add',
				trackId: originalTrackId,
				clip: {
					id: 'clip-controller-test',
					sourceId: 'source-controller-test',
					timelineStartFrame: 0,
					sourceStartFrame: 0,
					durationFrames: 144_000,
				},
			},
		],
	});

	controller.actions.timeline.setSelection(48_000, 96_000);
	assert.deepEqual(controller.getSnapshot().selection, { startFrame: 48_000, endFrame: 96_000 });
	assert.deepEqual(controller.getSnapshot().project.selection, { startFrame: 48_000, endFrame: 96_000 });

	const addedTrackId = controller.actions.track.add({ name: 'Dialogue', armed: false });
	controller.actions.track.update(addedTrackId, { name: 'Voice', gain: 0.5, pan: -0.25 });
	controller.actions.timeline.selectTrack(addedTrackId);
	const changedSnapshot = controller.getSnapshot();
	assert.equal(changedSnapshot.selectedTrackId, addedTrackId);
	const changedTrack = changedSnapshot.project.tracks.find((track) => track.id === addedTrackId);
	assert.equal(changedTrack.name, 'Voice');
	assert.equal(changedTrack.gain, 0.5);
	assert.equal(changedTrack.pan, -0.25);

	engine.positionFrame = 72_000;
	controller.actions.track.update(addedTrackId, { mute: true });
	assert.equal(controller.getTelemetrySnapshot().positionFrame, 72_000);
	assert.ok(documentNotifications > 0);
	assert.ok(telemetryNotifications > 0);

	const notificationsBeforeUnsubscribe = {
		document: documentNotifications,
		telemetry: telemetryNotifications,
	};
	unsubscribeDocument();
	unsubscribeTelemetry();
	controller.actions.track.update(addedTrackId, { mute: false });
	assert.deepEqual(
		{ document: documentNotifications, telemetry: telemetryNotifications },
		notificationsBeforeUnsubscribe,
	);

	await controller.actions.project.save();
	assert.equal(store.projects.get(changedSnapshot.project.id)?.sampleRate, 48_000);
	assert.ok(engine.appliedProjects.length >= 1);

	await controller.dispose();
});

test('headless controller publishes disposal once and closes injected runtimes', async () => {
	const store = createMemoryStore();
	const engine = createMemoryEngine();
	const ffmpeg = createMemoryFfmpeg();
	const controller = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		store,
		engine,
		ffmpeg,
	});
	await controller.ready;

	let notifications = 0;
	controller.subscribe(() => { notifications += 1; });
	await controller.dispose();
	const disposed = controller.getSnapshot();
	assert.equal(disposed.phase, 'disposed');
	assert.equal(disposed.ready, false);
	assert.equal(disposed.disposed, true);
	assert.equal(notifications, 1);
	assert.equal(store.closeCalls, 1);
	assert.equal(engine.disposeCalls, 1);
	assert.equal(ffmpeg.disposeCalls, 1);

	await controller.dispose();
	assert.equal(notifications, 1);
	assert.equal(store.closeCalls, 1);
	assert.equal(engine.disposeCalls, 1);
	assert.equal(ffmpeg.disposeCalls, 1);
	assert.strictEqual(controller.getSnapshot(), disposed);
});

test('bootstrap preserves the project-lock status for a second controller', async () => {
	const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const heldLocks = new Set();
	const locks = {
		request(name, options, callback) {
			assert.equal(options.ifAvailable, true);
			if (heldLocks.has(name)) return Promise.resolve(callback(null));
			heldLocks.add(name);
			return Promise.resolve(callback({ name })).finally(() => heldLocks.delete(name));
		},
	};
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: { locks },
	});

	const store = createMemoryStore();
	const first = createAudioEditorController(null, {
		headless: true,
		copy: COPY,
		locale: 'en',
		store,
		engine: createMemoryEngine(),
		ffmpeg: createMemoryFfmpeg(),
	});
	let second;
	try {
		await first.ready;
		second = createAudioEditorController(null, {
			headless: true,
			copy: COPY,
			locale: 'en',
			store,
			engine: createMemoryEngine(),
			ffmpeg: createMemoryFfmpeg(),
		});
		const snapshot = await second.ready;
		assert.equal(snapshot.ready, true);
		assert.equal(snapshot.readOnly, true);
		assert.equal(snapshot.status.state, 'error');
		assert.equal(snapshot.status.message, 'This project is already open in another tab.');
	} finally {
		await second?.dispose();
		await first.dispose();
		if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
		else delete globalThis.navigator;
	}
});

function createMemoryStore() {
	const projects = new Map();
	const settings = new Map();
	return {
		projects,
		settings,
		closeCalls: 0,
		async ready() { return this; },
		async cleanupTemporaryAssets() {},
		async requestPersistentStorage() { return false; },
		async loadSetting(key, fallback) { return settings.has(key) ? settings.get(key) : fallback; },
		async saveSetting(key, value) { settings.set(key, structuredClone(value)); },
		async saveProject(project) {
			projects.set(project.id, structuredClone(project));
			return structuredClone(project);
		},
		async loadProject(projectId) {
			const project = projects.get(projectId);
			return project ? structuredClone(project) : null;
		},
		async listProjects() { return [...projects.values()].map((project) => structuredClone(project)); },
		async duplicateProject(projectId, options = {}) {
			const source = projects.get(projectId);
			const copy = { ...structuredClone(source), id: options.id || `${projectId}-copy`, title: options.title || `${source.title} copy` };
			projects.set(copy.id, structuredClone(copy));
			return copy;
		},
		async deleteProject(projectId) { projects.delete(projectId); },
		async clear() { projects.clear(); settings.clear(); },
		async pruneUnreferencedSources() { return { deletedSourceIds: [] }; },
		async estimateStorage() { return { usage: 0, quota: 64 * 1024 * 1024 }; },
		async close() { this.closeCalls += 1; },
	};
}

function createMemoryEngine() {
	return {
		positionFrame: 0,
		state: 'stopped',
		loadedProjects: [],
		appliedProjects: [],
		disposeCalls: 0,
		loadProject(project) { this.loadedProjects.push(structuredClone(project)); },
		async applyProject(project) { this.appliedProjects.push(structuredClone(project)); },
		getPositionFrames() { return this.positionFrame; },
		getState() { return { state: this.state, loop: { enabled: false } }; },
		stop() { this.state = 'stopped'; },
		play() { this.state = 'playing'; },
		pause() { this.state = 'paused'; },
		seek(frame) { this.positionFrame = Math.max(0, Math.round(frame)); return this.positionFrame; },
		setLoop() {},
		async dispose() { this.disposeCalls += 1; },
	};
}

function createMemoryFfmpeg() {
	return {
		disposeCalls: 0,
		dispose() { this.disposeCalls += 1; },
	};
}
