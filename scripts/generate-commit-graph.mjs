#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	COMMIT_GRAPH_DAYS,
	COMMIT_GRAPH_REPO,
	buildCommitSnapshot,
	fetchCommitWindow,
	snapshotIsEquivalent,
	windowStartIso,
} from '../src/lib/tools/commit-graph.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'public', 'data', 'soundscaper-commits.json');

const repo = process.env.COMMIT_GRAPH_REPO || COMMIT_GRAPH_REPO;
const days = Number(process.env.COMMIT_GRAPH_DAYS) || COMMIT_GRAPH_DAYS;
const token = process.env.GITHUB_TOKEN || '';

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

const snapshot = buildCommitSnapshot(result.commits, {
	repo,
	days,
	truncated: result.truncated,
	generatedAt: new Date().toISOString(),
});
const existing = await readFile(OUTPUT_PATH, 'utf8').then(JSON.parse).catch(() => null);

if (snapshotIsEquivalent(existing, snapshot)) {
	console.log(`No commit changes since the last snapshot; keeping ${path.relative(REPO_ROOT, OUTPUT_PATH)} untouched.`);
	process.exit(0);
}

await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot, null, '\t')}\n`);
console.log(`Wrote ${snapshot.timestamps.length} commits (${snapshot.merges.length} merges) to ${path.relative(REPO_ROOT, OUTPUT_PATH)}.`);
