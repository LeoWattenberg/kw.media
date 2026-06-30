import { cleanupPostFile } from './content-ai.mjs';

const filePaths = process.argv.slice(2);

if (!filePaths.length) {
	console.error('Usage: node scripts/cleanup-post.mjs src/data/posts/.../post.md [more-posts.md]');
	process.exit(1);
}

for (const filePath of filePaths) {
	const result = await cleanupPostFile(filePath);
	console.log(`Cleaned ${result.filePath} with ${result.model} (${result.category})`);
}
