import { cleanupLastCommitPosts } from './content-ai.mjs';

const results = await cleanupLastCommitPosts();

if (!results.length) {
	console.log('No markdown posts found in the last commit.');
} else {
	console.log(`Cleaned ${results.length} post(s) from the last commit:`);
	for (const result of results) {
		console.log(`- ${result.filePath} with ${result.model} (${result.category})`);
	}
}
