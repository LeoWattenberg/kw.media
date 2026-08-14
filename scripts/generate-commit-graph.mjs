#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	COMMIT_GRAPH_DAYS,
	COMMIT_GRAPH_MAX_STAT_REQUESTS,
	COMMIT_GRAPH_REPO,
	buildCommitSnapshot,
	commitStatsBySha,
	fetchCommitStats,
	fetchCommitWindow,
	hasCommitStats,
	mergeCommitStats,
	parseCommitSnapshot,
	snapshotIsEquivalent,
	windowStartIso,
} from '../src/lib/tools/commit-graph.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'public', 'data', 'soundscaper-commits.json');

const repo = process.env.COMMIT_GRAPH_REPO || COMMIT_GRAPH_REPO;
const days = Number(process.env.COMMIT_GRAPH_DAYS) || COMMIT_GRAPH_DAYS;
const token = process.env.GITHUB_TOKEN || '';
const statBudget = Number(process.env.COMMIT_GRAPH_MAX_STAT_REQUESTS ?? COMMIT_GRAPH_MAX_STAT_REQUESTS);

const sinceIso = windowStartIso(Date.now(), days);
console.log(`Fetching ${repo} commits since ${sinceIso}${token ? ' with a token' : ' anonymously'}.`);

const result = await fetchCommitWindow({
	repo,
	sinceIso,
	token,
	onProgress: ({ loaded, total, commits }) => console.log(`  page ${loaded}/${total} — ${commits} commits`),
});

if (result.truncated) {
	console.warn(`Stopped at ${result.pages} pages; older commits inside the window are missing from the snapshot.`);
}

const existing = await readFile(OUTPUT_PATH, 'utf8').then(JSON.parse).catch(() => null);
const known = commitStatsBySha(parseCommitSnapshot(existing)?.commits ?? []);
const commits = mergeCommitStats(result.commits, known);
const pending = commits.filter((commit) => !hasCommitStats(commit)).map((commit) => commit.sha);

if (pending.length) {
	const wanted = Math.max(0, Math.floor(statBudget) || 0);
	const shas = pending.slice(0, wanted);
	console.log(`Reused line counts for ${known.size} commits; fetching ${shas.length} of ${pending.length} still missing.`);

	if (shas.length) {
		const fetched = await fetchCommitStats({
			repo,
			shas,
			token,
			onProgress: ({ loaded, total }) => {
				if (loaded % 50 === 0 || loaded === total) console.log(`  line counts ${loaded}/${total}`);
			},
		});
		if (fetched.rateLimited) console.warn('GitHub rate limit reached while reading line counts; the next run continues the backfill.');
		for (const [index, commit] of commits.entries()) {
			const entry = fetched.stats[commit.sha];
			if (entry) commits[index] = { ...commit, ...entry };
		}
	}
}

const covered = commits.filter((commit) => hasCommitStats(commit)).length;
const snapshot = buildCommitSnapshot(commits, {
	repo,
	days,
	truncated: result.truncated,
	generatedAt: new Date().toISOString(),
});

if (snapshotIsEquivalent(existing, snapshot)) {
	console.log(`No commit changes since the last snapshot; keeping ${path.relative(REPO_ROOT, OUTPUT_PATH)} untouched.`);
	process.exit(0);
}

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, '\t')}\n`);
console.log(`Wrote ${snapshot.timestamps.length} commits (${snapshot.merges.length} merges, ${covered} with line counts) to ${path.relative(REPO_ROOT, OUTPUT_PATH)}.`);
