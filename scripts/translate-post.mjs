import { translatePostFile } from './content-ai.mjs';

const filePaths = process.argv.slice(2);

if (!filePaths.length) {
	console.error('Usage: node scripts/translate-post.mjs src/data/posts/.../post.md [more-posts.md]');
	process.exit(1);
}

for (const filePath of filePaths) {
	const result = await translatePostFile(filePath);
	if (result.skipped) {
		console.log(`Skipped ${result.sourcePath}: ${result.reason}`);
	} else {
		console.log(`Translated ${result.sourcePath} -> ${result.targetPath} with ${result.model}`);
	}
}
