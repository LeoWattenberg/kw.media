#!/usr/bin/env node
// Mints the small binary fixtures in tests/fixtures/ that the tool tests feed to
// the converters. They are generated through Chromium rather than checked in by
// hand so the media is genuinely decodable: MediaRecorder writes real MP4/WebM
// containers and canvas.toBlob writes real JPEG/WebP/PNG encodings, which is what
// makes "the tool converted the file" an assertion about actual bytes.
//
// Run with `npm run fixtures:test`. Only re-run when a fixture needs to change;
// the outputs are committed so `npm test` and Playwright never depend on the
// gitignored reference/ media.
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(SCRIPT_DIR, '..', 'tests', 'fixtures');

const VIDEO_FIXTURES = [
	['tiny-clip.mp4', 'video/mp4'],
	['tiny-clip.webm', 'video/webm;codecs=vp8'],
];

const browser = await chromium.launch();

try {
	const page = await browser.newPage();
	await page.goto('about:blank');

	for (const [name, mimeType] of VIDEO_FIXTURES) {
		const supported = await page.evaluate((type) => MediaRecorder.isTypeSupported(type), mimeType);
		if (!supported) {
			console.warn(`Skipping ${name}: this Chromium cannot record ${mimeType}.`);
			continue;
		}

		const bytes = await page.evaluate(async (type) => {
			const canvas = document.createElement('canvas');
			canvas.width = 160;
			canvas.height = 120;
			const context = canvas.getContext('2d');
			let frame = 0;
			// A moving block keeps every frame different, so encoders cannot collapse
			// the clip into a single keyframe and tools have real motion to work with.
			const draw = () => {
				context.fillStyle = `hsl(${(frame * 24) % 360} 80% 50%)`;
				context.fillRect(0, 0, 160, 120);
				context.fillStyle = '#000000';
				context.fillRect((frame * 8) % 140, 40, 20, 40);
				frame += 1;
			};

			draw();
			const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: type, videoBitsPerSecond: 120_000 });
			const chunks = [];
			recorder.ondataavailable = (event) => chunks.push(event.data);
			recorder.start();
			const timer = setInterval(draw, 66);
			await new Promise((resolve) => setTimeout(resolve, 1000));
			clearInterval(timer);
			const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
			recorder.stop();
			await stopped;

			return [...new Uint8Array(await new Blob(chunks, { type }).arrayBuffer())];
		}, mimeType);

		const buffer = Buffer.from(bytes);
		await writeFile(path.join(FIXTURE_DIR, name), buffer);
		console.log(`${name}: ${buffer.length} bytes`);
	}

	const images = await page.evaluate(async () => {
		const canvas = document.createElement('canvas');
		canvas.width = 96;
		canvas.height = 64;
		const context = canvas.getContext('2d');
		const gradient = context.createLinearGradient(0, 0, 96, 64);
		gradient.addColorStop(0, '#2f80ed');
		gradient.addColorStop(1, '#f2994a');
		context.fillStyle = gradient;
		context.fillRect(0, 0, 96, 64);
		context.fillStyle = '#ffffff';
		context.beginPath();
		context.arc(48, 32, 18, 0, Math.PI * 2);
		context.fill();

		const encode = async (type, quality) => {
			const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
			return [...new Uint8Array(await blob.arrayBuffer())];
		};

		return {
			'tiny-photo.jpg': await encode('image/jpeg', 0.9),
			'tiny-photo.webp': await encode('image/webp', 0.9),
			'tiny-photo.png': await encode('image/png'),
		};
	});

	for (const [name, bytes] of Object.entries(images)) {
		const buffer = Buffer.from(bytes);
		await writeFile(path.join(FIXTURE_DIR, name), buffer);
		console.log(`${name}: ${buffer.length} bytes`);
	}
} finally {
	await browser.close();
}
