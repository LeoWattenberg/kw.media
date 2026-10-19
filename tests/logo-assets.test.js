import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const logoDir = fileURLToPath(new URL('../public/logo/', import.meta.url));

// Logos load through <img>, where SVGs cannot use the page's web fonts. Live text would
// fall back to whatever font the device has, so every letter has to be a path.
test('logo SVGs contain no live text', () => {
	const logos = readdirSync(logoDir).filter((name) => name.endsWith('.svg'));
	assert.ok(logos.length >= 4);

	for (const name of logos) {
		assert.doesNotMatch(readFileSync(`${logoDir}${name}`, 'utf8'), /<(text|tspan)\b/, `${name} still has a <text> element`);
	}
});
