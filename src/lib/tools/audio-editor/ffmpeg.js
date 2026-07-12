import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

const MIME_TYPES = {
	mp3: 'audio/mpeg',
	flac: 'audio/flac',
	opus: 'audio/ogg; codecs=opus',
};

/**
 * Lazy, single-thread FFmpeg runtime used only for editor decode and encoding.
 * The core URLs are emitted by Vite as same-origin build assets.
 */
export function createEditorFfmpeg(options = {}) {
	let ffmpeg = null;
	let module = null;
	let loading = null;
	let queue = Promise.resolve();

	const handleProgress = ({ progress = 0, time = 0 }) => {
		options.onProgress?.(Math.max(0, Math.min(1, progress)), time);
	};

	async function load() {
		if (ffmpeg?.loaded) return ffmpeg;
		if (loading) return loading;

		loading = import('@ffmpeg/ffmpeg').then(async (loadedModule) => {
			module = loadedModule;
			const instance = new loadedModule.FFmpeg();
			instance.on('progress', handleProgress);
			options.onLoading?.();
			await instance.load({ coreURL, wasmURL });
			ffmpeg = instance;
			options.onReady?.();
			return instance;
		}).catch((error) => {
			loading = null;
			throw error;
		});

		return loading;
	}

	function run(task) {
		const execute = async () => task(await load());
		const result = queue.then(execute, execute);
		queue = result.catch(() => undefined);
		return result;
	}

	async function encode(wav, format, settings = {}) {
		if (!MIME_TYPES[format]) throw new Error(`Unsupported encoded format: ${format}`);
		const signal = settings.signal;
		if (signal?.aborted) throw abortError();

		return run(async (instance) => {
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const input = `editor-${stamp}.wav`;
			const output = `editor-${stamp}.${format === 'opus' ? 'opus' : format}`;
			const onAbort = () => dispose();
			signal?.addEventListener('abort', onAbort, { once: true });

			try {
				await instance.writeFile(input, toUint8Array(wav), { signal });
				const code = await instance.exec(encoderArgs(input, output, format, settings), -1, { signal });
				if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);
				const data = await instance.readFile(output, undefined, { signal });
				return {
					bytes: data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)),
					extension: `.${format === 'opus' ? 'opus' : format}`,
					mimeType: MIME_TYPES[format],
				};
			} finally {
				signal?.removeEventListener('abort', onAbort);
				await instance.deleteFile(input).catch(() => undefined);
				await instance.deleteFile(output).catch(() => undefined);
			}
		});
	}

	async function encodeFile(file, format, settings = {}) {
		if (!MIME_TYPES[format]) throw new Error(`Unsupported encoded format: ${format}`);
		if (!(file instanceof Blob)) throw new TypeError('Expected a staged WAV Blob.');
		const signal = settings.signal;
		if (signal?.aborted) throw abortError();
		return run(async (instance) => {
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const mountPoint = `/editor-encode-${stamp}`;
			const inputName = file instanceof File ? file.name : `editor-${stamp}.wav`;
			const output = `editor-${stamp}.${format}`;
			const onAbort = () => dispose();
			signal?.addEventListener('abort', onAbort, { once: true });
			await instance.createDir(mountPoint);
			try {
				const mountOptions = file instanceof File
					? { files: [file] }
					: { blobs: [{ name: inputName, data: file }] };
				await instance.mount(module.FFFSType.WORKERFS, mountOptions, mountPoint);
				const code = await instance.exec(encoderArgs(`${mountPoint}/${inputName}`, output, format, settings), -1, { signal });
				if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);
				const data = await instance.readFile(output, undefined, { signal });
				return {
					bytes: data instanceof Uint8Array ? data : new TextEncoder().encode(String(data)),
					extension: `.${format}`,
					mimeType: MIME_TYPES[format],
				};
			} finally {
				signal?.removeEventListener('abort', onAbort);
				await instance.deleteFile(output).catch(() => undefined);
				await instance.unmount(mountPoint).catch(() => undefined);
				await instance.deleteDir(mountPoint).catch(() => undefined);
			}
		});
	}

	async function decode(file, settings = {}) {
		const signal = settings.signal;
		return run(async (instance) => {
			const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const mountPoint = `/editor-input-${stamp}`;
			const output = `editor-decoded-${stamp}.f32`;
			let input = `editor-input-${stamp}`;
			let mounted = false;

			try {
				if (typeof File !== 'undefined' && file instanceof File && module?.FFFSType) {
					await instance.createDir(mountPoint);
					await instance.mount(module.FFFSType.WORKERFS, { files: [file] }, mountPoint);
					input = `${mountPoint}/${file.name}`;
					mounted = true;
				} else {
					await instance.writeFile(input, new Uint8Array(await file.arrayBuffer()), { signal });
				}

				const code = await instance.exec([
					'-i', input, '-vn', '-map', '0:a:0', '-ac', '2', '-ar', '48000',
					'-c:a', 'pcm_f32le', '-f', 'f32le', output,
				], -1, { signal });
				if (code !== 0) throw new Error(`FFmpeg exited with code ${code}`);
				const raw = await instance.readFile(output, undefined, { signal });
				if (!(raw instanceof Uint8Array)) throw new Error('FFmpeg returned invalid PCM data');
				return deinterleaveStereo(raw);
			} finally {
				await instance.deleteFile(output).catch(() => undefined);
				if (mounted) {
					await instance.unmount(mountPoint).catch(() => undefined);
					await instance.deleteDir(mountPoint).catch(() => undefined);
				} else {
					await instance.deleteFile(input).catch(() => undefined);
				}
			}
		});
	}

	function dispose() {
		if (ffmpeg) {
			ffmpeg.off('progress', handleProgress);
			ffmpeg.terminate();
		}
		ffmpeg = null;
		loading = null;
		queue = Promise.resolve();
	}

	return { load, encode, encodeFile, decode, dispose };
}

export function encoderArgs(input, output, format, settings = {}) {
	const sampleRate = settings.sampleRate === 44100 ? '44100' : '48000';
	const args = ['-i', input, '-vn', '-ar', sampleRate];
	if (format === 'mp3') {
		args.push('-c:a', 'libmp3lame', '-b:a', `${allowed(settings.bitRate, [128, 192, 256, 320], 192)}k`);
	} else if (format === 'flac') {
		args.push('-c:a', 'flac', '-sample_fmt', settings.bitDepth === 16 ? 's16' : 's32', '-compression_level', String(allowed(settings.compressionLevel, [0, 1, 2, 3, 4, 5, 6, 7, 8], 5)));
	} else if (format === 'opus') {
		args.push('-c:a', 'libopus', '-b:a', `${allowed(settings.bitRate, [96, 128, 160, 192, 256], 160)}k`, '-vbr', 'on');
	}
	args.push('-y', output);
	return args;
}

function allowed(value, values, fallback) {
	const number = Number(value);
	return values.includes(number) ? number : fallback;
}

function toUint8Array(value) {
	if (value instanceof Uint8Array) return value.slice();
	if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
	if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
	throw new TypeError('Expected WAV bytes');
}

function deinterleaveStereo(bytes) {
	const frames = Math.floor(bytes.byteLength / 8);
	const view = new DataView(bytes.buffer, bytes.byteOffset, frames * 8);
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	for (let frame = 0; frame < frames; frame += 1) {
		left[frame] = view.getFloat32(frame * 8, true);
		right[frame] = view.getFloat32(frame * 8 + 4, true);
	}
	return { sampleRate: 48000, channels: [left, right], frameCount: frames };
}

function abortError() {
	return typeof DOMException === 'function'
		? new DOMException('The operation was aborted', 'AbortError')
		: Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
}
