import { expect, test } from '@playwright/test';
import { createAup3Fixture } from '../aup3-fixture.js';

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
const monoTone = createWavFixture({ name: 'browser-mono-tone.wav', frequency: 440, channelCount: 1 });
const SELECTION_ONLY_AUDACITY_EFFECT_TYPES = [
	'audacity-amplify',
	'audacity-legacy-compressor',
	'audacity-fade-in',
	'audacity-fade-out',
	'audacity-loudness-normalization',
	'audacity-normalize',
	'audacity-paulstretch',
	'audacity-repair',
	'audacity-repeat',
	'audacity-reverse',
	'audacity-truncate-silence',
];

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

	test('imports an uppercase AUP3 project as a named dry mix', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		const fixture = await createAup3Fixture();

		await editor.locator('[data-import-input]').setInputFiles({
			name: 'Browser project.AUP3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(fixture),
		});

		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		await expect(editor.locator('[data-status]')).toContainText('best-effort dry mix');
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);
		const importedTrack = editor.locator('[data-track-row]').filter({ hasText: 'Browser project.wav' });
		await expect(importedTrack).toHaveCount(1);
		await expect(importedTrack.locator('[data-track-name]')).toHaveValue('Browser project');
		await expect(importedTrack.locator('[data-clip-label]')).toHaveText('Browser project.wav');

		await importedTrack.locator('[data-clip]').click();
		await openInspectorTab(editor, 'clip');
		await expect(editor.locator('[data-clip-field="durationFrame"]')).toHaveValue('4');
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

	test('renders an Audacity rack effect into the exported mix', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles(toneA);
		await openInspectorTab(editor, 'effects');
		await editor.locator('[data-effect-target]').selectOption('master');
		await editor.locator('[data-effect-type]').selectOption('audacity-invert');
		await editor.locator('[data-add-effect]').click();
		await expect(editor.locator('[data-effect][data-effect-type="audacity-invert"]')).toHaveCount(1);

		await openInspectorTab(editor, 'export');
		await editor.locator('[data-export-field="format"]').selectOption('wav');
		await editor.locator('[data-export-field="bitDepth"]').selectOption('16');
		await editor.locator('[data-export-field="tails"]').uncheck();
		await editor.locator('[data-export-action="start"]').click();
		const download = editor.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		const firstSignalSample = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
			for (let offset = 44; offset + 1 < bytes.length; offset += 2) {
				const sample = view.getInt16(offset, true);
				if (Math.abs(sample) > 100) return sample;
			}
			return 0;
		});
		expect(firstSignalSample).toBeLessThan(-100);
		expect(errors).toEqual([]);
	});

	test('persists Audacity effects in track and master racks', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await openInspectorTab(editor, 'effects');

		const picker = editor.locator('[data-effect-type]');
		await expect(picker.locator('option')).toHaveCount(22);
		await expect(picker.locator('optgroup[label="Audacity real-time effects"] option')).toHaveCount(14);
		await expect(picker.locator('option[value="audacity-compressor"]')).toHaveText('Compressor (Audacity)');
		await expect(picker.locator('option[value="audacity-limiter"]')).toHaveText('Limiter (Audacity)');
		for (const type of SELECTION_ONLY_AUDACITY_EFFECT_TYPES) {
			await expect(picker.locator(`option[value="${type}"]`)).toHaveCount(0);
		}

		await editor.locator('[data-effect-target]').selectOption('track');
		await picker.selectOption('audacity-invert');
		await editor.locator('[data-add-effect]').click();
		const trackEffect = editor.locator('[data-effect][data-effect-type="audacity-invert"]');
		await expect(trackEffect).toHaveCount(1);
		await expect(trackEffect.locator('[data-effect-name]')).toHaveText('Invert');

		await editor.locator('[data-effect-target]').selectOption('master');
		await picker.selectOption('audacity-bass-treble');
		await editor.locator('[data-add-effect]').click();
		const masterEffect = editor.locator('[data-effect][data-effect-type="audacity-bass-treble"]');
		await expect(masterEffect).toHaveCount(1);
		const bass = masterEffect.locator('[data-effect-param="bassDb"]');
		await bass.fill('7.5');
		await bass.press('Tab');
		await expect(masterEffect.locator('[data-effect-param="bassDb"]')).toHaveValue('7.5');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		await openInspectorTab(restored, 'effects');
		await expect(restored.locator('[data-effect][data-effect-type="audacity-invert"]')).toHaveCount(1);
		await restored.locator('[data-effect-target]').selectOption('master');
		const restoredMasterEffect = restored.locator('[data-effect][data-effect-type="audacity-bass-treble"]');
		await expect(restoredMasterEffect).toHaveCount(1);
		await expect(restoredMasterEffect.locator('[data-effect-param="bassDb"]')).toHaveValue('7.5');
		expect(errors).toEqual([]);
	});

	test('offers another track as the Auto Duck sidechain', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-add-track]').first().click();
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);
		await openInspectorTab(editor, 'effects');
		await editor.locator('[data-effect-target]').selectOption('track');
		await editor.locator('[data-effect-type]').selectOption('audacity-auto-duck');
		await editor.locator('[data-add-effect]').click();

		const autoDuck = editor.locator('[data-effect][data-effect-type="audacity-auto-duck"]');
		await expect(autoDuck).toHaveCount(1);
		const controlTrack = autoDuck.locator('[data-effect-context="controlTrackId"]');
		await expect(controlTrack.locator('option')).toHaveCount(1);
		await expect(controlTrack.locator('option')).toHaveText('Track 1');
		await expect(controlTrack).not.toHaveValue('');
		expect(errors).toEqual([]);
	});

	test('captures and restores a rack Noise Reduction profile', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles(toneA);
		await editor.locator('[data-clip]').click();
		await openInspectorTab(editor, 'effects');
		await editor.locator('[data-effect-target]').selectOption('track');
		await editor.locator('[data-effect-type]').selectOption('audacity-noise-reduction');
		await editor.locator('[data-add-effect]').click();

		let reduction = editor.locator('[data-effect][data-effect-type="audacity-noise-reduction"]');
		await expect(reduction.locator('[data-effect-enabled]')).toBeDisabled();
		await reduction.locator('[data-effect-noise-profile]').click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(reduction.locator('[data-effect-enabled]')).toBeEnabled();
		await expect(reduction.locator('[data-effect-enabled]')).toBeChecked();
		await expect(reduction.locator('[data-effect-noise-profile]')).toHaveText('Replace noise profile');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		await openInspectorTab(restored, 'effects');
		reduction = restored.locator('[data-effect][data-effect-type="audacity-noise-reduction"]');
		await expect(reduction.locator('[data-effect-enabled]')).toBeChecked();
		await expect(reduction.locator('[data-effect-noise-profile]')).toHaveText('Replace noise profile');

		await openInspectorTab(restored, 'export');
		await restored.locator('[data-export-action="start"]').click();
		await expect(restored.locator('[data-export-download]')).toBeVisible({ timeout: 20_000 });
		expect(errors).toEqual([]);
	});

	test('applies an Audacity selection effect with undo and redo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles(toneA);
		await editor.locator('[data-clip]').click();
		await openInspectorTab(editor, 'effects');

		const effectPicker = editor.locator('[data-audacity-effect-type]');
		await expect(effectPicker.locator('option')).toHaveCount(25);
		await expect(effectPicker.locator('option[value="audacity-compressor"]')).toHaveText('Compressor (Audacity)');
		await expect(effectPicker.locator('option[value="audacity-limiter"]')).toHaveText('Limiter (Audacity)');
		await effectPicker.selectOption('audacity-invert');
		await expect(editor.locator('[data-apply-audacity-effect]')).toBeEnabled();
		await editor.locator('[data-apply-audacity-effect]').click();

		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.');
		await expect(editor.locator('[data-clip]')).toHaveCount(1);
		await expect(editor.locator('[data-clip-label]')).toContainText('Invert');
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Invert'))?.channelCount).toBe(2);

		await editor.locator('[data-edit="undo"]').click();
		await expect(editor.locator('[data-clip-label]')).toHaveText(toneA.name);
		await editor.locator('[data-edit="redo"]').click();
		await expect(editor.locator('[data-clip-label]')).toContainText('Invert');
		expect(errors).toEqual([]);
	});

	test('keeps mono selections mono when applying an Audacity effect', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.locator('[data-import-input]').setInputFiles(monoTone);
		await editor.locator('[data-clip]').click();
		await openInspectorTab(editor, 'effects');
		await editor.locator('[data-audacity-effect-type]').selectOption('audacity-invert');
		await editor.locator('[data-apply-audacity-effect]').click();

		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Invert'))?.channelCount).toBe(1);
		await expect.poll(async () => effectSourcePeak(page, 'Invert')).toBeGreaterThan(0.33);

		await editor.locator('[data-audacity-effect-type]').selectOption('audacity-amplify');
		await editor.locator('[data-apply-audacity-effect]').click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect.poll(async () => effectSourcePeak(page, 'Amplify')).toBeGreaterThan(0.98);
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Amplify'))?.channelCount).toBe(1);
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

async function effectSourceMetadata(page) {
	return page.evaluate(() => new Promise((resolve, reject) => {
		const openRequest = indexedDB.open('kw-media-audio-editor', 1);
		openRequest.onerror = () => reject(openRequest.error);
		openRequest.onsuccess = () => {
			const database = openRequest.result;
			const request = database.transaction('sources', 'readonly').objectStore('sources').getAll();
			request.onerror = () => {
				database.close();
				reject(request.error);
			};
			request.onsuccess = () => {
				database.close();
				resolve(request.result.filter((source) => source.id?.startsWith('audacity-effect-')));
			};
		};
	}));
}

async function effectSourcePeak(page, name) {
	return page.evaluate(async (effectName) => {
		const sources = await new Promise((resolve, reject) => {
			const openRequest = indexedDB.open('kw-media-audio-editor', 1);
			openRequest.onerror = () => reject(openRequest.error);
			openRequest.onsuccess = () => {
				const database = openRequest.result;
				const request = database.transaction('sources', 'readonly').objectStore('sources').getAll();
				request.onerror = () => reject(request.error);
				request.onsuccess = () => {
					database.close();
					resolve(request.result);
				};
			};
		});
		const source = sources.find((candidate) => candidate.name?.includes(effectName));
		if (!source) return 0;
		let samples;
		if (source.storage === 'opfs') {
			const root = await navigator.storage.getDirectory();
			const directory = await root.getDirectoryHandle('audio-editor-sources');
			const file = await (await directory.getFileHandle(source.path)).getFile();
			const header = new DataView(await file.slice(0, 8).arrayBuffer());
			const frames = header.getUint32(0, true);
			samples = new Float32Array(await file.slice(8, 8 + frames * Float32Array.BYTES_PER_ELEMENT).arrayBuffer());
		} else {
			samples = await new Promise((resolve, reject) => {
				const openRequest = indexedDB.open('kw-media-audio-editor', 1);
				openRequest.onerror = () => reject(openRequest.error);
				openRequest.onsuccess = () => {
					const database = openRequest.result;
					const request = database.transaction('sourceChunks', 'readonly')
						.objectStore('sourceChunks').index('sourceToken').getAll(source.sourceToken);
					request.onerror = () => reject(request.error);
					request.onsuccess = () => {
						database.close();
						const first = request.result.sort((left, right) => left.index - right.index)[0];
						resolve(first ? new Float32Array(first.channels[0]) : new Float32Array(0));
					};
				};
			});
		}
		let peak = 0;
		for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
		return peak;
	}, name);
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
