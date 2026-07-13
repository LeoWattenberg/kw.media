import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createAup3Fixture } from '../aup3-fixture.js';

const AUDIO_EDITOR_PATHS = [
	{
		path: '/en/tools/audio-editor/',
		projectName: 'Untitled project',
		trackName: 'Track 1',
		status: 'Editor ready. Create a project or import audio.',
		arm: 'Arm for recording',
		fullscreen: 'Fullscreen',
	},
	{
		path: '/de/tools/audio-editor/',
		projectName: 'Unbenanntes Projekt',
		trackName: 'Spur 1',
		status: 'Editor bereit. Erstelle ein Projekt oder importiere Audio.',
		arm: 'Für Aufnahme aktivieren',
		fullscreen: 'Vollbild',
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
const longTone = createWavFixture({ name: 'browser-long-tone.wav', frequency: 220, duration: 8, channelCount: 1 });

test.describe('audio editor React/design-system workflows', () => {
	test('is listed on the audio tools overview', async ({ page }) => {
		await page.goto('/en/tools/audio/');
		await expect(page.locator('[data-tool-category-card][href="/en/tools/audio-editor/"]')).toBeVisible();
	});

	for (const locale of AUDIO_EDITOR_PATHS) {
		test(`${locale.path} hydrates one writable editor without asset or client errors`, async ({ page }) => {
			const errors = collectClientErrors(page);
			const editor = await bootEditor(page, locale.path);

			await expect(page.locator('[data-audio-editor]')).toHaveCount(1);
			await expect(editor.locator('[data-project-name]')).toHaveText(locale.projectName);
			await expect(editor.locator('[data-status]')).toHaveText(locale.status);
			await expect(editor.locator('[data-track-row]')).toHaveCount(1);
			await expect(trackNameInput(editor).first()).toHaveValue(locale.trackName);
			await expect(editor.getByRole('button', { name: new RegExp(`^${escapeRegex(locale.arm)}:`) })).toHaveAttribute('aria-pressed', 'true');
			await expect(editor.getByRole('button', { name: locale.fullscreen, exact: true })).toBeVisible();
			await expect(page.locator('body')).toHaveClass(/kw-audio-editor-design-system-mounted/);
			expect(errors).toEqual([]);
		});
	}

	test('discards invalid legacy accessibility profiles and preserves valid preferences', async ({ page }) => {
		await page.addInitScript(() => {
			if (sessionStorage.getItem('kw-accessibility-test-initialized')) return;
			sessionStorage.setItem('kw-accessibility-test-initialized', 'true');
			localStorage.setItem('audacity-accessibility-profile', 'au4');
		});
		await bootEditor(page, '/en/tools/audio-editor/');
		await expect.poll(() => page.evaluate(() => localStorage.getItem('audacity-accessibility-profile'))).toBeNull();

		await page.evaluate(() => localStorage.setItem('audacity-accessibility-profile', 'au4-tab-groups'));
		await page.reload();
		await waitForEditor(page);
		await expect.poll(() => page.evaluate(() => localStorage.getItem('audacity-accessibility-profile'))).toBe('au4-tab-groups');
	});

	test('expands the editor to the full viewport from the application header', async ({ page }) => {
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await editor.getByRole('button', { name: 'Fullscreen', exact: true }).click();
		await expect(editor).toHaveClass(/kw-audio-editor--viewport-fullscreen/);
		expect(await editor.evaluate((element) => [element.clientWidth, element.clientHeight, innerWidth, innerHeight])).toEqual([
			page.viewportSize().width,
			page.viewportSize().height,
			page.viewportSize().width,
			page.viewportSize().height,
		]);
		const toolbar = editor.getByRole('toolbar', { name: 'Tool toolbar' });
		await expect(toolbar).toBeVisible();
		expect((await toolbar.boundingBox()).y).toBeGreaterThanOrEqual(56);
		await editor.getByRole('button', { name: 'Fullscreen', exact: true }).click();
		await expect(editor).not.toHaveClass(/kw-audio-editor--viewport-fullscreen/);
	});

	test('matches the Audacity menubar and AU4 keyboard navigation model', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('audacity-accessibility-profile', 'au4-tab-groups');
		});
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		const menubar = editor.getByRole('menubar', { name: 'Application menu' });
		const headings = menubar.getByRole('menuitem');
		const expectedHeadings = [
			'File',
			'Edit',
			'Select',
			'View',
			'Record',
			'Tracks',
			'Generate',
			'Effect',
			'Analyze',
			'Tools',
			'Extra',
			'Help',
		];

		await expect(menubar).toBeVisible();
		await expect(headings).toHaveCount(expectedHeadings.length);
		expect(await headings.allTextContents()).toEqual(expectedHeadings);
		for (const heading of await headings.all()) {
			await expect(heading).toHaveAttribute('aria-haspopup', 'menu');
			await expect(heading).toHaveAttribute('aria-expanded', 'false');
		}
		expect(await headings.evaluateAll((items) => items.filter((item) => item.tabIndex >= 0).length)).toBe(1);

		const file = headings.filter({ hasText: /^File$/ });
		const tracks = headings.filter({ hasText: /^Tracks$/ });
		const help = headings.filter({ hasText: /^Help$/ });
		await file.focus();
		await page.keyboard.press('ArrowLeft');
		await expect(help).toBeFocused();
		await page.keyboard.press('Home');
		await expect(file).toBeFocused();
		await page.keyboard.press('End');
		await expect(help).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await expect(file).toBeFocused();

		await page.keyboard.press('ArrowDown');
		let menu = page.getByRole('menu', { name: 'File', exact: true });
		await expect(menu).toBeVisible();
		await expect(file).toHaveAttribute('aria-expanded', 'true');
		const newProject = getMenuItem(menu, 'New project');
		const clearData = getMenuItem(menu, 'Clear all local editor data');
		await expect(newProject).toBeFocused();
		await page.keyboard.press('ArrowUp');
		await expect(clearData).toBeFocused();
		await page.keyboard.press('Home');
		await expect(newProject).toBeFocused();
		await page.keyboard.press('End');
		await expect(clearData).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(newProject).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
		await expect(file).toBeFocused();
		await expect(file).toHaveAttribute('aria-expanded', 'false');

		await tracks.focus();
		await page.keyboard.press('ArrowDown');
		menu = page.getByRole('menu', { name: 'Tracks', exact: true });
		const addNewTrack = getMenuItem(menu, 'Add new track');
		await expect(addNewTrack).toBeFocused();
		await page.keyboard.press('ArrowRight');
		const trackSubmenu = addNewTrack.getByRole('menu');
		const audioTrack = getMenuItem(trackSubmenu, 'Audio track');
		await expect(trackSubmenu).toBeVisible();
		await expect(audioTrack).toBeFocused();
		await page.keyboard.press('ArrowLeft');
		await expect(trackSubmenu).toBeHidden();
		await expect(addNewTrack).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
		await expect(tracks).toBeFocused();
		await expect(tracks).toHaveAttribute('aria-expanded', 'false');

		await file.focus();
		await page.keyboard.press('ArrowDown');
		await expect(newProject).toBeFocused();
		await page.keyboard.press('Tab');
		const toolToolbar = editor.locator('[data-editor-tool-toolbar]').getByRole('toolbar');
		const play = toolToolbar.getByRole('button', { name: 'Play', exact: true });
		await expect(page.getByRole('menu', { name: 'File', exact: true })).toBeHidden();
		await expect(play).toBeFocused();

		await expect(editor.getByRole('button', { name: 'Back five seconds', exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Forward five seconds', exact: true })).toHaveCount(0);
		const monitor = toolToolbar.getByRole('button', { name: 'Monitor input', exact: true });
		await expect(monitor).toHaveAttribute('aria-pressed', 'false');
		await monitor.click();
		await expect(monitor).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.getByRole('alert')).toContainText('Use headphones while monitoring');
		await monitor.click();
		await expect(monitor).toHaveAttribute('aria-pressed', 'false');

		const arm = editor.getByRole('button', { name: /^Arm for recording:/ });
		await expect(arm).toHaveCount(0);
		await chooseCommandAction(page, editor, 'View', 'Show arm buttons');
		await expect(arm).toHaveCount(1);
		await expect(arm).toHaveAttribute('aria-pressed', 'true');
	});

	test('omits unavailable project, view, track, and tool commands', async ({ page }) => {
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		const menubar = editor.getByRole('menubar', { name: 'Application menu' });
		for (const [menuName, labels] of [
			['File', ['Close project', 'Save project as…', 'Export selected audio…', 'Quit']],
			['View', ['Show piano roll']],
			['Tracks', ['Sync-lock tracks']],
			['Tools', ['Screenshot tools…', 'Run benchmark…']],
		]) {
			await menubar.getByRole('menuitem', { name: menuName, exact: true }).click();
			const menu = page.getByRole('menu', { name: menuName, exact: true });
			await expect(menu).toBeVisible();
			for (const label of labels) await expect(menu.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0);
			await page.keyboard.press('Escape');
		}
	});

	test('hydrates once, dispatches one action, exposes the Audacity command surface, and follows live theme changes', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');

		await expect(editor.getByRole('button', { name: 'Mixer (unavailable)' })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Share (unavailable)' })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Audio setup (unavailable)' })).toHaveCount(0);
		await expect(editor.getByRole('toolbar', { name: 'Project toolbar' })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Home', exact: true })).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'Project', exact: true })).toHaveCount(0);
		await expect(editor.getByRole('tab')).toHaveCount(0);
		const menubar = editor.getByRole('menubar', { name: 'Application menu' });
		await expect(menubar).toBeVisible();
		for (const menu of ['File', 'Edit', 'Select', 'View', 'Record', 'Tracks', 'Generate', 'Effect', 'Analyze', 'Tools', 'Extra', 'Help']) {
			await expect(menubar.getByRole('menuitem', { name: menu, exact: true })).toBeVisible();
		}
		const selectionToolbar = editor.locator('[data-selection-toolbar]');
		await expect(selectionToolbar.getByRole('toolbar', { name: 'Selection toolbar' })).toBeVisible();
		await expect(selectionToolbar.locator('[data-status]')).toHaveText('Editor ready. Create a project or import audio.');

		await chooseFileAction(page, editor, 'Open projects');
		const projectsDialog = page.getByRole('dialog', { name: 'Local projects' });
		await expect(projectsDialog).toBeVisible();
		await projectsDialog.getByRole('button', { name: 'Close' }).click();

		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(editor.locator('[data-track-row]')).toHaveCount(2);
		await chooseCommandAction(page, editor, 'Effect', 'Add realtime effects…');
		const commandEffects = editor.locator('[data-effects-overlay]');
		await expect(commandEffects.getByRole('region', { name: 'Effects panel', exact: true })).toBeVisible();
		await closeEffectsPanel(commandEffects);

		await setDocumentTheme(page, 'light');
		const applicationHeader = editor.locator('.kw-audio-editor__application-header');
		const lightBackground = await applicationHeader.evaluate((element) => getComputedStyle(element).getPropertyValue('--header-bg'));
		await setDocumentTheme(page, 'dark');
		const darkBackground = await applicationHeader.evaluate((element) => getComputedStyle(element).getPropertyValue('--header-bg'));
		expect(darkBackground).not.toBe(lightBackground);

		const exportDialog = await openExportDialog(page, editor);
		await exportDialog.locator('[data-export-field="format"]').getByRole('button').click();
		const portal = page.getByRole('listbox');
		await expect(portal).toBeVisible();
		await expect(portal).toHaveCSS('--dropdown-menu-bg', '#202126');
		await page.keyboard.press('Escape');
		await closeDialog(exportDialog);
		expect(errors).toEqual([]);
	});

	test('imports, edits, mixes track states, analyzes, and restores the autosaved project', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');

		await importFiles(editor, [toneA, toneB]);
		await expect(editor).toHaveAttribute('data-track-count', '3');
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await expect(clipByName(editor, toneB.name)).toHaveCount(1);

		const firstClip = clipByName(editor, toneA.name);
		await firstClip.click({ position: { x: 24, y: 10 } });
		const clipDialog = await openClipProperties(page, editor, firstClip);
		await expect(clipDialog.locator('[data-clip-fields]')).toHaveAttribute('aria-disabled', 'false');
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('38400');
		await commitInput(clipField(clipDialog, 'startFrame'), '120');
		await expect(clipField(clipDialog, 'startFrame')).toHaveValue('120');
		await closeDialog(clipDialog);

		await seekOnRuler(editor, 48);
		await editor.getByRole('button', { name: 'Split at playhead' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '3');
		await editor.getByRole('button', { name: 'Undo' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '2');
		await editor.getByRole('button', { name: 'Redo' }).click();
		await expect(editor).toHaveAttribute('data-clip-count', '3');

		const secondImportedTrack = editor.locator('[data-track-row]').nth(2);
		await secondImportedTrack.getByRole('button', { name: 'Mute' }).click();
		await secondImportedTrack.getByRole('button', { name: 'Solo' }).click();
		await chooseCommandAction(page, editor, 'View', 'Show arm buttons');
		await secondImportedTrack.getByRole('button', { name: /^Arm for recording:/ }).click();
		await expect(secondImportedTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
		await expect(secondImportedTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
		await expect(editor.locator('button[aria-label^="Arm for recording:"][aria-pressed="true"]')).toHaveCount(1);

		const effectsPanel = await openEffectsForTrack(editor, 2);
		await commitInput(effectsPanel.locator('[data-master-gain] input'), '-3');
		await expect(effectsPanel.locator('[data-master-gain] input')).toHaveValue('-3.00');
		await closeEffectsPanel(effectsPanel);

		const analysisDialog = await openAnalysisDialog(page, editor);
		await analysisDialog.getByRole('button', { name: 'Analyze master' }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
		await expect(analysisDialog.locator('[data-analysis-value="peak"]')).not.toHaveText('−∞ dBFS');
		await expect(analysisDialog.locator('[data-analysis-value="clipping"]')).toHaveText('0');
		await expect(analysisDialog.locator('[data-analysis-spectrum]')).toBeVisible();
		await expect(analysisDialog.locator('[data-analysis-spectrogram]')).toBeVisible();
		await closeDialog(analysisDialog);

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		await expect(restored).toHaveAttribute('data-track-count', '3');
		await expect(restored).toHaveAttribute('data-clip-count', '3');
		const restoredSecondTrack = restored.locator('[data-track-row]').nth(2);
		await expect(restoredSecondTrack.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true');
		await expect(restoredSecondTrack.getByRole('button', { name: 'Solo' })).toHaveAttribute('aria-pressed', 'true');
		await chooseCommandAction(page, restored, 'View', 'Show arm buttons');
		await expect(restoredSecondTrack.getByRole('button', { name: /^Arm for recording:/ })).toHaveAttribute('aria-pressed', 'true');
		expect(errors).toEqual([]);
	});

	test('imports an uppercase AUP3 project as a named dry mix', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		const fixture = await createAup3Fixture();

		await importFiles(editor, [{
			name: 'Browser project.AUP3',
			mimeType: 'application/octet-stream',
			buffer: Buffer.from(fixture),
		}]);
		await expect(editor.locator('[data-status]')).toContainText('best-effort dry mix');
		await expect(editor).toHaveAttribute('data-track-count', '2');
		await expect(trackNameInput(editor).nth(1)).toHaveValue('Browser project');
		await expect(clipByName(editor, 'Browser project.wav')).toHaveCount(1);
		const clipDialog = await openClipProperties(page, editor, clipByName(editor, 'Browser project.wav'));
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('4');
		await closeDialog(clipDialog);
		expect(errors).toEqual([]);
	});

	test('moves and trims clips with frame-canonical pointer edits', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);
		const clip = clipByName(editor, toneA.name);
		await clip.scrollIntoViewIfNeeded();
		await clip.click({ position: { x: 32, y: 10 } });
		let clipDialog = await openClipProperties(page, editor);
		await expect(clipField(clipDialog, 'startFrame')).toHaveValue('0');
		await expect(clipField(clipDialog, 'durationFrame')).toHaveValue('38400');
		await closeDialog(clipDialog);
		await clip.scrollIntoViewIfNeeded();

		const box = await clip.boundingBox();
		expect(box).not.toBeNull();
		await page.mouse.move(box.x + 32, box.y + 10);
		await page.mouse.down();
		await page.mouse.move(box.x + 80, box.y + 10, { steps: 4 });
		await expect.poll(async () => (await clip.boundingBox())?.x || 0).toBeGreaterThan(box.x + 20);
		await page.mouse.up();
		clipDialog = await openClipProperties(page, editor);
		await expect.poll(async () => Number(await clipField(clipDialog, 'startFrame').inputValue())).toBeGreaterThan(0);

		const movedDuration = Number(await clipField(clipDialog, 'durationFrame').inputValue());
		await closeDialog(clipDialog);
		await clip.scrollIntoViewIfNeeded();
		const trimHandle = clip.locator('.clip-display__handle--trim-right');
		const trimBox = await trimHandle.boundingBox();
		expect(trimBox).not.toBeNull();
		await page.mouse.move(trimBox.x + trimBox.width / 2, trimBox.y + trimBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(trimBox.x - 24, trimBox.y + trimBox.height / 2, { steps: 4 });
		await page.mouse.up();
		clipDialog = await openClipProperties(page, editor);
		await expect.poll(async () => Number(await clipField(clipDialog, 'durationFrame').inputValue())).toBeLessThan(movedDuration);
		await closeDialog(clipDialog);
		expect(errors).toEqual([]);
	});

	test('previews clip moves continuously in time and snaps them to track rows', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 1440, height: 1200 });
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		await expect(editor.locator('[data-track-row]')).toHaveCount(3);

		const sourceTrack = editor.locator('[data-track-row]').nth(1);
		const targetTrack = editor.locator('[data-track-row]').nth(2);
		const clip = sourceTrack.locator('[data-clip-id]');
		const clipBox = await clip.boundingBox();
		const targetLaneBox = await targetTrack.locator('[data-track-lane]').boundingBox();
		expect(clipBox).not.toBeNull();
		expect(targetLaneBox).not.toBeNull();

		await page.mouse.move(clipBox.x + 28, clipBox.y + 12);
		await page.mouse.down();
		await page.mouse.move(clipBox.x + 76, targetLaneBox.y + 12, { steps: 5 });
		const preview = targetTrack.locator('[data-clip-id]');
		await expect(preview).toBeVisible();
		await expect.poll(async () => (await preview.boundingBox())?.x || 0).toBeGreaterThan(clipBox.x + 20);
		await expect(sourceTrack.locator('[data-clip-id]')).toHaveCount(0);
		await page.mouse.up();

		await expect(targetTrack.locator('[data-clip-id]')).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('lets pointer-moved clips overwrite and trim inactive clips on release', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 1440, height: 1200 });
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA, toneB]);
		const targetTrack = editor.locator('[data-track-row]').nth(1);
		const sourceTrack = editor.locator('[data-track-row]').nth(2);
		const inactiveClip = clipByName(targetTrack, toneA.name);
		const activeClip = clipByName(sourceTrack, toneB.name);
		const inactiveBox = await inactiveClip.boundingBox();
		const activeBox = await activeClip.boundingBox();
		const targetLaneBox = await targetTrack.locator('[data-track-lane]').boundingBox();
		expect(inactiveBox).not.toBeNull();
		expect(activeBox).not.toBeNull();
		expect(targetLaneBox).not.toBeNull();

		await page.mouse.move(activeBox.x + 28, activeBox.y + 12);
		await page.mouse.down();
		await page.mouse.move(activeBox.x + 64, targetLaneBox.y + 12, { steps: 4 });
		await page.mouse.up();

		await expect(sourceTrack.locator('[data-clip-id]')).toHaveCount(0);
		await expect(targetTrack.locator('[data-clip-id]')).toHaveCount(2);
		await expect.poll(async () => (await inactiveClip.boundingBox())?.width || 0).toBeLessThan(inactiveBox.width);
		expect(errors).toEqual([]);
	});

	test('supports ruler selection and playhead keyboard and pointer control', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);

		const ruler = editor.locator('[data-ruler]');
		await ruler.scrollIntoViewIfNeeded();
		const rulerBox = await ruler.boundingBox();
		expect(rulerBox).not.toBeNull();
		await page.mouse.move(rulerBox.x + 22, rulerBox.y + 26);
		await page.mouse.down();
		await page.mouse.move(rulerBox.x + 82, rulerBox.y + 26, { steps: 4 });
		await page.mouse.up();
		await expect(editor.getByRole('button', { name: 'Loop selection' })).toBeEnabled();
		const selectionToolbar = editor.locator('[data-selection-toolbar]');
		await expect(selectionToolbar.locator('.timecode')).toHaveCount(3);
		await expect(selectionToolbar).toContainText('Selection');
		await expect(selectionToolbar).toContainText('Duration');

		const playhead = editor.getByRole('slider', { name: 'Playhead' });
		await playhead.scrollIntoViewIfNeeded();
		await playhead.focus();
		await page.keyboard.press('Home');
		await expect(playhead).toHaveAttribute('aria-valuenow', '0');
		await page.keyboard.press('ArrowRight');
		await expect(playhead).toHaveAttribute('aria-valuenow', '1');

		await page.keyboard.press('Home');
		const icon = editor.locator('[data-playhead] .playhead-cursor canvas');
		const iconBox = await icon.boundingBox();
		const currentRulerBox = await ruler.boundingBox();
		expect(iconBox).not.toBeNull();
		expect(currentRulerBox).not.toBeNull();
		expect(iconBox.y).toBeGreaterThanOrEqual(currentRulerBox.y);
		expect(iconBox.y + iconBox.height).toBeLessThanOrEqual(currentRulerBox.y + currentRulerBox.height + 1);
		await page.mouse.move(iconBox.x + iconBox.width / 2, iconBox.y + iconBox.height / 2);
		await page.mouse.down();
		await page.mouse.move(iconBox.x + iconBox.width / 2 + 48, iconBox.y + iconBox.height / 2, { steps: 4 });
		await page.mouse.up();
		await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(1);
		expect(errors).toEqual([]);
	});

	test('uses bounded crisp canvases, spectrogram projection, track menus, and mobile pinch zoom', async ({ page }) => {
		const errors = collectClientErrors(page);
		await page.setViewportSize({ width: 390, height: 844 });
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'Spectrogram' }).click();
		await expect(editor).toHaveAttribute('data-timeline-view', 'spectrogram');
		await expect(editor.getByRole('button', { name: 'Spectrogram' })).toHaveAttribute('aria-pressed', 'true');

		const rulerCanvas = editor.locator('[data-ruler] canvas.timeline-ruler');
		await expect.poll(() => rulerCanvas.evaluate((canvas) => canvas.width / canvas.getBoundingClientRect().width)).toBeGreaterThanOrEqual(1);
		const clipGeometry = await clipByName(editor, toneA.name).evaluate((clip) => {
			const canvases = [...clip.querySelectorAll('canvas')];
			return canvases.map((canvas) => ({
				backingWidth: canvas.width,
				backingHeight: canvas.height,
				cssWidth: canvas.getBoundingClientRect().width,
				cssHeight: canvas.getBoundingClientRect().height,
			}));
		});
		expect(clipGeometry.length).toBeGreaterThan(0);
		for (const canvas of clipGeometry) {
			expect(canvas.backingWidth).toBeLessThanOrEqual(8_192);
			expect(canvas.backingHeight).toBeLessThanOrEqual(2_048);
			expect(canvas.backingWidth).toBeGreaterThanOrEqual(Math.floor(canvas.cssWidth));
		}

		const timeline = editor.locator('[data-timeline]');
		const beforeWidth = await timeline.evaluate((element) => element.scrollWidth);
		await dispatchPinch(timeline);
		await expect.poll(() => timeline.evaluate((element) => element.scrollWidth)).toBeGreaterThan(beforeWidth);
		await expect(editor.locator('[data-inspector]')).toHaveCount(0);
		await expect(editor.getByRole('tab')).toHaveCount(0);

		const mobileClip = clipByName(editor, toneA.name);
		const clipDialog = await openClipProperties(page, editor, mobileClip);
		await expectSurfaceWithinViewport(clipDialog, page);
		await page.keyboard.press('Escape');
		await expect(clipDialog).toBeHidden();
		await expect(mobileClip).toBeFocused();

		const effectsLauncher = editor.locator('[data-track-row]').nth(1).getByRole('button', { name: 'Effects', exact: true });
		const effectsPanel = await openEffectsForTrack(editor, 1);
		await expectSurfaceWithinViewport(
			effectsPanel.getByRole('region', { name: 'Effects panel', exact: true }),
			page,
		);
		await page.keyboard.press('Escape');
		await expect(effectsPanel).toBeHidden();
		await expect(effectsLauncher).toBeFocused();

		const firstTrack = editor.locator('[data-track-row]').first();
		const trackMenuButton = firstTrack.getByRole('button', { name: 'Track menu' });
		await trackMenuButton.click();
		const trackMenu = page.locator('.audio-editor-track-menu');
		await expect(trackMenu).toBeVisible();
		const [trackMenuButtonBox, trackMenuBox] = await Promise.all([trackMenuButton.boundingBox(), trackMenu.boundingBox()]);
		expect(trackMenuButtonBox).not.toBeNull();
		expect(trackMenuBox).not.toBeNull();
		expect(Math.abs(trackMenuBox.x - trackMenuButtonBox.x)).toBeLessThanOrEqual(1);
		expect(trackMenuBox.y).toBeGreaterThanOrEqual(trackMenuButtonBox.y + trackMenuButtonBox.height - 1);
		await page.getByRole('button', { name: 'Show arm buttons' }).click();
		await expect(firstTrack.getByRole('button', { name: /^Arm for recording:/ })).toBeVisible();
		await trackMenuButton.click();
		await page.getByRole('button', { name: 'Duplicate track' }).click();
		await expect(editor).toHaveAttribute('data-track-count', '3');
		expect(errors).toEqual([]);
	});

	test('duplicates, deletes, and opens local projects through accessible menus and dialogs', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await chooseFileAction(page, editor, 'Duplicate project');
		await expect(editor.locator('[data-project-name]')).toContainText('copy');
		await chooseFileAction(page, editor, 'Delete project');

		const confirm = page.getByRole('dialog', { name: 'Delete this project?' });
		await expect(confirm).toBeVisible();
		await confirm.getByRole('button', { name: 'Delete permanently' }).click();
		await expect(confirm).not.toBeVisible();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		await chooseFileAction(page, editor, 'Open projects');
		const projects = page.getByRole('dialog', { name: 'Local projects' });
		await expect(projects).toBeVisible();
		await expect(projects.locator('[data-project-list] li')).not.toHaveCount(0);
		await projects.getByRole('button', { name: 'Close' }).click();
		expect(errors).toEqual([]);
	});

	test('streams aligned WAV stems into a local ZIP archive', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA, toneB]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="mode"]'), 'Individual stems (ZIP)');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();

		const download = exportDialog.locator('[data-export-download]');
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

	test('offers only supported rack effects and persists track and master effects', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		let effectsPanel = await openEffectsForTrack(editor, 0);

		await openRackPicker(effectsPanel, 'track');
		const picker = page.getByRole('dialog', { name: 'Choose an effect' });
		await picker.locator('[data-effect-type]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(22);
		await expect(page.getByRole('option', { name: 'Invert' })).toHaveCount(1);
		await expect(page.getByRole('option', { name: 'Paulstretch' })).toHaveCount(0);
		await page.getByRole('option', { name: 'Invert' }).click();
		await picker.getByRole('button', { name: 'Add effect' }).click();
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);

		await openRackPicker(effectsPanel, 'master');
		await chooseDropdown(page, page.getByRole('dialog', { name: 'Choose an effect' }).locator('[data-effect-type]'), 'Bass and Treble');
		await page.getByRole('dialog', { name: 'Choose an effect' }).getByRole('button', { name: 'Add effect' }).click();
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Bass and Treble' })).toHaveCount(1);
		await commitInput(effectsPanel.locator('[data-effect-param="bassDb"] input'), '7.5');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 0);
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Invert' })).toHaveCount(1);
		const bassTreble = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Bass and Treble' });
		await expect(bassTreble).toHaveCount(1);
		await bassTreble.getByRole('button', { name: 'Select effect' }).click();
		await expect(effectsPanel.locator('[data-effect-param="bassDb"] input')).toHaveValue('7.5');
		expect(errors).toEqual([]);
	});

	test('captures and restores a rack Noise Reduction profile', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);
		let effectsPanel = await openEffectsForTrack(editor, 1);
		await openRackPicker(effectsPanel, 'track');
		await chooseDropdown(page, page.getByRole('dialog', { name: 'Choose an effect' }).locator('[data-effect-type]'), 'Noise Reduction');
		await page.getByRole('dialog', { name: 'Choose an effect' }).getByRole('button', { name: 'Add effect' }).click();

		const reduction = effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Noise Reduction' });
		await expect(reduction.getByRole('button', { name: 'Enable effect' })).toBeVisible();
		await effectsPanel.locator('[data-effect-noise-profile]').getByRole('button').click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(reduction.getByRole('button', { name: 'Disable effect' })).toBeVisible();
		await expect(effectsPanel.locator('[data-effect-noise-profile]')).toContainText('Replace noise profile');

		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.reload();
		const restored = await waitForEditor(page);
		effectsPanel = await openEffectsForTrack(restored, 1);
		await expect(effectsPanel.locator('[data-effect-rack]').getByRole('group', { name: 'Noise Reduction' })).toContainText('Noise Reduction');
		expect(errors).toEqual([]);
	});

	test('applies an Audacity selection effect with undo and redo', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);
		const effectDialog = await openSelectionEffectDialog(page, editor);
		await chooseDropdown(page, effectDialog.locator('[data-audacity-effect-type]'), 'Invert');
		await effectDialog.getByRole('button', { name: 'Apply to selection' }).click();

		await expect(editor.locator('[data-status]')).toHaveText('Applied the Audacity effect.', { timeout: 20_000 });
		await expect(effectDialog).toBeHidden();
		await expect(editor.locator('[data-clip-id]')).toContainText('Invert');
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Invert'))?.channelCount).toBe(2);
		await editor.getByRole('button', { name: 'Undo' }).click();
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		await editor.getByRole('button', { name: 'Redo' }).click();
		await expect(editor.locator('[data-clip-id]')).toContainText('Invert');
		expect(errors).toEqual([]);
	});

	test('keeps mono selections mono when applying Audacity effects', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [monoTone]);
		const effectDialog = await openSelectionEffectDialog(page, editor);
		await chooseDropdown(page, effectDialog.locator('[data-audacity-effect-type]'), 'Invert');
		await effectDialog.getByRole('button', { name: 'Apply to selection' }).click();
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
		await expect(effectDialog).toBeHidden();
		await expect.poll(async () => (await effectSourceMetadata(page)).find((source) => source.name.includes('Invert'))?.channelCount).toBe(1);
		await expect.poll(async () => effectSourcePeak(page, 'Invert')).toBeGreaterThan(0.33);
		expect(errors).toEqual([]);
	});

	test('renders a local WAV mix when OfflineAudioContext is available', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		test.skip(!await page.evaluate(() => typeof globalThis.OfflineAudioContext === 'function' || typeof globalThis.webkitOfflineAudioContext === 'function'), 'OfflineAudioContext is unavailable in this browser.');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();

		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 15_000 });
		await expect(download).toHaveAttribute('download', /\.wav$/);
		const signature = await download.evaluate(async (link) => {
			const bytes = new Uint8Array(await (await fetch(link.href)).arrayBuffer());
			return [new TextDecoder().decode(bytes.subarray(0, 4)), new TextDecoder().decode(bytes.subarray(8, 12)), bytes.length];
		});
		expect(signature[0]).toBe('RIFF');
		expect(signature[1]).toBe('WAVE');
		expect(signature[2]).toBeGreaterThan(44);
		expect(errors).toEqual([]);
	});

	test('falls back to bounded realtime WAV rendering without OfflineAudioContext', async ({ page }) => {
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const download = exportDialog.locator('[data-export-download]');
		await expect(download).toBeVisible({ timeout: 20_000 });
		const header = await download.evaluate(async (link) => new TextDecoder().decode(new Uint8Array(await (await fetch(link.href)).arrayBuffer()).subarray(0, 4)));
		expect(header).toBe('RIFF');
		expect(errors).toEqual([]);
	});

	test('validates export choices and cancels a realtime render', async ({ page }) => {
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [longTone]);
		const exportDialog = await openExportDialog(page, editor);

		await exportDialog.locator('[data-export-field="range"]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(1);
		await expect(page.getByRole('option', { name: 'Current selection' })).toHaveCount(0);
		await expect(exportDialog.locator('[data-export-field="range"]').getByRole('button')).toContainText('Entire project');
		await page.keyboard.press('Escape');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'FLAC');
		await exportDialog.locator('[data-export-field="bitDepth"]').getByRole('button').click();
		await expect(page.getByRole('option')).toHaveCount(2);
		await expect(page.getByRole('option', { name: '32-bit Float' })).toHaveCount(0);
		await expect(exportDialog.locator('[data-export-field="bitDepth"]').getByRole('button')).toContainText('24-bit PCM');
		await page.keyboard.press('Escape');
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'WAV');

		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const cancel = exportDialog.getByRole('button', { name: 'Cancel export' });
		await expect(cancel).toBeVisible();
		await cancel.click();
		await expect(exportDialog.getByRole('button', { name: 'Start export' })).toBeVisible({ timeout: 10_000 });
		await expect(exportDialog.locator('[data-export-download]')).toBeHidden();
		expect(errors).toEqual([]);
	});

	test('opens the same project read-only in another tab', async ({ page, context }) => {
		const first = await bootEditor(page, '/en/tools/audio-editor/');
		await chooseNestedCommandAction(page, first, 'Tracks', ['Add new track', 'Audio track']);
		await expect(first.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

		const secondPage = await context.newPage();
		await secondPage.goto('/en/tools/audio-editor/');
		const second = secondPage.locator('[data-audio-editor]');
		await expect(second).toHaveAttribute('data-audio-editor-bound', 'true');
		await expect(second.locator('[data-status]')).toContainText('already open in another tab');
		await second.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'Tracks', exact: true }).click();
		const tracksMenu = secondPage.getByRole('menu', { name: 'Tracks', exact: true });
		const addNewTrack = getMenuItem(tracksMenu, 'Add new track');
		await addNewTrack.click();
		await expect(getMenuItem(addNewTrack.getByRole('menu'), 'Audio track')).toHaveAttribute('aria-disabled', 'true');
		await secondPage.close();
	});

	test('records a bounded AudioWorklet take onto the active track when arm controls are hidden', async ({ page }) => {
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
		await chooseNestedCommandAction(page, editor, 'Tracks', ['Add new track', 'Audio track']);
		const tracks = editor.locator('[data-track-row]');
		await expect(tracks).toHaveCount(2);
		await expect(editor.getByRole('button', { name: /^Arm for recording:/ })).toHaveCount(0);
		const record = editor.getByRole('button', { name: 'Record onto the active track' });
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'true');
		await page.waitForTimeout(350);
		await record.click();
		await expect(record).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(tracks.nth(0).locator('[data-clip-id]')).toHaveCount(0);
		await expect(tracks.nth(1).locator('[data-clip-id]')).toHaveCount(1);
		await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
		expect(errors).toEqual([]);
	});

	test('has named, keyboard-reachable controls in initial, populated, menu, effects, and dialog states', async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem('audacity-accessibility-profile', 'wcag-flat');
		});
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		const flatHeadings = editor.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem');
		expect(await flatHeadings.evaluateAll((items) => items.filter((item) => item.tabIndex === 0).length)).toBe(12);
		await flatHeadings.filter({ hasText: /^File$/ }).focus();
		await page.keyboard.press('ArrowDown');
		await expect(getMenuItem(page.getByRole('menu', { name: 'File', exact: true }), 'New project')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(flatHeadings.filter({ hasText: /^Edit$/ })).toBeFocused();
		await expect(page.getByRole('menu', { name: 'File', exact: true })).toBeHidden();
		await assertAccessibleBasics(editor);
		await assertNoSeriousAxeViolations(page);
		await importFiles(editor, [toneA]);
		await assertAccessibleBasics(editor);
		await assertNoSeriousAxeViolations(page);

		await editor.getByRole('menubar', { name: 'Application menu' }).getByRole('menuitem', { name: 'File', exact: true }).click();
		await assertAccessibleBasics(page.locator('body'));
		await assertNoSeriousAxeViolations(page);
		await getMenuItem(page.getByRole('menu', { name: 'File', exact: true }), 'Open projects').click();
		await assertAccessibleBasics(page.getByRole('dialog', { name: 'Local projects' }));
		await assertNoSeriousAxeViolations(page);
		await page.getByRole('dialog', { name: 'Local projects' }).getByRole('button', { name: 'Close' }).click();

		const effectsPanel = await openEffectsForTrack(editor, 1);
		await assertAccessibleBasics(effectsPanel);
		await assertNoSeriousAxeViolations(page);
		await openRackPicker(effectsPanel, 'track');
		await assertAccessibleBasics(page.getByRole('dialog', { name: 'Choose an effect' }));
		await assertNoSeriousAxeViolations(page);
		await closeDialog(page.getByRole('dialog', { name: 'Choose an effect' }));
		await closeEffectsPanel(effectsPanel);

		const clipDialog = await openClipProperties(page, editor, clipByName(editor, toneA.name));
		await assertAccessibleBasics(clipDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(clipDialog);

		const effectDialog = await openSelectionEffectDialog(page, editor);
		await assertAccessibleBasics(effectDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(effectDialog);

		const analysisDialog = await openAnalysisDialog(page, editor);
		await assertAccessibleBasics(analysisDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(analysisDialog);

		const exportDialog = await openExportDialog(page, editor);
		await assertAccessibleBasics(exportDialog);
		await assertNoSeriousAxeViolations(page);
		await closeDialog(exportDialog);
	});

	test('matches the desktop, tablet, and mobile editor shells in light and dark themes', async ({ page }) => {
		test.setTimeout(60_000);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await page.evaluate(() => document.fonts.ready);
		await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' });

		for (const viewport of [
			{ label: 'desktop', width: 1440, height: 1000 },
			{ label: 'tablet', width: 930, height: 1000 },
			{ label: 'mobile', width: 390, height: 844 },
		]) {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			for (const theme of ['light', 'dark']) {
				await setDocumentTheme(page, theme);
				await expect(editor).toHaveScreenshot(`audio-editor-${viewport.label}-${theme}.png`, {
					animations: 'disabled',
					caret: 'hide',
					maxDiffPixelRatio: 0.015,
				});
			}
		}
	});

	test('encodes a local MP3 with the self-hosted FFmpeg core', async ({ page }) => {
		test.skip(process.env.AUDIO_EDITOR_FFMPEG_BROWSER !== '1', 'Enable for the 31 MB FFmpeg integration check.');
		await disableOfflineAudio(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/en/tools/audio-editor/');
		await importFiles(editor, [toneA]);
		const exportDialog = await openExportDialog(page, editor);
		await chooseDropdown(page, exportDialog.locator('[data-export-field="format"]'), 'MP3');
		await exportDialog.getByRole('button', { name: 'Start export' }).click();
		const download = exportDialog.locator('[data-export-download]');
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
	const editor = await waitForEditor(page);
	const decline = page.getByRole('button', { name: /^(Decline|Ablehnen)$/ });
	if (await decline.isVisible()) await decline.click();
	return editor;
}

async function waitForEditor(page) {
	const editor = page.locator('[data-audio-editor]');
	await expect(editor).toBeVisible();
	await expect(editor).toHaveAttribute('data-audio-editor-bound', 'true');
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
	return editor;
}

async function importFiles(editor, files) {
	await editor.locator('[data-import-input]').setInputFiles(files);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
}

function trackNameInput(editor) {
	return editor.locator('[data-track-name] input');
}

function clipByName(editor, name) {
	return editor.getByRole('group', { name: `${name} clip`, exact: true });
}

function clipField(editor, name) {
	return editor.locator(`[data-clip-field="${name}"] input`);
}

async function commitInput(input, value) {
	await input.fill(value);
	await input.blur();
}

async function seekOnRuler(editor, x) {
	await editor.locator('[data-ruler]').click({ position: { x, y: 28 } });
}

async function openClipProperties(page, editor, clip) {
	if (clip) {
		await clip.click({ position: { x: 24, y: 10 } });
		await clip.getByRole('button', { name: 'Clip menu' }).click();
		await page.getByRole('menuitem', { name: 'Clip properties…', exact: true }).click();
	} else {
		await chooseNestedCommandAction(page, editor, 'Edit', ['Audio clips', 'Clip properties…']);
	}
	const dialog = page.getByRole('dialog', { name: 'Clip properties', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="clip"]')).toBeVisible();
	return dialog;
}

async function openEffectsForTrack(editor, trackIndex) {
	await editor.locator('[data-track-row]').nth(trackIndex).getByRole('button', { name: 'Effects', exact: true }).click();
	const overlay = editor.locator('[data-effects-overlay]');
	await expect(overlay).toBeVisible();
	await expect(overlay.getByRole('region', { name: 'Effects panel', exact: true })).toBeVisible();
	return overlay;
}

async function openSelectionEffectDialog(page, editor) {
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="selection-effect"]')).toBeVisible();
	return dialog;
}

async function openAnalysisDialog(page, editor) {
	await chooseCommandAction(page, editor, 'Analyze', 'Analysis…');
	const dialog = page.getByRole('dialog', { name: 'Analysis', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="analysis"]')).toBeVisible();
	return dialog;
}

async function openExportDialog(page, editor) {
	await chooseFileAction(page, editor, 'Export audio…');
	const dialog = page.getByRole('dialog', { name: 'Export audio', exact: true });
	await expect(dialog).toBeVisible();
	await expect(page.locator('[data-editor-surface="export"]')).toBeVisible();
	return dialog;
}

async function closeDialog(dialog) {
	await dialog.getByRole('button', { name: 'Close', exact: true }).click();
	await expect(dialog).toBeHidden();
}

async function closeEffectsPanel(panel) {
	await panel.getByRole('button', { name: 'Close effects panel', exact: true }).click();
	await expect(panel).toBeHidden();
}

async function chooseDropdown(page, group, optionName) {
	await group.getByRole('button').click();
	await page.getByRole('option', { name: optionName, exact: true }).click();
	await expect(group.getByRole('button')).toContainText(optionName);
}

async function openRackPicker(panel, scope) {
	const buttons = panel.locator('[data-effect-rack]').getByRole('button', { name: 'Effects', exact: true });
	await (scope === 'master' ? buttons.last() : buttons.first()).click();
	await expect(panel.page().getByRole('dialog', { name: 'Choose an effect' })).toBeVisible();
}

async function chooseFileAction(page, editor, action) {
	await chooseCommandAction(page, editor, 'File', action);
}

async function chooseCommandAction(page, editor, menu, action) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu' });
	await menubar.getByRole('menuitem', { name: menu, exact: true }).click();
	const commandMenu = page.getByRole('menu', { name: menu, exact: true });
	await expect(commandMenu).toBeVisible();
	await getMenuItem(commandMenu, action).click();
}

async function chooseNestedCommandAction(page, editor, menu, actions) {
	const menubar = editor.getByRole('menubar', { name: 'Application menu' });
	await menubar.getByRole('menuitem', { name: menu, exact: true }).click();
	const commandMenu = page.getByRole('menu', { name: menu, exact: true });
	await expect(commandMenu).toBeVisible();
	let currentMenu = commandMenu;
	for (const [index, action] of actions.entries()) {
		const item = getMenuItem(currentMenu, action);
		await item.click();
		if (index < actions.length - 1) {
			currentMenu = item.getByRole('menu');
			await expect(currentMenu).toBeVisible();
		}
	}
}

function getMenuItem(menu, label) {
	const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return menu.getByRole('menuitem', { name: new RegExp(`^${escapedLabel}(?:\\s|$)`) }).first();
}

async function expectSurfaceWithinViewport(surface, page) {
	const box = await surface.boundingBox();
	expect(box).not.toBeNull();
	const viewport = page.viewportSize();
	expect(viewport).not.toBeNull();
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

async function setDocumentTheme(page, theme) {
	await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
	await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
	await expect.poll(() => page.locator('[data-audio-editor]').evaluate((root) => root.className)).toContain('kw-audio-editor');
	await page.waitForTimeout(50);
}

async function dispatchPinch(timeline) {
	const box = await timeline.boundingBox();
	expect(box).not.toBeNull();
	const y = box.y + Math.min(100, box.height / 2);
	await timeline.dispatchEvent('pointerdown', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 210, clientY: y });
	await timeline.dispatchEvent('pointerdown', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 260, clientY: y });
	await timeline.dispatchEvent('pointermove', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 180, clientY: y });
	await timeline.dispatchEvent('pointermove', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 290, clientY: y });
	await timeline.dispatchEvent('pointerup', { bubbles: true, pointerId: 101, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + 180, clientY: y });
	await timeline.dispatchEvent('pointerup', { bubbles: true, pointerId: 102, pointerType: 'touch', isPrimary: false, button: 0, clientX: box.x + 290, clientY: y });
}

async function disableOfflineAudio(page) {
	await page.addInitScript(() => {
		Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: undefined });
		Object.defineProperty(globalThis, 'webkitOfflineAudioContext', { configurable: true, value: undefined });
	});
}

async function assertAccessibleBasics(root) {
	const violations = await root.evaluate((container) => {
		const visible = (element) => {
			const style = getComputedStyle(element);
			const rect = element.getBoundingClientRect();
			return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
		};
		const textAlternative = (element) => {
			const labelledBy = element.getAttribute('aria-labelledby');
			const labelledText = labelledBy
				? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
				: '';
			const labels = element.labels ? [...element.labels].map((label) => label.textContent || '').join(' ') : '';
			return [element.getAttribute('aria-label'), labelledText, labels, element.getAttribute('title'), element.textContent]
				.map((value) => String(value || '').trim())
				.find(Boolean) || '';
		};
		const results = [];
		for (const element of container.querySelectorAll('button, input, select, textarea, [role="button"], [role="menuitem"], [role="slider"], [role="tab"], [role="dialog"]')) {
			if (!visible(element) || element.disabled || element.getAttribute('aria-hidden') === 'true') continue;
			if (!textAlternative(element)) results.push(`${element.tagName.toLowerCase()}${element.getAttribute('role') ? `[role=${element.getAttribute('role')}]` : ''} has no accessible name`);
		}
		const ids = [...container.querySelectorAll('[id]')].map((element) => element.id).filter(Boolean);
		for (const id of new Set(ids)) if (ids.filter((candidate) => candidate === id).length > 1) results.push(`duplicate id ${id}`);
		return results;
	});
	expect(violations).toEqual([]);
}

async function assertNoSeriousAxeViolations(page) {
	const results = await new AxeBuilder({ page })
		.include('#kw-audio-editor-design-system')
		.analyze();
	const violations = results.violations
		.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
		.map((violation) => ({
			id: violation.id,
			impact: violation.impact,
			nodes: violation.nodes.map((node) => node.target),
		}));
	expect(violations).toEqual([]);
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
		if (response.status() === 304) return;
		if (!response.ok()) return reportRequest(request, `HTTP ${response.status()}`);
		const contentType = response.headers()['content-type']?.toLowerCase() || '';
		if ((request.resourceType() === 'script' || /worker\.js(?:$|[?#])/.test(request.url())) && !/(?:java|ecma)script/.test(contentType)) {
			reportRequest(request, `script has disallowed MIME type ${contentType || '(missing)'}`);
		}
		if (/\.wasm(?:$|[?#])/.test(request.url()) && !contentType.startsWith('application/wasm')) {
			reportRequest(request, `WebAssembly has disallowed MIME type ${contentType || '(missing)'}`);
		}
	});

	return errors;
}

function isBrowserDependency(request) {
	return ['script', 'stylesheet', 'font', 'image'].includes(request.resourceType())
		|| /\.(?:wasm|worker\.js)(?:$|[?#])/.test(request.url());
}

function escapeRegex(value) {
	return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
