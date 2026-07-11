export function relatedPathsToRefresh(posts, candidatePathsByPost, targetPaths) {
	const targets = new Set(targetPaths);

	return posts
		.map((post) => post.frontmatter.path)
		.filter((path) => (
			targets.has(path)
			|| (candidatePathsByPost.get(path) ?? []).some((candidatePath) => targets.has(candidatePath))
		));
}
