const DEFAULT_FFMPEG_VERSION = '0.12.15';
const DEFAULT_CORE_VERSION = '0.12.10';
const DEFAULT_TIMEOUT_MS = 90_000;

interface FfmpegProgressEvent {
	progress?: number;
	time?: number;
}

export interface FfmpegInstance {
	load(options: { classWorkerURL: string; coreURL: string; wasmURL: string }): Promise<unknown>;
	writeFile(path: string, data: Uint8Array): Promise<unknown>;
	readFile(path: string): Promise<Uint8Array | string>;
	deleteFile(path: string): Promise<unknown>;
	exec(args: string[]): Promise<number>;
	on(event: 'progress', callback: (event: FfmpegProgressEvent) => void): void;
	off(event: 'progress', callback: (event: FfmpegProgressEvent) => void): void;
	terminate?(): void;
}

interface FfmpegConstructor {
	new (): FfmpegInstance;
}

interface FfmpegModule {
	FFmpeg: FfmpegConstructor;
}

export interface FfmpegRuntimeOptions {
	ffmpegVersion?: string;
	coreVersion?: string;
	timeoutMs?: number;
	timeoutMessage: string;
	onLoading?: () => void;
	onReady?: () => void;
	onProgress?: (progress: number, event: FfmpegProgressEvent) => void;
}

export interface FfmpegRuntime {
	load(): Promise<FfmpegInstance>;
	run<T>(task: (ffmpeg: FfmpegInstance) => Promise<T>): Promise<T>;
	dispose(): void;
}

export function createFfmpegRuntime(options: FfmpegRuntimeOptions): FfmpegRuntime {
	const ffmpegVersion = options.ffmpegVersion ?? DEFAULT_FFMPEG_VERSION;
	const coreVersion = options.coreVersion ?? DEFAULT_CORE_VERSION;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	let ffmpeg: FfmpegInstance | null = null;
	let loadPromise: Promise<FfmpegInstance> | null = null;
	let queue: Promise<unknown> = Promise.resolve();
	let objectUrls: string[] = [];

	const handleProgress = (event: FfmpegProgressEvent) => {
		const progress = Math.max(0, Math.min(100, Math.round((event.progress ?? 0) * 100)));
		options.onProgress?.(progress, event);
	};

	async function load() {
		if (ffmpeg) {
			return ffmpeg;
		}

		if (loadPromise) {
			return loadPromise;
		}

		loadPromise = withTimeout(loadFfmpeg(), timeoutMs, options.timeoutMessage).catch((error) => {
			loadPromise = null;
			revokeObjectUrls();
			throw error;
		});

		return loadPromise;
	}

	async function loadFfmpeg() {
		options.onLoading?.();

		const ffmpegBase = `https://unpkg.com/@ffmpeg/ffmpeg@${ffmpegVersion}/dist/esm`;
		const coreBase = `https://unpkg.com/@ffmpeg/core@${coreVersion}/dist/esm`;
		const [{ FFmpeg }, classWorkerURL, coreURL, wasmURL] = await Promise.all([
			import(/* @vite-ignore */ `${ffmpegBase}/index.js`) as Promise<FfmpegModule>,
			createModuleWorkerUrl(`${ffmpegBase}/worker.js`),
			toBlobUrl(`${coreBase}/ffmpeg-core.js`, 'text/javascript'),
			toBlobUrl(`${coreBase}/ffmpeg-core.wasm`, 'application/wasm'),
		]);

		objectUrls = [classWorkerURL, coreURL, wasmURL];
		const instance = new FFmpeg();
		instance.on('progress', handleProgress);

		try {
			await instance.load({ classWorkerURL, coreURL, wasmURL });
		} catch (error) {
			instance.off('progress', handleProgress);
			instance.terminate?.();
			throw error;
		}

		ffmpeg = instance;
		options.onReady?.();
		return instance;
	}

	function run<T>(task: (instance: FfmpegInstance) => Promise<T>) {
		const execute = async () => task(await load());
		const result = queue.then(execute, execute);
		queue = result.catch(() => undefined);
		return result;
	}

	function dispose() {
		if (ffmpeg) {
			ffmpeg.off('progress', handleProgress);
			ffmpeg.terminate?.();
		}

		ffmpeg = null;
		loadPromise = null;
		queue = Promise.resolve();
		revokeObjectUrls();
	}

	function revokeObjectUrls() {
		for (const url of objectUrls) {
			URL.revokeObjectURL(url);
		}
		objectUrls = [];
	}

	return { load, run, dispose };
}

function createModuleWorkerUrl(url: string) {
	return URL.createObjectURL(new Blob([
		`import ${JSON.stringify(url)};`,
	], { type: 'text/javascript' }));
}

async function toBlobUrl(url: string, mimeType: string) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${response.status} ${response.statusText}`);
	}

	const buffer = await response.arrayBuffer();
	return URL.createObjectURL(new Blob([buffer], { type: mimeType }));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
	let timeoutId = 0;
	const timeout = new Promise<never>((_resolve, reject) => {
		timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
	});

	return Promise.race([promise, timeout]).finally(() => {
		window.clearTimeout(timeoutId);
	});
}
