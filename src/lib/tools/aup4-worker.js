import { convertAup4BytesToAup3 } from './aup4-project.js';

self.onmessage = async ({ data }) => {
	if (data?.type !== 'convert') return;
	try {
		const bytes = await convertAup4BytesToAup3(data.buffer, {
			memoryLimits: data.memoryLimits,
			onWarning: (warning) => self.postMessage({ type: 'warning', warning }),
		});
		self.postMessage({ type: 'result', buffer: bytes.buffer }, [bytes.buffer]);
	} catch (error) {
		self.postMessage({ type: 'error', message: error?.message || String(error), code: error?.code || 'AUP4_ERROR' });
	}
};
