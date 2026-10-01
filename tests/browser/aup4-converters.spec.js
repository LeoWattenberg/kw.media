import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { parseAup3BinaryXml } from '../../src/lib/tools/aup3.js';
import { decodeAup3Bytes } from '../../src/lib/tools/aup3-browser.js';
import { createAup4Fixture } from '../aup4-fixture.js';

const SQL = await initSqlJs();
const nativeFixture = await readFile(new URL('../fixtures/audacity-4.0.1-stereo-tones.aup4', import.meta.url));
const samples = [0, 0.5, -0.5, 1, -1, 0.125];
const upload = (bytes, name = 'live.set.2.AUP4') => ({
	name,
	mimeType: 'application/octet-stream',
	buffer: Buffer.from(bytes),
});

test.describe('AUP4 converter artifacts', () => {
	test.setTimeout(180_000);

	for (const format of ['pcm16', 'float32']) {
		test(`AUP4 to WAV writes playable ${format} samples`, async ({ page }) => {
			const errors = collectPageErrors(page);
			const fixture = await createAup4Fixture({ SQL, tracks: [{ name: 'Ramp', clips: [{ samples }] }] });
			await page.goto('/en/tools/converter/aup4-to-wav/');
			const converter = page.locator('[data-aup4-wav-converter]');
			await converter.locator('[data-file-input]').setInputFiles(upload(fixture));
			await converter.locator('[data-format]').selectOption(format);
			await converter.locator('[data-convert]').click();
			await expect(converter.locator('[data-status]')).toHaveAttribute('data-state', 'success', { timeout: 60_000 });
			const download = converter.locator('[data-download]');
			await expect(download).toBeVisible();
			await expect(download).toHaveAttribute('download', 'live.set.2.wav');
			await expect(converter.locator('[data-result-title]')).toHaveText('live.set.2');
			await expect(converter.locator('[data-warnings]')).toBeHidden();
			const wav = await readWav(download);
			expect(wav).toMatchObject({
				riff: 'RIFF', wave: 'WAVE', data: 'data',
				audioFormat: format === 'float32' ? 3 : 1,
				bitDepth: format === 'float32' ? 32 : 16,
				channels: 1, sampleRate: 48_000,
				byteLength: 44 + samples.length * (format === 'float32' ? 4 : 2),
				decodedChannels: 1, decodedRate: 48_000, decodedLength: samples.length,
			});
			for (const [index, sample] of samples.entries()) {
				expect(wav.samples[index], `sample ${index}`).toBeCloseTo(sample, format === 'float32' ? 5 : 4);
			}
			expect(errors).toEqual([]);
		});
	}

	for (const locale of ['en', 'de']) {
		test(`AUP4 to AUP3 preserves project and autosave audio on the ${locale} route`, async ({ page }) => {
			const errors = collectPageErrors(page);
			const fixture = await createAup4Fixture({ SQL, autosave: true });
			await page.goto(`/${locale}/tools/converter/aup4-to-aup3/`);
			const converter = page.locator('[data-aup4-aup3-converter]');
			await expect(converter).toBeVisible();
			await expect(page.getByRole('heading', { name: locale === 'de' ? 'AUP4 zu AUP3' : 'AUP4 to AUP3', exact: true }).first()).toBeVisible();
			await converter.locator('[data-file-input]').setInputFiles(upload(fixture));
			await converter.locator('[data-convert]').click();
			const download = converter.locator('[data-download]');
			await expect(download).toBeVisible({ timeout: 60_000 });
			await expect(download).toHaveAttribute('download', 'live.set.2.aup3');
			const bytes = Uint8Array.from(await download.evaluate(async (link) => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()))));
			const view = new DataView(bytes.buffer);
			expect(new TextDecoder().decode(bytes.subarray(0, 16))).toBe('SQLite format 3\0');
			expect(view.getUint32(60, false)).toBe(0x03070000);
			expect(view.getUint32(68, false)).toBe(0x41554459);
			expect(sqlRows(bytes, 'PRAGMA integrity_check')).toEqual([['ok']]);
			expect(sqlRows(bytes, 'SELECT * FROM sampleblocks')).toEqual(sqlRows(fixture, 'SELECT * FROM sampleblocks'));
			for (const table of ['project', 'autosave']) {
				const original = projectXml(fixture, table);
				const converted = projectXml(bytes, table);
				expect(converted.attributes.version).toBe('1.3.0');
				original.attributes.version = '1.3.0';
				original.attributeRecords.find((record) => record.name === 'version').value = '1.3.0';
				expect(converted).toEqual(original);
			}
			const decoded = await decodeAup3Bytes(bytes, { SQL });
			expect(Array.from(decoded.channels[0])).toEqual([0.25, -0.5, 0.75, 0]);
			expect(decoded.metadata.source).toBe('autosave');
			expect(errors).toEqual([]);
		});
	}

	test('native Audacity 4 repeated gain attributes produce the real stereo waveform in WAV', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/converter/aup4-to-wav/');
		const converter = page.locator('[data-aup4-wav-converter]');
		await converter.locator('[data-file-input]').setInputFiles(upload(nativeFixture, 'native-stereo.aup4'));
		await converter.locator('[data-format]').selectOption('float32');
		await converter.locator('[data-convert]').click();
		await expect(converter.locator('[data-download]')).toBeVisible({ timeout: 60_000 });
		const wav = await readWav(converter.locator('[data-download]'));
		expect(wav).toMatchObject({ audioFormat: 3, channels: 2, sampleRate: 48_000, decodedChannels: 2, decodedLength: 9600, byteLength: 44 + 9600 * 2 * 4 });
		for (const start of [0, 7200]) {
			expect(wav.allSamples[0][start + 12]).toBeCloseTo(0.25, 7);
			expect(wav.allSamples[1][start + 6]).toBeCloseTo(0.125, 7);
		}
		for (const channel of wav.allSamples) expect(channel.slice(2400, 7200).every((sample) => sample === 0)).toBe(true);
		expect(errors).toEqual([]);
	});

	test('native Audacity 4 downgrade preserves repeated typed gain attributes and audible stereo blocks', async ({ page }) => {
		const errors = collectPageErrors(page);
		await page.goto('/en/tools/converter/aup4-to-aup3/');
		const converter = page.locator('[data-aup4-aup3-converter]');
		await converter.locator('[data-file-input]').setInputFiles(upload(nativeFixture, 'native-stereo.aup4'));
		await converter.locator('[data-convert]').click();
		const download = converter.locator('[data-download]');
		await expect(download).toBeVisible({ timeout: 60_000 });
		await expect(converter.locator('[data-warning]')).toBeHidden();
		const bytes = Uint8Array.from(await download.evaluate(async (link) => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()))));
		expect(sqlRows(bytes, 'PRAGMA integrity_check')).toEqual([['ok']]);
		expect(sqlRows(bytes, 'SELECT * FROM sampleblocks ORDER BY blockid')).toEqual(sqlRows(nativeFixture, 'SELECT * FROM sampleblocks ORDER BY blockid'));
		const tracks = projectXml(bytes, 'project').children.filter((node) => node.name === 'wavetrack');
		for (const track of tracks) expect(track.attributeRecords.filter((record) => record.name === 'gain')).toEqual([{ name: 'gain', type: 4, value: 20 }, { name: 'gain', type: 10, value: 1 }]);
		const decoded = await decodeAup3Bytes(bytes, { SQL });
		expect(decoded.channels.length).toBe(2);
		expect(decoded.channels[0].length).toBe(9600);
		expect(decoded.channels[0][12]).toBe(0.25);
		expect(decoded.channels[1][6]).toBe(0.125);
		expect(decoded.channels[0][7212]).toBe(0.25);
		expect(decoded.channels[1][7206]).toBe(0.125);
		expect(errors).toEqual([]);
	});

	for (const locale of ['en', 'de']) {
		test(`the ${locale} downgrade warns about later tempo edits while preserving actual audio`, async ({ page }) => {
			const fixture = await createAup4Fixture({ SQL, autosave: true, projectTempo: 120, tracks: [{ clips: [{ samples, rawAudioTempo: 60, clipStretchToMatchTempo: false }] }] });
			await page.goto(`/${locale}/tools/converter/aup4-to-aup3/`);
			const converter = page.locator('[data-aup4-aup3-converter]');
			await converter.locator('[data-file-input]').setInputFiles(upload(fixture));
			await converter.locator('[data-convert]').click();
			const download = converter.locator('[data-download]');
			await expect(download).toBeVisible({ timeout: 60_000 });
			const warning = converter.locator('[data-warning-code="AUP4_TEMPO_EDITING_CHANGED"]');
			await expect(warning).toBeVisible();
			await expect(warning).toContainText(locale === 'de' ? 'späteren Änderungen des Projekttempos' : 'later project-tempo changes');
			const bytes = Uint8Array.from(await download.evaluate(async (link) => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()))));
			expect(sqlRows(bytes, 'SELECT * FROM sampleblocks')).toEqual(sqlRows(fixture, 'SELECT * FROM sampleblocks'));
			const decoded = await decodeAup3Bytes(bytes, { SQL });
			expect(Array.from(decoded.channels[0])).toEqual(samples);
			await converter.locator('[data-reset]').click();
			await expect(converter.locator('[data-warning]')).toBeHidden();
			expect(await converter.locator('[data-warning]').getAttribute('data-warning-code')).toBeNull();
		});
	}

	test('the German AUP4 to WAV route produces an audible mix', async ({ page }) => {
		const errors = collectPageErrors(page);
		const fixture = await createAup4Fixture({ SQL });
		await page.goto('/de/tools/converter/aup4-to-wav/');
		await expect(page.getByRole('heading', { name: 'AUP4 zu WAV', exact: true }).first()).toBeVisible();
		const converter = page.locator('[data-aup4-wav-converter]');
		await converter.locator('[data-file-input]').setInputFiles(upload(fixture, 'Aufnahme.aup4'));
		await converter.locator('[data-convert]').click();
		await expect(converter.locator('[data-download]')).toBeVisible({ timeout: 60_000 });
		await expect(converter.locator('[data-download]')).toHaveAttribute('download', 'Aufnahme.wav');
		const wav = await readWav(converter.locator('[data-download]'));
		expect(wav).toMatchObject({ channels: 1, sampleRate: 48_000, bitDepth: 16, decodedLength: 4 });
		expect(wav.samples[0]).toBeCloseTo(0.25, 4);
		expect(wav.samples[1]).toBeCloseTo(-0.5, 4);
		expect(errors).toEqual([]);
	});

	for (const target of ['wav', 'aup3']) {
		test(`AUP4 to ${target} rejects invalid projects, recovers, and resets`, async ({ page }) => {
			const errors = collectPageErrors(page);
			const fixture = await createAup4Fixture({ SQL });
			const futureXml = await createAup4Fixture({ SQL, projectVersion: '2.1.0' });
			const unsupported = fixture.slice();
			new DataView(unsupported.buffer).setUint32(60, 0x04000002, false);
			const wrongId = fixture.slice();
			new DataView(wrongId.buffer).setUint32(68, 0, false);
			await page.goto(`/en/tools/converter/aup4-to-${target}/`);
			const converter = page.locator(`[data-aup4-${target}-converter]`);
			const status = converter.locator('[data-status]');
			const file = converter.locator('[data-file-input]');
			for (const [name, bytes] of [
				['corrupt.aup4', new TextEncoder().encode('not a database')],
				['future.aup4', unsupported],
				['future-xml.aup4', futureXml],
				['wrong-project.aup4', wrongId],
				['truncated.aup4', fixture.slice(0, -1)],
			]) {
				await file.setInputFiles(upload(bytes, name));
				await converter.locator('[data-convert]').click();
				await expect(status).toHaveAttribute('data-state', 'error', { timeout: 60_000 });
				await expect(converter.locator('[data-convert]')).toBeEnabled();
				await expect(converter.locator('[data-download]')).toBeHidden();
			}
			await file.setInputFiles(upload(fixture, 'recovered.aup4'));
			await converter.locator('[data-convert]').click();
			const download = converter.locator('[data-download]');
			await expect(download).toBeVisible({ timeout: 60_000 });
			await expect(download).toHaveAttribute('download', `recovered.${target}`);
			await converter.locator('[data-reset]').click();
			await expect(converter.locator('[data-convert]')).toBeDisabled();
			await expect(download).toBeHidden();
			expect(await download.getAttribute('href')).toBeNull();
			expect(await file.inputValue()).toBe('');
			await expect(status).toHaveAttribute('data-state', 'info');
			if (target === 'wav') await expect(converter.locator('[data-format]')).toHaveValue('pcm16');
			expect(errors).toEqual([]);
		});
	}

	test('changing the AUP4 WAV format removes the previous download until conversion runs again', async ({ page }) => {
		const fixture = await createAup4Fixture({ SQL });
		await page.goto('/en/tools/converter/aup4-to-wav/');
		const converter = page.locator('[data-aup4-wav-converter]');
		await converter.locator('[data-file-input]').setInputFiles(upload(fixture));
		await converter.locator('[data-convert]').click();
		await expect(converter.locator('[data-download]')).toBeVisible({ timeout: 60_000 });
		await converter.locator('[data-format]').selectOption('float32');
		await expect(converter.locator('[data-download]')).toBeHidden();
		expect(await converter.locator('[data-download]').getAttribute('href')).toBeNull();
		await converter.locator('[data-convert]').click();
		await expect(converter.locator('[data-download]')).toBeVisible({ timeout: 60_000 });
		expect(await readWav(converter.locator('[data-download]'))).toMatchObject({ audioFormat: 3, bitDepth: 32 });
	});

	test('the converter overview exposes both new AUP4 tools', async ({ page }) => {
		await page.goto('/en/tools/converter/');
		await page.locator('[data-tool-category-search-input]').fill('aup4');
		await expect(page.getByRole('link', { name: /AUP4 to WAV/ })).toHaveAttribute('href', '/en/tools/converter/aup4-to-wav/');
		await expect(page.getByRole('link', { name: /AUP4 to AUP3/ })).toHaveAttribute('href', '/en/tools/converter/aup4-to-aup3/');
	});
});

function collectPageErrors(page) {
	const errors = [];
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
}

function sqlRows(bytes, query) {
	const database = new SQL.Database(bytes);
	try {
		return database.exec(query)[0]?.values || [];
	} finally {
		database.close();
	}
}

function projectXml(bytes, table) {
	const [dictionary, document] = sqlRows(bytes, `SELECT dict, doc FROM ${table}`)[0];
	return parseAup3BinaryXml(dictionary, document);
}

const readWav = (link) => link.evaluate(async (node) => {
	const buffer = await (await fetch(node.href)).arrayBuffer();
	const bytes = new Uint8Array(buffer);
	const view = new DataView(buffer);
	const audio = await new OfflineAudioContext(1, 1, 48_000).decodeAudioData(buffer.slice(0));
	const ascii = (start, end) => new TextDecoder().decode(bytes.subarray(start, end));
	return {
		riff: ascii(0, 4), wave: ascii(8, 12), data: ascii(36, 40),
		audioFormat: view.getUint16(20, true), channels: view.getUint16(22, true),
		sampleRate: view.getUint32(24, true), bitDepth: view.getUint16(34, true), byteLength: bytes.byteLength,
		decodedChannels: audio.numberOfChannels, decodedRate: audio.sampleRate, decodedLength: audio.length,
		samples: Array.from(audio.getChannelData(0)),
		allSamples: Array.from({ length: audio.numberOfChannels }, (_, channel) => Array.from(audio.getChannelData(channel))),
	};
});
