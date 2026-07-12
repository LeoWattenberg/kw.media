import { expect, test } from '@playwright/test';

const AUDIO_EDITOR_PATHS = [
	{
		path: '/en/tools/audio-editor/',
		projectName: 'Untitled project',
		trackName: 'Track 1',
		status: 'Editor ready. Create a project or import audio.',
	},
	{
		path: '/de/tools/audio-editor/',
		projectName: 'Unbenanntes Projekt',
		trackName: 'Spur 1',
		status: 'Editor bereit. Erstelle ein Projekt oder importiere Audio.',
	},
];

function createWavFixture({ name, frequency, duration = 0.8, sampleRate = 48_000, channelCount = 2 }) {
	const frameCount = Math.round(duration * sampleRate);
	const bytesPerSample = 2;
	const dataLength = frameCount * channelCount * bytesPerSample;
	const buffer = Buffer.alloc(44 + dataLength);

	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channelCount * bytesPerSample, 28);
	buffer.writeUInt16LE(channelCount * bytesPerSample, 32);
	buffer.writeUInt16LE(bytesPerSample * 8, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataLength, 40);

	for (let frame = 0; frame < frameCount; frame += 1) {
		for (let channel = 0; channel < channelCount; channel += 1) {
			const phase = channel === 0 ? 0 : Math.PI / 3;
			const sample = Math.sin(2 * Math.PI * frequency * frame / sampleRate + phase) * 0.35;
			const offset = 44 + (frame * channelCount + channel) * bytesPerSample;
			buffer.writeInt16LE(Math.round(sample * 32767), offset);
		}
	}

	return { name, mimeType: 'audio/wav', buffer };
}

const toneA = createWavFixture({ name: 'browser-tone-a.wav', frequency: 330 });
const toneB = createWavFixture({ name: 'browser-tone-b.wav', frequency: 660 });

test.describe('audio editor browser workflows', () => {
	test('is listed on the audio tools overview', async ({ page }) => {
		await page.goto('/en/tools/audio/');
		await expect(page.locator('[data-tool-category-card][href="/en/tools/audio-editor/"]')).toBeVisible();
	});

	for (const locale of AUDIO_EDITOR_PATHS) {
		test(`${locale.path} boots a writable project without client errors`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, locale.path);

			await expect(editor.locator('[data-project-name]')).toHaveText(locale.projectName);
			await expect(editor.locator('[data-status]')).toHaveText(locale.status);
			await expect(editor.locator('[data-track-row]')).toHaveCount(1);
			await expect(editor.locator('[data-track-name]')).toHaveValue(locale.trackName);
			await expect(editor.locator('[data-track-action="arm"]')).toHaveAttribute('aria-pressed', 'true');
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

			expect(errors).toEqual([]);
		});
	}

	test('imports, edits, mixes track states, analyzes, and restores the autosaved project', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');

		await editor.locator('[data-import-input]').setInputFiles([toneA, toneB]);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		await expect(editor.locator('[data-track-row]')).toHaveCount(3);
		await expect(editor.locator('[data-clip]')).toHaveCount(2);
		await expect(editor.locator('[data-clip-label]', { hasText: toneA.name })).toHaveCount(1);
		await expect(editor.locator('[data-clip-label]', { hasText: toneB.name })).toHaveCount(1);

		const importedTrackIds = await editor.locator('[data-clip]').evaluateAll((clips) => clips.map((clip) => clip.closest('[data-track-row]')?.dataset.trackId));
		expect(importedTrackIds).toHaveLength(2);
		expect(new Set(importedTrackIds).size).toBe(2);

		const firstClip = editor.locator('[data-clip]').filter({ hasText: toneA.name });
		await firstClip.click();
		await expect(firstClip).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.locator('[data-clip-fields]')).toHaveAttribute('aria-disabled', 'false');
		await expect(editor.locator('[data-clip-field="duration"]')).toBeEnabled();
		await openInspectorTab(editor, 'clip');
		await expect(editor.locator('[data-clip-field="durationFrame"]')).toHaveValue('38400');
		await editor.locator('[data-clip-field="startFrame"]').fill('120');
		await editor.locator('[data-clip-field="startFrame"]').press('Enter');
		await expect(editor.locator('[data-clip-field="startFrame"]')).toHaveValue('120');

		const ruler = editor.locator('[data-ruler]');
		await ruler.click({ position: { x: 36, y: 16 } });
		await expect(editor.locator('[data-edit="split"]')).toBeEnabled();
		await editor.locator('[data-edit="split"]').click();
		await expect(editor.locator('[data-clip]')).toHaveCount(3);

		await editor.locator('[data-edit="undo"]').click();
		await expect(editor.locator('[data-clip]')).toHaveCount(2);
		await editor.locator('[data-edit="redo"]').click();
		await expect(editor.locator('[data-clip]')).toHaveCount(3);

		const secondTrack = editor.locator('[data-track-row]').filter({ hasText: toneB.name });
		await secondTrack.locator('[data-track-action="mute"]').click();
		await expect(secondTrack.locator('[data-track-action="mute"]')).toHaveAttribute('aria-pressed', 'true');
		await secondTrack.locator('[data-track-action="solo"]').click();
		await expect(secondTrack.locator('[data-track-action="solo"]')).toHaveAttribute('aria-pressed', 'true');
		await secondTrack.locator('[data-track-action="arm"]').click();
		await expect(secondTrack.locator('[data-track-action="arm"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.locator('[data-track-action="arm"][aria-pressed="true"]')).toHaveCount(1);
		await openInspectorTab(editor, 'effects');
		await editor.locator('[data-master-gain]').fill('-3');
		await editor.locator('[data-master-gain]').press('ArrowRight');
		await expect(editor.locator('[data-master-gain-value]')).toContainText('dB');

		await openInspectorTab(editor, 'analysis');
		await editor.locator('[data-analyze="master"]').click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		await expect(editor.locator('[data-analysis-value="peak"]')).not.toHaveText('−∞ dBFS');
		await expect(editor.locator('[data-analysis-value="clipping"]')).toHaveText('0');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		await expect(restored.locator('[data-track-row]')).toHaveCount(3);
		await expect(restored.locator('[data-clip]')).toHaveCount(3);
		const restoredSecondTrack = restored.locator('[data-track-row]').filter({ hasText: toneB.name });
		await expect(restoredSecondTrack.locator('[data-track-action="mute"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(restoredSecondTrack.locator('[data-track-action="solo"]')).toHaveAttribute('aria-pressed', 'true');
		await expect(restoredSecondTrack.locator('[data-track-action="arm"]')).toHaveAttribute('aria-pressed', 'true');

		expect(errors).toEqual([]);
	});

	test('supports crisp viewport canvases, keyboard split, spectrograms, and menus', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles(toneA);
		const clip = editor.locator('[data-clip]');
		await clip.click();
		await editor.locator('[data-ruler]').click({ position: { x: 36, y: 16 } });
		await page.keyboard.press('s');
		await expect(editor.locator('[data-clip]')).toHaveCount(2);

		await editor.locator('[data-timeline-view="spectrogram"]').click();
		await expect(editor).toHaveAttribute('data-timeline-view', 'spectrogram');
		await expect(editor.locator('[data-timeline-view="spectrogram"]')).toHaveAttribute('aria-pressed', 'true');
		await page.setViewportSize({ width: 930, height: 800 });
		await expect.poll(() => editor.locator('[data-ruler-canvas]').evaluate((canvas) => {
			const ratio = canvas.width / canvas.getBoundingClientRect().width;
			return Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : 0;
		})).toBeGreaterThanOrEqual(1);
		const canvasGeometry = await editor.locator('[data-clip-waveform]').first().evaluate((canvas) => ({
			backingWidth: canvas.width,
			cssWidth: canvas.getBoundingClientRect().width,
			viewportWidth: canvas.closest('[data-timeline]')?.clientWidth || 0,
		}));
		expect(canvasGeometry.backingWidth).toBeGreaterThanOrEqual(Math.floor(canvasGeometry.cssWidth));
		expect(canvasGeometry.cssWidth).toBeLessThanOrEqual(canvasGeometry.viewportWidth + 100);

		const track = editor.locator('[data-track-row]').first();
		await track.locator('[data-track-action="menu"]').click();
		await expect(track.locator('[data-track-menu]')).toBeVisible();
		await track.locator('[data-track-menu-action="duplicate"]').click();
		await expect(editor.locator('[data-track-row]')).toHaveCount(3);

		await editor.locator('[data-file-menu-toggle]').click();
		await expect(editor.locator('[data-file-menu-panel]')).toBeVisible();
		await expect(editor.locator('[data-file-menu-panel] [data-project-action]')).toHaveCount(5);
		expect(errors).toEqual([]);
	});

	test('deletes a project and its indexed records', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-file-menu-toggle]').click();
		await editor.locator('[data-project-action="duplicate"]').click();
		await expect(editor.locator('[data-project-name]')).toContainText('copy');
		await editor.locator('[data-file-menu-toggle]').click();
		await editor.locator('[data-project-action="delete"]').click();
		await expect(editor.locator('[data-confirm-dialog]')).toBeVisible();
		await editor.locator('[data-confirm-dialog] [value="confirm"]').click();
		await expect(editor.locator('[data-confirm-dialog]')).not.toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		await editor.locator('[data-file-menu-toggle]').click();
		await editor.locator('[data-project-action="open"]').click();
		await expect(editor.locator('[data-project-item]')).toHaveCount(2);
		expect(errors).toEqual([]);
	});

	test('streams aligned WAV stems into a local ZIP archive', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles([toneA, toneB]);
		await expect(editor.locator('[data-clip]')).toHaveCount(2);
		await openInspectorTab(editor, 'export');
		await editor.locator('[data-export-field="mode"]').selectOption('stems');
		await editor.locator('[data-export-field="format"]').selectOption('wav');
		await editor.locator('[data-export-action="start"]').click();
		const download = editor.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		await expect(download).toHaveAttribute('download', /-stems-.*\.zip$/);
		const archive = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			return { signature: Array.from(bytes.subarray(0, 4)), length: bytes.length };
		});
		expect(archive.signature).toEqual([0x50, 0x4b, 0x03, 0x04]);
		expect(archive.length).toBeGreaterThan(200);
		expect(errors).toEqual([]);
	});

	test('renders limiter and gate worklets without bypassing the rack', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles(toneA);
		await openInspectorTab(editor, 'effects');
		await editor.locator('[data-effect-target]').selectOption('master');
		await editor.locator('[data-effect-type]').selectOption('limiter');
		await editor.locator('[data-add-effect]').click();
		await editor.locator('[data-effect-type]').selectOption('gate');
		await editor.locator('[data-add-effect]').click();
		await expect(editor.locator('[data-effect]')).toHaveCount(2);
		await openInspectorTab(editor, 'export');
		await editor.locator('[data-export-action="start"]').click();
		await expect(editor.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		expect(errors).toEqual([]);
	});

	test('renders a local WAV mix when OfflineAudioContext is available', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		test.skip(!await page.evaluate(() => typeof globalThis.OfflineAudioContext === 'function' || typeof globalThis.webkitOfflineAudioContext === 'function'), 'OfflineAudioContext is unavailable in this browser.');

		await editor.locator('[data-import-input]').setInputFiles(toneA);
		await expect(editor.locator('[data-clip]')).toHaveCount(1);
		await openInspectorTab(editor, 'export');
		await editor.locator('[data-export-field="format"]').selectOption('wav');
		await editor.locator('[data-export-field="mode"]').selectOption('mix');
		await editor.locator('[data-export-action="start"]').click();

		const download = editor.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 15_000 });
		await expect(download).toHaveAttribute('download', /\.wav$/);
		await expect(download).toHaveAttribute('href', /^blob:/);
		const signature = await download.evaluate(async (link) => {
			const response = await fetch(link.href);
			const bytes = new Uint8Array(await response.arrayBuffer());
			return [
				new TextDecoder().decode(bytes.subarray(0, 4)),
				new TextDecoder().decode(bytes.subarray(8, 12)),
				bytes.length,
			];
		});
		expect(signature[0]).toBe('RIFF');
		expect(signature[1]).toBe('WAVE');
		expect(signature[2]).toBeGreaterThan(44);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		expect(errors).toEqual([]);
	});

	test('falls back to bounded realtime WAV rendering without OfflineAudioContext', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: undefined });
			Object.defineProperty(globalThis, 'webkitOfflineAudioContext', { configurable: true, value: undefined });
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles(toneA);
		await expect(editor.locator('[data-clip]')).toHaveCount(1);
		await openInspectorTab(editor, 'export');
		await editor.locator('[data-export-action="start"]').click();
		const download = editor.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		const header = await download.evaluate(async (link) => new TextDecoder().decode(new Uint8Array(await (await fetch(link.href)).arrayBuffer()).subarray(0, 4)));
		expect(header).toBe('RIFF');
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		expect(errors).toEqual([]);
	});

	test('records a bounded AudioWorklet take onto the armed track', async ({ page }) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'mediaDevices', {
				configurable: true,
				value: {
					async getUserMedia() {
						const context = new AudioContext({ sampleRate: 48_000 });
						const oscillator = context.createOscillator();
						const gain = context.createGain();
						const destination = context.createMediaStreamDestination();
						oscillator.frequency.value = 440;
						gain.gain.value = 0.1;
						oscillator.connect(gain).connect(destination);
						oscillator.start();
						await context.resume();
						return destination.stream;
					},
				},
			});
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		const record = editor.locator('[data-transport="record"]');
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await page.waitForTimeout(350);
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
		await expect(editor.locator('[data-clip]')).toHaveCount(1);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		expect(errors).toEqual([]);
	});

	test('encodes a local MP3 with the self-hosted FFmpeg core', async ({ page }) => {
		test.skip(process.env.AUDIO_EDITOR_FFMPEG_BROWSER !== '1', 'Enable for the 31 MB FFmpeg integration check.');
		await page.addInitScript(() => {
			Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: undefined });
			Object.defineProperty(globalThis, 'webkitOfflineAudioContext', { configurable: true, value: undefined });
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles(toneA);
		await expect(editor.locator('[data-clip]')).toHaveCount(1);
		await openInspectorTab(editor, 'export');
		await editor.locator('[data-export-field="format"]').selectOption('mp3');
		await editor.locator('[data-export-action="start"]').click();
		const download = editor.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 90_000 });
		await expect(download).toHaveAttribute('download', /\.mp3$/);
		const signature = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			return { head: new TextDecoder().decode(bytes.subarray(0, 3)), first: bytes[0], second: bytes[1], length: bytes.length };
		});
		expect(signature.head === 'ID3' || (signature.first === 0xff && (signature.second & 0xe0) === 0xe0)).toBe(true);
		expect(signature.length).toBeGreaterThan(256);
		expect(errors).toEqual([]);
	});
});

async function bootEditor(page, path) {
	await page.goto(path);
	return waitForEditor(page);
}

async function waitForEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	return editor;
}

async function openInspectorTab(editor, name) {
	const tab = editor.locator(`[data-inspector-tab="${name}"]`);
	if (!await tab.isVisible()) await editor.locator('[data-inspector-toggle]').click();
	await tab.click();
	await expect(tab).toHaveAttribute('aria-selected', 'true');
}

function collectClientErrors(page) {
	const errors = [];
	const reportedRequests = new Set();

	function reportRequest(request, reason) {
		const key = `${request.url()}: ${reason}`;
		if (reportedRequests.has(key)) return;
		reportedRequests.add(key);
		errors.push(`Browser dependency ${request.url()} was rejected: ${reason}`);
	}

	page.on('pageerror', (error) => errors.push(error.message));
	page.on('console', (message) => {
		if (message.type() !== 'error') return;
		const source = message.location().url;
		errors.push(source ? `${message.text()} (${source})` : message.text());
	});
	page.on('requestfailed', (request) => {
		if (isBrowserDependency(request)) reportRequest(request, request.failure()?.errorText || 'request failed');
	});
	page.on('response', (response) => {
		const request = response.request();
		if (!isBrowserDependency(request)) return;
		if (!response.ok()) return reportRequest(request, `HTTP ${response.status()}`);
		const contentType = response.headers()['content-type']?.toLowerCase() || '';
		if (request.resourceType() === 'script' && !/(?:java|ecma)script/.test(contentType)) {
			reportRequest(request, `script has disallowed MIME type ${contentType || '(missing)'}`);
		}
		if (/\.wasm(?:$|[?#])/.test(request.url()) && !contentType.startsWith('application/wasm')) {
			reportRequest(request, `WebAssembly has disallowed MIME type ${contentType || '(missing)'}`);
		}
	});

	return errors;
}

function isBrowserDependency(request) {
	return request.resourceType() === 'script' || /\.(?:wasm|worker\.js)(?:$|[?#])/.test(request.url());
}
