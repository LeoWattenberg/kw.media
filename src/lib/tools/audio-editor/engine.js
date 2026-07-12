import { rackTailFrames } from './effects.js';
export { createRecordingController, requestMicrophone } from './recording.js';

const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_METER_INTERVAL = 50;
const MAX_EFFECT_TAIL_SECONDS = 10;
const dynamicsWorkletContexts = new WeakSet();

export function isAudioEditorEngineSupported() {
	return Boolean(getAudioContextConstructor());
}

/** @returns {WebAudioEditorEngine} */
export function createAudioEditorEngine(options = {}) {
	return new WebAudioEditorEngine(options);
}

/**
 * Repository-owned Web Audio transport. The canonical project stays external;
 * this adapter only schedules the supplied immutable snapshot and buffers.
 */
export class WebAudioEditorEngine {
	constructor({
		audioContextFactory,
		offlineAudioContextFactory,
		softwareRenderer,
		onPosition,
		onMeter,
		onState,
		meterInterval = DEFAULT_METER_INTERVAL,
	} = {}) {
		this.audioContextFactory = audioContextFactory || getAudioContextConstructor();
		this.offlineAudioContextFactory = offlineAudioContextFactory || getOfflineAudioContextConstructor();
		this.softwareRenderer = softwareRenderer;
		this.project = null;
		this.sources = new Map();
		this.context = null;
		this.positionFrame = 0;
		this.playbackStartFrame = 0;
		this.playbackStartTime = 0;
		this.durationFrames = 0;
		this.playEndFrame = 0;
		this.loopScheduleTime = 0;
		this.state = 'empty';
		this.loop = { enabled: false, startFrame: 0, endFrame: 0 };
		this.graph = null;
		this.ticker = null;
		this.meterInterval = Math.max(16, Number(meterInterval) || DEFAULT_METER_INTERVAL);
		this.reversedBuffers = new WeakMap();
		this.positionListeners = new Set(onPosition ? [onPosition] : []);
		this.meterListeners = new Set(onMeter ? [onMeter] : []);
		this.stateListeners = new Set(onState ? [onState] : []);
	}

	loadProject(project, sourceBuffers = new Map()) {
		this.#haltGraph();
		this.project = project || null;
		this.sources = sourceBuffers instanceof Map ? new Map(sourceBuffers) : new Map(Object.entries(sourceBuffers || {}));
		this.durationFrames = getProjectDurationFrames(project);
		this.positionFrame = Math.min(this.positionFrame, this.durationFrames);
		this.playEndFrame = this.durationFrames;
		this.loop = normalizeLoop(project?.loop, this.durationFrames);
		this.#setState(project ? 'stopped' : 'empty');
		this.#emitPosition();
		return this;
	}

	applyProject(project, sourceBuffers = this.sources) {
		const wasPlaying = this.state === 'playing';
		const position = this.getPositionFrames();
		this.loadProject(project, sourceBuffers);
		this.positionFrame = Math.min(position, this.durationFrames);
		if (wasPlaying) return this.play();
		this.#emitPosition();
		return Promise.resolve();
	}

	async decodeAudioData(data) {
		const context = await this.getAudioContext({ resume: false });
		if (!context?.decodeAudioData) throw new Error('This AudioContext cannot decode audio.');
		const arrayBuffer = data instanceof ArrayBuffer ? data : await data.arrayBuffer();
		return context.decodeAudioData(arrayBuffer);
	}

	/** Return the editor-owned 48 kHz context; transport/recording opt into resume. */
	async getAudioContext({ resume = true } = {}) {
		const context = await this.#getContext();
		if (resume) await context.resume?.();
		return context;
	}

	async play() {
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		if (this.state === 'playing') return;
		const context = await this.getAudioContext();
		await ensureProjectWorklets(context, this.project);
		if (this.positionFrame >= this.durationFrames) this.positionFrame = 0;
		if (this.loop.enabled && (this.positionFrame < this.loop.startFrame || this.positionFrame >= this.loop.endFrame)) this.positionFrame = this.loop.startFrame;
		this.#schedulePlayback(this.positionFrame, context.currentTime);
	}

	/** Schedule transport against an exact AudioContext time (used by punch recording). */
	async playAt(contextTime, fromFrame = this.positionFrame) {
		if (!this.project) throw new Error('Load an audio editor project before playback.');
		const context = await this.getAudioContext();
		await ensureProjectWorklets(context, this.project);
		const scheduledTime = Math.max(context.currentTime, Number(contextTime) || context.currentTime);
		this.positionFrame = clampFrame(fromFrame, 0, this.durationFrames);
		this.#schedulePlayback(this.positionFrame, scheduledTime);
	}

	pause() {
		if (this.state !== 'playing') return;
		this.positionFrame = this.getPositionFrames();
		this.#haltGraph();
		this.#setState('paused');
		this.#emitPosition();
	}

	stop() {
		this.#haltGraph();
		this.positionFrame = 0;
		this.#setState(this.project ? 'stopped' : 'empty');
		this.#emitPosition();
	}

	seek(frame) {
		const nextFrame = clampFrame(frame, 0, this.durationFrames);
		const wasPlaying = this.state === 'playing';
		this.#haltGraph();
		this.positionFrame = nextFrame;
		if (wasPlaying && nextFrame < this.durationFrames) this.#schedulePlayback(nextFrame);
		else {
			this.#setState(this.project ? 'paused' : 'empty');
			this.#emitPosition();
		}
		return this.positionFrame;
	}

	setLoop(loopOrEnabled, startFrame, endFrame) {
		const value = typeof loopOrEnabled === 'object'
			? loopOrEnabled
			: { enabled: loopOrEnabled, startFrame, endFrame };
		this.loop = normalizeLoop(value, this.durationFrames);
		if (this.state === 'playing') {
			const position = this.getPositionFrames();
			if (this.loop.enabled && (position < this.loop.startFrame || position >= this.loop.endFrame)) {
				this.seek(this.loop.startFrame);
			} else {
				this.#haltGraph();
				this.positionFrame = position;
				this.#schedulePlayback(position);
			}
		}
		return { ...this.loop };
	}

	getPositionFrames() {
		if (this.state !== 'playing' || !this.context) return this.positionFrame;
		if (this.context.currentTime <= this.playbackStartTime) return this.playbackStartFrame;
		const elapsedFrames = Math.floor((this.context.currentTime - this.playbackStartTime) * this.sampleRate);
		if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
			const initialFrames = Math.max(0, this.loop.endFrame - this.playbackStartFrame);
			if (elapsedFrames < initialFrames) return this.playbackStartFrame + elapsedFrames;
			const loopFrames = this.loop.endFrame - this.loop.startFrame;
			return this.loop.startFrame + ((elapsedFrames - initialFrames) % loopFrames);
		}
		return clampFrame(this.playbackStartFrame + elapsedFrames, 0, this.playEndFrame);
	}

	get sampleRate() {
		return positiveInteger(this.project?.sampleRate, DEFAULT_SAMPLE_RATE);
	}

	getState() {
		return {
			state: this.state,
			positionFrame: this.getPositionFrames(),
			durationFrames: this.durationFrames,
			loop: { ...this.loop },
		};
	}

	subscribePosition(listener) {
		if (typeof listener !== 'function') return () => {};
		this.positionListeners.add(listener);
		return () => this.positionListeners.delete(listener);
	}

	subscribeMeters(listener) {
		if (typeof listener !== 'function') return () => {};
		const needsMeterGraph = this.meterListeners.size === 0 && this.state === 'playing' && !this.graph?.masterAnalyser;
		this.meterListeners.add(listener);
		if (needsMeterGraph) {
			const position = this.getPositionFrames();
			this.positionFrame = position;
			this.#schedulePlayback(position);
		}
		return () => this.meterListeners.delete(listener);
	}

	subscribeState(listener) {
		if (typeof listener !== 'function') return () => {};
		this.stateListeners.add(listener);
		return () => this.stateListeners.delete(listener);
	}

	/**
	 * Render an authoritative mix using the same graph builder as live playback.
	 * @returns {Promise<AudioBuffer | { sampleRate: number, length: number, numberOfChannels: number, channels: Float32Array[] }>}
	 */
	async renderMix({
		startFrame = 0,
		endFrame = this.durationFrames,
		includeTail = false,
		trackId = null,
		includeMaster = true,
		respectMuteSolo = true,
		outputFrames: requestedOutputFrames = null,
		preRollFrames = 0,
	} = {}) {
		if (!this.project) throw new Error('Load an audio editor project before rendering.');
		const fromFrame = clampFrame(startFrame, 0, this.durationFrames);
		const toFrame = clampFrame(endFrame, fromFrame, this.durationFrames);
		const renderFromFrame = Math.max(0, fromFrame - clampFrame(preRollFrames, 0, fromFrame));
		const warmupFrames = fromFrame - renderFromFrame;
		const tailFrames = Math.round(resolveTailSeconds(this.project, includeTail, { trackId, includeMaster }) * this.sampleRate);
		const requestedLength = requestedOutputFrames == null
			? Math.max(1, toFrame - fromFrame + tailFrames)
			: positiveInteger(requestedOutputFrames, 1);
		const outputLength = warmupFrames + requestedLength;

		if (!this.offlineAudioContextFactory) {
			if (typeof this.softwareRenderer === 'function') {
				return this.softwareRenderer({
					project: this.project,
					sources: this.sources,
					startFrame: renderFromFrame,
					endFrame: toFrame,
					captureStartFrame: fromFrame,
					tailFrames,
					sampleRate: this.sampleRate,
					trackId,
					includeMaster,
					respectMuteSolo,
				});
			}
			throw new Error('OfflineAudioContext is not available in this browser.');
		}

		const context = createOfflineContext(this.offlineAudioContextFactory, 2, outputLength, this.sampleRate);
		await ensureProjectWorklets(context, this.project);
		const graph = buildProjectGraph(context, context.destination, this.project, {
			metering: false,
			respectMuteSolo,
			trackId,
			includeMaster,
		});
		scheduleProjectClips({
			context,
			project: this.project,
			sources: this.sources,
			trackInputs: graph.trackInputs,
			fromFrame: renderFromFrame,
			toFrame,
			contextStartTime: 0,
			sampleRate: this.sampleRate,
			reversedBuffers: this.reversedBuffers,
			activeSources: graph.sources,
			allNodes: graph.nodes,
		});
		try {
			const rendered = await context.startRendering();
			return warmupFrames ? sliceAudioBuffer(context, rendered, warmupFrames, requestedLength) : rendered;
		} finally {
			disposeGraph(graph, false);
		}
	}

	/** Stream a memory-safe 1× render through the same realtime graph. */
	async renderMixRealtime({
		startFrame = 0,
		endFrame = this.durationFrames,
		includeTail = false,
		trackId = null,
		includeMaster = true,
		respectMuteSolo = true,
		sampleRate = this.sampleRate,
		outputFrames: requestedOutputFrames = null,
		preRollFrames = 0,
		chunkFrames = 4096,
		onChunk,
		signal,
	} = {}) {
		if (!this.project) throw new Error('Load an audio editor project before rendering.');
		if (typeof onChunk !== 'function') throw new TypeError('Realtime rendering requires an onChunk callback.');
		if (signal?.aborted) throw createAbortError();
		const Context = getAudioContextConstructor();
		if (!Context || typeof globalThis.AudioWorkletNode !== 'function') {
			throw new Error('Realtime AudioWorklet rendering is not supported in this browser.');
		}
		const fromFrame = clampFrame(startFrame, 0, this.durationFrames);
		const toFrame = clampFrame(endFrame, fromFrame, this.durationFrames);
		const renderFromFrame = Math.max(0, fromFrame - clampFrame(preRollFrames, 0, fromFrame));
		const warmupProjectFrames = fromFrame - renderFromFrame;
		const tailFrames = Math.round(resolveTailSeconds(this.project, includeTail, { trackId, includeMaster }) * this.sampleRate);
		const context = createRealtimeContext(Context, positiveInteger(sampleRate, this.sampleRate));
		if (!context.audioWorklet?.addModule) {
			await context.close?.();
			throw new Error('Realtime AudioWorklet rendering is not supported in this browser.');
		}
		await context.audioWorklet.addModule(new URL('./render-capture-worklet.js', import.meta.url));
		await ensureProjectWorklets(context, this.project);
		const outputFrames = requestedOutputFrames == null
			? Math.max(1, Math.round((toFrame - fromFrame + tailFrames) / this.sampleRate * context.sampleRate))
			: positiveInteger(requestedOutputFrames, 1);
		const startTime = context.currentTime + 0.08;
		const warmupContextFrames = Math.round(warmupProjectFrames / this.sampleRate * context.sampleRate);
		const capture = new globalThis.AudioWorkletNode(context, 'kw-audio-render-capture', {
			numberOfInputs: 1,
			numberOfOutputs: 1,
			outputChannelCount: [2],
			processorOptions: {
				startFrame: Math.ceil(startTime * context.sampleRate) + warmupContextFrames,
				totalFrames: outputFrames,
				chunkFrames: Math.max(128, Math.min(16_384, Math.floor(chunkFrames))),
			},
		});
		const silent = context.createGain();
		silent.gain.value = 0;
		capture.connect(silent);
		silent.connect(context.destination);
		const graph = buildProjectGraph(context, capture, this.project, { metering: false, respectMuteSolo, trackId, includeMaster });
		scheduleProjectClips({
			context,
			project: this.project,
			sources: this.sources,
			trackInputs: graph.trackInputs,
			fromFrame: renderFromFrame,
			toFrame,
			contextStartTime: startTime,
			sampleRate: this.sampleRate,
			reversedBuffers: this.reversedBuffers,
			activeSources: graph.sources,
			allNodes: graph.nodes,
		});

		let writeQueue = Promise.resolve();
		let pendingChunks = 0;
		let renderedFrames = 0;
		let resolveDone;
		let rejectDone;
		const done = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
		const abort = () => rejectDone(createAbortError());
		signal?.addEventListener('abort', abort, { once: true });
		capture.onprocessorerror = () => rejectDone(new Error('The realtime render worklet failed.'));
		capture.port.onmessage = ({ data = {} }) => {
			if (data.type === 'audio-chunk') {
				pendingChunks += 1;
				if (pendingChunks > 64) {
					rejectDone(new Error('Export storage could not keep up with realtime audio.'));
					return;
				}
				const channels = (data.channels || []).map((channel) => channel instanceof Float32Array ? channel : new Float32Array(channel));
				renderedFrames += data.frames || channels[0]?.length || 0;
				writeQueue = writeQueue
					.then(() => onChunk(channels, { frameOffset: data.frameOffset, sampleRate: context.sampleRate }))
					.finally(() => { pendingChunks -= 1; });
			} else if (data.type === 'done') writeQueue.then(resolveDone, rejectDone);
		};
		capture.port.start?.();

		try {
			await context.resume();
			await done;
			return { sampleRate: context.sampleRate, channelCount: 2, frameCount: renderedFrames };
		} finally {
			signal?.removeEventListener('abort', abort);
			capture.port.onmessage = null;
			capture.onprocessorerror = null;
			disposeGraph(graph, true);
			try { capture.disconnect(); } catch { /* Already disconnected. */ }
			try { silent.disconnect(); } catch { /* Already disconnected. */ }
			if (context.state !== 'closed') await context.close?.();
		}
	}

	renderTrack(trackId, options = {}) {
		if (!this.project?.tracks?.some((track) => track.id === trackId)) {
			return Promise.reject(new Error('The requested track could not be found.'));
		}
		return this.renderMix({
			...options,
			trackId,
			includeMaster: false,
			respectMuteSolo: false,
		});
	}

	async dispose() {
		this.#haltGraph();
		this.project = null;
		this.sources.clear();
		this.positionListeners.clear();
		this.meterListeners.clear();
		this.stateListeners.clear();
		this.reversedBuffers = new WeakMap();
		const context = this.context;
		this.context = null;
		if (context?.state !== 'closed') await context?.close?.();
		this.state = 'disposed';
	}

	async #getContext() {
		if (this.context) return this.context;
		if (!this.audioContextFactory) throw new Error('Web Audio is not supported in this browser.');
		this.context = createRealtimeContext(this.audioContextFactory, this.sampleRate);
		return this.context;
	}

	#schedulePlayback(fromFrame, scheduledTime = this.context?.currentTime || 0) {
		const context = this.context;
		if (!context || !this.project) return;
		this.#haltGraph();
		const loopEnd = this.loop.enabled ? this.loop.endFrame : this.durationFrames;
		this.playEndFrame = Math.max(fromFrame, loopEnd);
		this.playbackStartFrame = fromFrame;
		this.playbackStartTime = scheduledTime;
		this.positionFrame = fromFrame;
		this.graph = buildProjectGraph(context, context.destination, this.project, {
			metering: this.meterListeners.size > 0,
			respectMuteSolo: true,
		});
		scheduleProjectClips({
			context,
			project: this.project,
			sources: this.sources,
			trackInputs: this.graph.trackInputs,
			fromFrame,
			toFrame: this.playEndFrame,
			contextStartTime: this.playbackStartTime,
			sampleRate: this.sampleRate,
			reversedBuffers: this.reversedBuffers,
			activeSources: this.graph.sources,
			allNodes: this.graph.nodes,
		});
		if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
			this.loopScheduleTime = this.playbackStartTime + (this.loop.endFrame - fromFrame) / this.sampleRate;
			this.#scheduleLoopAhead();
		}
		this.#setState('playing');
		this.#startTicker();
		this.#emitPosition();
	}

	#startTicker() {
		this.#stopTicker();
		this.ticker = globalThis.setInterval(() => {
			if (this.state !== 'playing') return;
			const frame = this.getPositionFrames();
			this.#emitPosition(frame);
			this.#emitMeters();
			if (this.loop.enabled && this.loop.endFrame > this.loop.startFrame) {
				this.#scheduleLoopAhead();
				return;
			}
			if (frame < this.playEndFrame) return;
			this.positionFrame = this.durationFrames;
			this.#haltGraph();
			this.#setState('stopped');
			this.#emitPosition();
		}, this.meterInterval);
	}

	#scheduleLoopAhead() {
		if (!this.graph || !this.context || !this.project || !this.loop.enabled) return;
		const durationSeconds = (this.loop.endFrame - this.loop.startFrame) / this.sampleRate;
		if (!(durationSeconds > 0)) return;
		const horizon = this.context.currentTime + Math.max(0.25, this.meterInterval / 1000 * 4);
		let scheduledIterations = 0;
		while (this.loopScheduleTime < horizon && scheduledIterations < 1_024) {
			scheduleProjectClips({
				context: this.context,
				project: this.project,
				sources: this.sources,
				trackInputs: this.graph.trackInputs,
				fromFrame: this.loop.startFrame,
				toFrame: this.loop.endFrame,
				contextStartTime: this.loopScheduleTime,
				sampleRate: this.sampleRate,
				reversedBuffers: this.reversedBuffers,
				activeSources: this.graph.sources,
				allNodes: this.graph.nodes,
			});
			this.loopScheduleTime += durationSeconds;
			scheduledIterations += 1;
		}
	}

	#stopTicker() {
		if (this.ticker !== null) {
			globalThis.clearInterval(this.ticker);
			this.ticker = null;
		}
	}

	#haltGraph() {
		this.#stopTicker();
		if (this.graph) {
			disposeGraph(this.graph, true);
			this.graph = null;
		}
	}

	#emitPosition(frame = this.getPositionFrames()) {
		for (const listener of this.positionListeners) listener(frame, this.durationFrames);
	}

	#emitMeters() {
		if (!this.graph || !this.meterListeners.size) return;
		const tracks = {};
		for (const [trackId, analyser] of this.graph.trackAnalysers) tracks[trackId] = readMeter(analyser);
		const meter = { master: readMeter(this.graph.masterAnalyser), tracks };
		for (const listener of this.meterListeners) listener(meter);
	}

	#setState(value) {
		if (this.state === value) return;
		this.state = value;
		for (const listener of this.stateListeners) listener(value);
	}
}

export function getProjectDurationFrames(project) {
	let duration = 0;
	for (const clip of getProjectClips(project)) {
		duration = Math.max(duration, clipStart(clip) + clipDuration(clip));
	}
	return duration;
}

/** Build track/master nodes and return the per-track clip inputs. */
export function buildProjectGraph(context, destination, project, {
	metering = true,
	respectMuteSolo = true,
	trackId: onlyTrackId = null,
	includeMaster = true,
} = {}) {
	const nodes = [];
	const sources = new Set();
	const trackInputs = new Map();
	const trackAnalysers = new Map();
	const masterInput = addNode(nodes, context.createGain());
	const masterOutput = applyEffectRack(context, masterInput, includeMaster ? project?.master?.effects || [] : [], nodes);
	const masterGain = addNode(nodes, context.createGain());
	setParam(masterGain.gain, includeMaster ? finite(project?.master?.gain, 1) : 1, context.currentTime);
	connect(masterOutput, masterGain);
	const masterAnalyser = metering ? createAnalyser(context, nodes) : null;
	if (masterAnalyser) {
		connect(masterGain, masterAnalyser);
		connect(masterAnalyser, destination);
	} else connect(masterGain, destination);

	const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
	const anySolo = respectMuteSolo && tracks.some((track) => track.solo);
	for (const [index, track] of tracks.entries()) {
		const trackId = String(track.id ?? index);
		if (onlyTrackId != null && String(onlyTrackId) !== trackId) continue;
		const input = addNode(nodes, context.createGain());
		let output = applyEffectRack(context, input, track.effects || [], nodes);
		const gain = addNode(nodes, context.createGain());
		setParam(gain.gain, finite(track.gain, 1), context.currentTime);
		connect(output, gain);
		output = gain;
		if (typeof context.createStereoPanner === 'function') {
			const panner = addNode(nodes, context.createStereoPanner());
			setParam(panner.pan, clamp(finite(track.pan, 0), -1, 1), context.currentTime);
			connect(output, panner);
			output = panner;
		}
		const analyser = metering ? createAnalyser(context, nodes) : null;
		if (analyser) {
			connect(output, analyser);
			output = analyser;
			trackAnalysers.set(trackId, analyser);
		}
		const mute = addNode(nodes, context.createGain());
		const audible = !respectMuteSolo || (anySolo ? Boolean(track.solo) : !track.mute);
		setParam(mute.gain, audible ? 1 : 0, context.currentTime);
		connect(output, mute);
		connect(mute, masterInput);
		trackInputs.set(trackId, input);
	}

	return { nodes, sources, trackInputs, trackAnalysers, masterAnalyser };
}

export function applyEffectRack(context, input, effects, nodes = []) {
	let output = input;
	for (const effect of Array.isArray(effects) ? effects : []) {
		if (!effect || effect.enabled === false || effect.bypassed === true) continue;
		output = applyEffect(context, output, effect, nodes);
	}
	return output;
}

function applyEffect(context, input, effect, nodes) {
	const type = String(effect.type || effect.kind || '').toLowerCase();
	const params = effect.params || effect;
	if ((type === 'limiter' || type === 'gate') && dynamicsWorkletContexts.has(context)) {
		const WorkletNode = globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode;
		if (typeof WorkletNode === 'function') {
			const dynamics = addNode(nodes, new WorkletNode(context, 'kw-audio-dynamics', {
				numberOfInputs: 1,
				numberOfOutputs: 1,
				outputChannelCount: [2],
				processorOptions: { type, params },
			}));
			connect(input, dynamics);
			return dynamics;
		}
	}
	if (type === 'eq' || type === 'parametric-eq' || type === 'parametric_eq') {
		let output = input;
		const bands = Array.isArray(params.bands) ? params.bands.slice(0, 4) : [];
		for (const band of bands) output = connectBiquad(context, output, { ...band, type: band.type || 'peaking' }, nodes);
		return output;
	}
	if (['highpass', 'lowpass', 'bandpass', 'notch', 'peaking', 'lowshelf', 'highshelf'].includes(type)) {
		return connectBiquad(context, input, { ...params, type }, nodes);
	}
	if (type === 'compressor' || type === 'limiter') {
		if (typeof context.createDynamicsCompressor !== 'function') return input;
		const compressor = addNode(nodes, context.createDynamicsCompressor());
		setParam(compressor.threshold, finite(params.threshold ?? params.ceiling, type === 'limiter' ? -1 : -24), context.currentTime);
		setParam(compressor.knee, finite(params.knee, type === 'limiter' ? 0 : 30), context.currentTime);
		setParam(compressor.ratio, finite(params.ratio, type === 'limiter' ? 20 : 4), context.currentTime);
		setParam(compressor.attack, finite(params.attack, type === 'limiter' ? 0.003 : 0.01), context.currentTime);
		setParam(compressor.release, finite(params.release, type === 'limiter' ? 0.1 : 0.25), context.currentTime);
		connect(input, compressor);
		if (type === 'compressor' && finite(params.makeupGain, 0) !== 0) {
			const makeup = addNode(nodes, context.createGain());
			setParam(makeup.gain, 10 ** (finite(params.makeupGain, 0) / 20), context.currentTime);
			connect(compressor, makeup);
			return makeup;
		}
		return compressor;
	}
	if (type === 'gate') {
		if (typeof context.createWaveShaper !== 'function') return input;
		const shaper = addNode(nodes, context.createWaveShaper());
		shaper.curve = createGateCurve(finite(params.threshold, -48));
		shaper.oversample = 'none';
		connect(input, shaper);
		return shaper;
	}
	if (type === 'delay') return connectDelay(context, input, params, nodes);
	if (type === 'reverb' || type === 'convolver') return connectReverb(context, input, params, nodes);
	return input;
}

function connectBiquad(context, input, params, nodes) {
	if (typeof context.createBiquadFilter !== 'function') return input;
	const filter = addNode(nodes, context.createBiquadFilter());
	filter.type = params.type || 'peaking';
	setParam(filter.frequency, clamp(finite(params.frequency, 1000), 10, 24000), context.currentTime);
	setParam(filter.Q, Math.max(0.0001, finite(params.q ?? params.Q, 0.707)), context.currentTime);
	setParam(filter.gain, finite(params.gain, 0), context.currentTime);
	connect(input, filter);
	return filter;
}

function connectDelay(context, input, params, nodes) {
	if (typeof context.createDelay !== 'function') return input;
	const output = addNode(nodes, context.createGain());
	const dry = addNode(nodes, context.createGain());
	const wet = addNode(nodes, context.createGain());
	const delay = addNode(nodes, context.createDelay(MAX_EFFECT_TAIL_SECONDS));
	const feedback = addNode(nodes, context.createGain());
	const mix = clamp(finite(params.mix, 0.25), 0, 1);
	setParam(dry.gain, 1 - mix, context.currentTime);
	setParam(wet.gain, mix, context.currentTime);
	setParam(delay.delayTime, clamp(finite(params.time ?? params.delayTime, 0.25), 0, MAX_EFFECT_TAIL_SECONDS), context.currentTime);
	setParam(feedback.gain, clamp(finite(params.feedback, 0.25), 0, 0.95), context.currentTime);
	connect(input, dry); connect(dry, output);
	connect(input, delay); connect(delay, wet); connect(wet, output);
	connect(delay, feedback); connect(feedback, delay);
	return output;
}

function connectReverb(context, input, params, nodes) {
	if (typeof context.createConvolver !== 'function') return input;
	const output = addNode(nodes, context.createGain());
	const dry = addNode(nodes, context.createGain());
	const wet = addNode(nodes, context.createGain());
	const convolver = addNode(nodes, context.createConvolver());
	const mix = clamp(finite(params.mix, 0.25), 0, 1);
	setParam(dry.gain, 1 - mix, context.currentTime);
	setParam(wet.gain, mix, context.currentTime);
	const duration = clamp(finite(params.duration ?? params.decay, 1.5), 0.05, MAX_EFFECT_TAIL_SECONDS);
	const preDelaySeconds = clamp(finite(params.preDelay, 0), 0, 1);
	convolver.buffer = createImpulseResponse(context, duration, 2);
	connect(input, dry); connect(dry, output);
	if (preDelaySeconds > 0 && typeof context.createDelay === 'function') {
		const preDelay = addNode(nodes, context.createDelay(1));
		setParam(preDelay.delayTime, preDelaySeconds, context.currentTime);
		connect(input, preDelay); connect(preDelay, convolver);
	} else connect(input, convolver);
	connect(convolver, wet); connect(wet, output);
	return output;
}

function scheduleProjectClips({ context, project, sources, trackInputs, fromFrame, toFrame, contextStartTime, sampleRate, reversedBuffers, activeSources, allNodes }) {
	const clipsById = new Map(getProjectClips(project).map((clip) => [String(clip.id), clip]));
	for (const [trackIndex, track] of (project.tracks || []).entries()) {
		const trackInput = trackInputs.get(String(track.id ?? trackIndex));
		if (!trackInput) continue;
		for (const clip of getTrackClips(track, clipsById)) {
			const start = clipStart(clip);
			const duration = clipDuration(clip);
			const end = start + duration;
			const segmentStart = Math.max(start, fromFrame);
			const segmentEnd = Math.min(end, toFrame);
			if (segmentEnd <= segmentStart) continue;
			const originalBuffer = sources.get(clip.sourceId);
			if (!originalBuffer) continue;
			const source = addNode(allNodes, context.createBufferSource());
			const fadeInGain = addNode(allNodes, context.createGain());
			const fadeOutGain = addNode(allNodes, context.createGain());
			const clipGain = addNode(allNodes, context.createGain());
			const reversed = Boolean(clip.reversed);
			const buffer = reversed ? getReversedBuffer(context, originalBuffer, reversedBuffers) : originalBuffer;
			source.buffer = buffer;
			connect(source, fadeInGain);
			connect(fadeInGain, fadeOutGain);
			connect(fadeOutGain, clipGain);
			connect(clipGain, trackInput);
			const relativeStart = segmentStart - start;
			const sourceStart = nonNegativeInteger(clip.sourceStartFrame, 0);
			const offsetFrame = reversed
				? Math.max(0, buffer.length - (sourceStart + duration) + relativeStart)
				: sourceStart + relativeStart;
			const startTime = contextStartTime + (segmentStart - fromFrame) / sampleRate;
			const segmentDuration = (segmentEnd - segmentStart) / sampleRate;
			scheduleClipGain(fadeInGain.gain, fadeOutGain.gain, clipGain.gain, clip, relativeStart, segmentEnd - start, duration, startTime, sampleRate);
			try {
				source.start(startTime, offsetFrame / sampleRate, segmentDuration);
				activeSources.add(source);
				const clipNodes = [source, fadeInGain, fadeOutGain, clipGain];
				source.onended = () => {
					activeSources.delete(source);
					for (const node of clipNodes) {
						try { node.disconnect(); } catch { /* Already disconnected. */ }
						const index = allNodes.indexOf(node);
						if (index >= 0) allNodes.splice(index, 1);
					}
				};
			} catch {
				// A malformed or out-of-range clip is skipped without stopping the mix.
			}
		}
	}
}

function scheduleClipGain(fadeInParam, fadeOutParam, clipGainParam, clip, segmentStart, segmentEnd, duration, startTime, sampleRate) {
	setParam(clipGainParam, Math.max(0, finite(clip.gain, 1)), startTime);
	const fadeIn = clampFrame(clip.fadeInFrames, 0, duration);
	const fadeOut = clampFrame(clip.fadeOutFrames, 0, duration);
	const fadeInAt = (frame) => fadeIn > 0 && frame < fadeIn ? Math.max(0, frame / fadeIn) : 1;
	const fadeOutAt = (frame) => fadeOut > 0 && frame > duration - fadeOut
		? Math.max(0, (duration - frame) / fadeOut)
		: 1;
	setParam(fadeInParam, fadeInAt(segmentStart), startTime);
	if (fadeIn > 0 && segmentStart < fadeIn) {
		const fadeInEnd = Math.min(segmentEnd, fadeIn);
		linearRamp(fadeInParam, fadeInAt(fadeInEnd), startTime + (fadeInEnd - segmentStart) / sampleRate);
	}
	setParam(fadeOutParam, fadeOutAt(segmentStart), startTime);
	const fadeOutStart = duration - fadeOut;
	if (fadeOut > 0 && segmentEnd > fadeOutStart) {
		if (fadeOutStart > segmentStart) {
			setParam(fadeOutParam, 1, startTime + (fadeOutStart - segmentStart) / sampleRate);
		}
		linearRamp(fadeOutParam, fadeOutAt(segmentEnd), startTime + (segmentEnd - segmentStart) / sampleRate);
	}
}

function getReversedBuffer(context, original, cache) {
	if (cache.has(original)) return cache.get(original);
	const reversed = context.createBuffer(original.numberOfChannels, original.length, original.sampleRate);
	for (let channel = 0; channel < original.numberOfChannels; channel += 1) {
		const input = original.getChannelData(channel);
		const output = reversed.getChannelData(channel);
		for (let index = 0; index < input.length; index += 1) output[index] = input[input.length - index - 1];
	}
	cache.set(original, reversed);
	return reversed;
}

function sliceAudioBuffer(context, input, startFrame, frameCount) {
	const length = Math.max(1, Math.min(frameCount, input.length - startFrame));
	const output = context.createBuffer(input.numberOfChannels, length, input.sampleRate);
	for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
		const values = input.getChannelData(channel).subarray(startFrame, startFrame + length);
		if (typeof output.copyToChannel === 'function') output.copyToChannel(values, channel);
		else output.getChannelData(channel).set(values);
	}
	return output;
}

function createImpulseResponse(context, duration, decay) {
	const length = Math.max(1, Math.round(duration * context.sampleRate));
	const impulse = context.createBuffer(2, length, context.sampleRate);
	for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
		const data = impulse.getChannelData(channel);
		let seed = 0x1234567 + channel * 997;
		for (let index = 0; index < length; index += 1) {
			seed = (seed * 16807) % 2147483647;
			const noise = seed / 1073741823.5 - 1;
			data[index] = noise * ((1 - index / length) ** decay);
		}
	}
	return impulse;
}

function createGateCurve(thresholdDb) {
	const threshold = 10 ** (thresholdDb / 20);
	const curve = new Float32Array(2049);
	for (let index = 0; index < curve.length; index += 1) {
		const sample = index / (curve.length - 1) * 2 - 1;
		curve[index] = Math.abs(sample) < threshold ? 0 : sample;
	}
	return curve;
}

function createAnalyser(context, nodes) {
	if (typeof context.createAnalyser !== 'function') return null;
	const analyser = addNode(nodes, context.createAnalyser());
	analyser.fftSize = 256;
	analyser.smoothingTimeConstant = 0.4;
	return analyser;
}

function readMeter(analyser) {
	if (!analyser?.getFloatTimeDomainData) return { peak: 0, rms: 0, dbfs: -Infinity };
	const values = new Float32Array(analyser.fftSize || 256);
	analyser.getFloatTimeDomainData(values);
	let peak = 0;
	let squares = 0;
	for (const value of values) {
		peak = Math.max(peak, Math.abs(value));
		squares += value * value;
	}
	const rms = Math.sqrt(squares / Math.max(1, values.length));
	return { peak, rms, dbfs: peak > 0 ? 20 * Math.log10(peak) : -Infinity };
}

function disposeGraph(graph, stopSources) {
	if (stopSources) {
		for (const source of graph.sources || []) {
			try { source.stop(); } catch { /* It may already have ended. */ }
		}
	}
	for (const node of [...(graph.nodes || [])].reverse()) {
		try { node.disconnect(); } catch { /* It may already be disconnected. */ }
	}
	graph.sources?.clear?.();
}

function getProjectClips(project) {
	if (Array.isArray(project?.clips)) return project.clips;
	const clips = [];
	for (const track of project?.tracks || []) {
		for (const clip of track.clips || []) if (typeof clip === 'object') clips.push(clip);
	}
	return clips;
}

function getTrackClips(track, clipsById) {
	if (Array.isArray(track.clipIds)) return track.clipIds.map((id) => clipsById.get(String(id))).filter(Boolean);
	if (Array.isArray(track.clips)) {
		return track.clips.map((clip) => typeof clip === 'object' ? clip : clipsById.get(String(clip))).filter(Boolean);
	}
	return [];
}

function clipStart(clip) {
	return nonNegativeInteger(clip?.timelineStartFrame ?? clip?.timelineStartFrames, 0);
}

function clipDuration(clip) {
	return nonNegativeInteger(clip?.durationFrames ?? clip?.frameLength, 0);
}

function normalizeLoop(value, durationFrames) {
	const startFrame = clampFrame(value?.startFrame, 0, durationFrames);
	const endFrame = clampFrame(value?.endFrame ?? durationFrames, startFrame, durationFrames);
	return { enabled: Boolean(value?.enabled) && endFrame > startFrame, startFrame, endFrame };
}

function resolveTailSeconds(project, includeTail, { trackId = null, includeMaster = true } = {}) {
	if (!includeTail) return 0;
	if (Number.isFinite(includeTail)) return clamp(includeTail, 0, MAX_EFFECT_TAIL_SECONDS);
	const tracks = trackId == null
		? project?.tracks || []
		: (project?.tracks || []).filter((track) => String(track.id) === String(trackId));
	const trackTailFrames = tracks.reduce(
		(longest, track) => Math.max(longest, rackTailFrames(track.effects || [], project?.sampleRate || DEFAULT_SAMPLE_RATE, MAX_EFFECT_TAIL_SECONDS)),
		0,
	);
	const masterTailFrames = includeMaster
		? rackTailFrames(project?.master?.effects || [], project?.sampleRate || DEFAULT_SAMPLE_RATE, MAX_EFFECT_TAIL_SECONDS)
		: 0;
	return Math.min(MAX_EFFECT_TAIL_SECONDS, (trackTailFrames + masterTailFrames) / (project?.sampleRate || DEFAULT_SAMPLE_RATE));
}

function getAudioContextConstructor() {
	return globalThis.AudioContext || globalThis.webkitAudioContext || globalThis.window?.AudioContext || globalThis.window?.webkitAudioContext;
}

async function ensureProjectWorklets(context, project) {
	if (!projectUsesDynamicsWorklet(project) || dynamicsWorkletContexts.has(context)) return;
	if (!context?.audioWorklet?.addModule || typeof (globalThis.AudioWorkletNode || globalThis.window?.AudioWorkletNode) !== 'function') {
		throw new Error('This browser cannot run the limiter or gate without bypassing it.');
	}
	await context.audioWorklet.addModule(new URL('./dynamics-worklet.js', import.meta.url));
	dynamicsWorkletContexts.add(context);
}

function projectUsesDynamicsWorklet(project) {
	const effects = [project?.master?.effects || [], ...(project?.tracks || []).map((track) => track.effects || [])].flat();
	return effects.some((effect) => effect?.enabled !== false && (effect?.type === 'limiter' || effect?.type === 'gate'));
}

function getOfflineAudioContextConstructor() {
	return globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext || globalThis.window?.OfflineAudioContext || globalThis.window?.webkitOfflineAudioContext;
}

function createRealtimeContext(factory, sampleRate) {
	try { return new factory({ sampleRate }); } catch { return factory({ sampleRate }); }
}

function createOfflineContext(factory, channels, length, sampleRate) {
	try { return new factory(channels, length, sampleRate); } catch {
		try { return new factory({ numberOfChannels: channels, length, sampleRate }); } catch {
			return factory({ numberOfChannels: channels, length, sampleRate });
		}
	}
}

function addNode(nodes, node) {
	if (node) nodes.push(node);
	return node;
}

function connect(source, target) {
	source?.connect?.(target);
}

function setParam(param, value, time) {
	if (!param) return;
	if (typeof param.setValueAtTime === 'function') param.setValueAtTime(value, time || 0);
	else param.value = value;
}

function linearRamp(param, value, time) {
	if (!param) return;
	if (typeof param.linearRampToValueAtTime === 'function') param.linearRampToValueAtTime(value, time);
	else setParam(param, value, time);
}

function clampFrame(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, nonNegativeInteger(value, minimum)));
}

function positiveInteger(value, fallback) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function nonNegativeInteger(value, fallback) {
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function finite(value, fallback) {
	return Number.isFinite(value) ? Number(value) : fallback;
}

function clamp(value, minimum, maximum) {
	return Math.max(minimum, Math.min(maximum, value));
}

function createAbortError() {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted', 'AbortError')
		: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}
