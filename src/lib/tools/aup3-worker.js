import { decodeAup3Bytes } from './aup3-browser.js';

self.onmessage = async (event) => {
	if (event.data?.type !== 'decode') return;
	try {
		const decoded = await decodeAup3Bytes(event.data.buffer, {
			fileName: event.data.fileName,
			onProgress(update) {
				self.postMessage({
					type: 'progress',
					progress: Number(update?.progress ?? update) || 0,
					phase: update?.phase,
				});
			},
		});
		const channels = decoded.channels.map((channel) => channel.buffer);
		self.postMessage({
			type: 'result',
			result: { ...decoded, channels },
		}, channels);
	} catch (error) {
		self.postMessage({
			type: 'error',
			code: error?.code || 'AUP3_ERROR',
			message: error?.message || String(error),
		});
	}
};
