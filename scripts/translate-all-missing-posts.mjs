import { translateAllMissingPosts } from './content-ai.mjs';

const results = await translateAllMissingPosts();
const created = results.filter((result) => !result.skipped);
const skipped = results.filter((result) => result.skipped);

if (created.length) {
	console.log(`Translated ${created.length} post(s):`);
	for (const result of created) {
		console.log(`- ${result.sourcePath} -> ${result.targetPath} with ${result.model}`);
	}
} else {
	console.log('No missing translations created.');
}

if (skipped.length) {
	console.log(`Skipped ${skipped.length} post(s) that already have translations:`);
	for (const result of skipped) {
		console.log(`- ${result.sourcePath}: ${result.reason}`);
	}
}
