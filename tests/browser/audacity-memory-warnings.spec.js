import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { decodeAup3Bytes } from '../../src/lib/tools/aup3-browser.js';

const SQL = await initSqlJs();
const fixtures = {
	aup3: await readFile(new URL('../fixtures/audacity-3.7.9-stereo-tones.aup3', import.meta.url)),
	aup4: await readFile(new URL('../fixtures/audacity-4.0.1-stereo-tones.aup4', import.meta.url)),
};
const converters = [
	{ source: 'aup3', target: 'wav' },
	{ source: 'aup4', target: 'wav' },
	{ source: 'aup4', target: 'aup3' },
];
const devices = [
	{ name: 'desktop', mobile: false, deviceMemory: 8, sizeMiB: 513, thresholdMiB: 256 },
	{ name: 'mobile', mobile: true, deviceMemory: 8, sizeMiB: 129, thresholdMiB: 128 },
	{ name: 'low-memory desktop', mobile: false, deviceMemory: 4, sizeMiB: 129, thresholdMiB: 128 },
];

test.describe('Audacity memory warnings', () => {
	test.setTimeout(180_000);

	for (const converterConfig of converters) {
		for (const device of devices) {
			const { source, target } = converterConfig;
			test(`${source.toUpperCase()} to ${target.toUpperCase()} permits an oversized ${device.name} project after confirmation`, async ({ page }) => {
				const errors = [];
				page.on('pageerror', (error) => errors.push(error.message));
				await instrumentProjectFile(page, device);
				await page.goto(`/en/tools/converter/${source}-to-${target}/`);
				const converter = page.locator(`[data-${source}-${target}-converter]`);
				await converter.locator('[data-file-input]').setInputFiles({
					name: `oversized-project.${source}`,
					mimeType: 'application/octet-stream',
					buffer: fixtures[source],
				});
				if (target === 'wav') await converter.locator('[data-format]').selectOption('float32');
				await expect(converter.locator('[data-convert]')).toBeEnabled();

				await confirmConversion(page, converter, device.thresholdMiB, false);
				await expect(converter.locator('[data-status]')).toHaveText('Conversion cancelled.');
				await expect(converter.locator('[data-download]')).toBeHidden();
				expect(await page.evaluate(() => window.audacityConversionProbe)).toEqual({ fileReads: 0, workers: 0 });
				await expect(converter.locator('[data-convert]')).toBeEnabled();

				await confirmConversion(page, converter, device.thresholdMiB, true);
				const download = converter.locator('[data-download]');
				await expect(download).toBeVisible({ timeout: 60_000 });
				await expect(download).toHaveAttribute('download', `oversized-project.${target}`);
				expect(await page.evaluate(() => window.audacityConversionProbe)).toEqual({ fileReads: 1, workers: 1 });

				if (target === 'wav') {
					const wav = await readWav(download);
					expect(wav).toMatchObject({
						riff: 'RIFF', wave: 'WAVE', audioFormat: 3,
						channels: 2, sampleRate: 48_000, bitDepth: 32,
						byteLength: 44 + 9600 * 2 * 4,
						decodedChannels: 2, decodedRate: 48_000, decodedLength: 9600,
					});
					assertStereoTones(wav.samples);
				} else {
					const bytes = Uint8Array.from(await download.evaluate(async (link) => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()))));
					const view = new DataView(bytes.buffer);
					expect(new TextDecoder().decode(bytes.subarray(0, 16))).toBe('SQLite format 3\0');
					expect(view.getUint32(60, false)).toBe(0x03070000);
					expect(view.getUint32(68, false)).toBe(0x41554459);
					expect(sqlRows(bytes, 'PRAGMA integrity_check')).toEqual([['ok']]);
					expect(sqlRows(bytes, 'SELECT * FROM sampleblocks ORDER BY blockid')).toEqual(sqlRows(fixtures.aup4, 'SELECT * FROM sampleblocks ORDER BY blockid'));
					const decoded = await decodeAup3Bytes(bytes, { SQL });
					expect(decoded.sampleRate).toBe(48_000);
					assertStereoTones(decoded.channels);
				}
				await converter.locator('[data-reset]').click();
				await expect(converter.locator('[data-file-meta]')).toContainText(`${device.thresholdMiB} MB`);
				await expect(converter.locator('[data-file-meta]')).not.toContainText('{threshold}');
				await expect(converter.locator('[data-download]')).toBeHidden();
				await expect(converter.locator('[data-convert]')).toBeDisabled();
				expect(errors).toEqual([]);
			});
		}
	}

	for (const { source, budgetForFailure } of [
		{ source: 'aup3', budgetForFailure: 'decodedAudioBytes' },
		{ source: 'aup4', budgetForFailure: 'mixBytes' },
	]) {
		test(`${source.toUpperCase()} to WAV can cancel or accept a ${budgetForFailure} retry without retrying malformed projects`, async ({ page }) => {
			const errors = [];
			page.on('pageerror', (error) => errors.push(error.message));
			await instrumentProjectFile(page, { sizeMiB: 1, mobile: false, deviceMemory: 8, budgetForFailure });
			await page.goto(`/en/tools/converter/${source}-to-wav/`);
			const converter = page.locator(`[data-${source}-wav-converter]`);
			await converter.locator('[data-file-input]').setInputFiles({
				name: `decoded-audio.${source}`,
				mimeType: 'application/octet-stream',
				buffer: fixtures[source],
			});
			await converter.locator('[data-format]').selectOption('float32');

			await confirmAudioRetry(page, converter, false);
			await expect(converter.locator('[data-status]')).toHaveText('Conversion cancelled.');
			await expect(converter.locator('[data-download]')).toBeHidden();
			await expect(converter.locator('[data-convert]')).toBeEnabled();
			expect(await page.evaluate(() => window.audacityConversionProbe)).toMatchObject({ fileReads: 1, workers: 1 });

			// Re-arm the small budget for a second genuine worker failure, then permit retry.
			await page.evaluate((budget) => { window.audacityWorkerBudgetToFail = budget; }, budgetForFailure);
			await confirmAudioRetry(page, converter, true);
			const download = converter.locator('[data-download]');
			await expect(download).toBeVisible({ timeout: 60_000 });
			const probe = await page.evaluate(() => window.audacityConversionProbe);
			expect(probe).toMatchObject({ fileReads: 3, workers: 3 });
			expect(probe.workerLimits[0][budgetForFailure]).toBe(1);
			expect(probe.workerLimits[1][budgetForFailure]).toBe(1);
			expect(probe.workerLimits[2]).toEqual({
				databaseBytes: Number.MAX_SAFE_INTEGER,
				decodedAudioBytes: Number.MAX_SAFE_INTEGER,
				mixBytes: Number.MAX_SAFE_INTEGER,
			});
			const wav = await readWav(download);
			expect(wav).toMatchObject({ riff: 'RIFF', wave: 'WAVE', channels: 2, sampleRate: 48_000, bitDepth: 32, decodedLength: 9600 });
			assertStereoTones(wav.samples);

			await converter.locator('[data-reset]').click();
			const malformedProject = new SQL.Database(fixtures[source]);
			let malformedBytes;
			try {
				malformedProject.run('UPDATE sampleblocks SET samples = zeroblob(1)');
				malformedBytes = malformedProject.export();
			} finally {
				malformedProject.close();
			}
			await converter.locator('[data-file-input]').setInputFiles({
				name: `malformed.${source}`,
				mimeType: 'application/octet-stream',
				buffer: Buffer.from(malformedBytes),
			});
			const unexpectedDialogs = [];
			const dismissUnexpectedDialog = async (dialog) => {
				unexpectedDialogs.push(dialog.message());
				await dialog.dismiss();
			};
			page.on('dialog', dismissUnexpectedDialog);
			await converter.locator('[data-convert]').click();
			await expect(converter.locator('[data-status]')).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
			await expect(converter.locator('[data-status]')).toContainText('sample block has an invalid byte length');
			await expect(download).toBeHidden();
			expect(unexpectedDialogs).toEqual([]);
			page.off('dialog', dismissUnexpectedDialog);
			expect(await page.evaluate(() => window.audacityConversionProbe)).toMatchObject({ fileReads: 4, workers: 4 });
			expect(errors).toEqual([]);
		});
	}
});

async function instrumentProjectFile(page, { sizeMiB, mobile, deviceMemory, budgetForFailure }) {
	await page.addInitScript(({ reportedSize, mobile, deviceMemory, budgetForFailure }) => {
		Object.defineProperty(navigator, 'deviceMemory', { value: deviceMemory, configurable: true });
		Object.defineProperty(navigator, 'userAgentData', { value: { mobile }, configurable: true });
		Object.defineProperty(navigator, 'userAgent', { value: mobile ? 'Android Mobile' : 'Desktop', configurable: true });
		window.audacityConversionProbe = { fileReads: 0, workers: 0 };
		if (budgetForFailure) {
			window.audacityConversionProbe.workerLimits = [];
			window.audacityWorkerBudgetToFail = budgetForFailure;
		}

		// Only the reported size changes: arrayBuffer still supplies the native project.
		Object.defineProperty(File.prototype, 'size', { get: () => reportedSize, configurable: true });
		const originalArrayBuffer = Blob.prototype.arrayBuffer;
		File.prototype.arrayBuffer = function () {
			window.audacityConversionProbe.fileReads += 1;
			return originalArrayBuffer.call(this);
		};
		const OriginalWorker = window.Worker;
		window.Worker = class extends OriginalWorker {
			constructor(...args) {
				super(...args);
				window.audacityConversionProbe.workers += 1;
			}
			postMessage(message, ...args) {
				if (message.type === 'decode' && window.audacityConversionProbe.workerLimits) {
					if (window.audacityWorkerBudgetToFail) {
						message.memoryLimits = { ...message.memoryLimits, [window.audacityWorkerBudgetToFail]: 1 };
						window.audacityWorkerBudgetToFail = undefined;
					}
					window.audacityConversionProbe.workerLimits.push({ ...message.memoryLimits });
				}
				return super.postMessage(message, ...args);
			}
		};
	}, { reportedSize: sizeMiB * 1024 * 1024, mobile, deviceMemory, budgetForFailure });
}

async function confirmConversion(page, converter, thresholdMiB, accept) {
	const dialogPromise = page.waitForEvent('dialog').then(async (dialog) => {
		expect(dialog.type()).toBe('confirm');
		expect(dialog.message()).toMatch(new RegExp(`${thresholdMiB} (?:MiB|MB)`));
		expect(dialog.message()).toMatch(/memory/i);
		expect(dialog.message()).toMatch(/browser tab/i);
		if (accept) await dialog.accept();
		else await dialog.dismiss();
	});
	await Promise.all([dialogPromise, converter.locator('[data-convert]').click()]);
}

async function confirmAudioRetry(page, converter, accept) {
	const dialogPromise = page.waitForEvent('dialog').then(async (dialog) => {
		expect(dialog.type()).toBe('confirm');
		expect(dialog.message()).toMatch(/decoded audio or WAV mix exceeds the recommended size/i);
		expect(dialog.message()).toMatch(/retry conversion with higher memory use/i);
		expect(dialog.message()).toMatch(/browser tab/i);
		if (accept) await dialog.accept();
		else await dialog.dismiss();
	});
	await Promise.all([dialogPromise, converter.locator('[data-convert]').click()]);
}

function sqlRows(bytes, query) {
	const database = new SQL.Database(bytes);
	try {
		return database.exec(query)[0]?.values || [];
	} finally {
		database.close();
	}
}

function assertStereoTones(channels) {
	expect(channels).toHaveLength(2);
	for (const [channel, samples] of channels.entries()) {
		expect(samples).toHaveLength(9600);
		let maximumError = 0;
		for (let frame = 0; frame < samples.length; frame += 1) {
			const sourceFrame = frame < 2400 ? frame : frame - 4800;
			const expected = frame >= 2400 && frame < 7200
				? 0
				: Math.round((channel === 0 ? 8192 : 4096) * Math.sin(2 * Math.PI * (channel === 0 ? 1000 : 2000) * sourceFrame / 48_000)) / 32768;
			maximumError = Math.max(maximumError, Math.abs(samples[frame] - expected));
		}
		expect(maximumError, `channel ${channel} waveform differs from the native fixture`).toBeLessThan(1e-7);
	}
}

const readWav = (download) => download.evaluate(async (link) => {
	const buffer = await (await fetch(link.href)).arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const view = new DataView(buffer);
	const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(buffer.slice(0));
	const ascii = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
	return {
		riff: ascii(0, 4), wave: ascii(8, 12), audioFormat: view.getUint16(20, true),
		channels: view.getUint16(22, true), sampleRate: view.getUint32(24, true), bitDepth: view.getUint16(34, true),
		byteLength: bytes.byteLength, decodedChannels: audio.numberOfChannels, decodedRate: audio.sampleRate, decodedLength: audio.length,
		samples: Array.from({ length: audio.numberOfChannels }, (_, channel) => Array.from(audio.getChannelData(channel))),
	};
});
