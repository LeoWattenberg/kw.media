// Refresh the offline/no-JavaScript fallback. Browsers also refresh the two current releases on each visit.
import { writeFile } from 'node:fs/promises';
import { AUDACITY_3_RELEASE_URL, AUDACITY_RELEASES_URL, fetchSoundscaperRelease, parseAudacity3Release, parseAudacityReleases } from '../src/lib/audacity-downloads.js';

async function read(url, format) {
	const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
	if (!response.ok) throw new Error(`Release lookup failed (${response.status}): ${url}`);
	return response[format]();
}

const [soundscaper, audacity4, audacity3] = await Promise.all([
	fetchSoundscaperRelease(),
	read(AUDACITY_RELEASES_URL, 'text').then(parseAudacityReleases),
	read(AUDACITY_3_RELEASE_URL, 'json').then(parseAudacity3Release),
]);
await writeFile(new URL('../src/data/audacity-downloads.json', import.meta.url), JSON.stringify({ soundscaper, audacity4, audacity3 }, null, '\t') + '\n');
console.log(`Saved Soundscaper ${soundscaper.version}, Audacity ${audacity4.version} and ${audacity3.version}.`);
