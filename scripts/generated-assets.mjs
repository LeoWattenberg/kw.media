#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');

// The scheduled generators rewrite these paths and nothing else. They are kept off main
// because a fresh MP3 Guesser day is about five megabytes of audio: a year of daily
// commits would add gigabytes to every clone. Instead each publish replaces the branch
// below with a single parentless commit, so the branch never holds more than the current
// snapshot no matter how long the generators keep running.
const GENERATED_PATHS = ['public/data/soundscaper-commits.json', 'public/games/mp3guesser'];

const BRANCH = process.env.GENERATED_BRANCH || 'generated';
const REMOTE = process.env.GENERATED_REMOTE || 'origin';

function git(args, { env, allowFailure = false } = {}) {
	const result = spawnSync('git', args, {
		cwd: REPO_ROOT,
		encoding: 'utf8',
		env: { ...process.env, ...env },
	});

	if (result.error) throw result.error;

	if (result.status !== 0 && !allowFailure) {
		const message = (result.stderr || result.stdout || '').trim();
		throw new Error(`git ${args.join(' ')} failed: ${message}`);
	}

	return { ok: result.status === 0, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function fetchBranch() {
	// The branch is a single root commit, so there is no history worth limiting here.
	const fetched = git(['fetch', '--no-tags', REMOTE, BRANCH], { allowFailure: true });

	if (!fetched.ok) {
		console.warn(`No ${REMOTE}/${BRANCH} branch yet; continuing without a previous snapshot.`);
		return false;
	}

	return true;
}

function pathsInTree(ref) {
	const listed = git(['ls-tree', '-r', '--name-only', ref, '--', ...GENERATED_PATHS], { allowFailure: true });
	if (!listed.ok || !listed.stdout) return [];

	const files = listed.stdout.split('\n');
	return GENERATED_PATHS.filter((entry) => files.some((file) => file === entry || file.startsWith(`${entry}/`)));
}

// Writes the branch contents into the working tree without staging them, so the ignored
// snapshot paths cannot slip into a commit on main.
function restore() {
	if (!fetchBranch()) return;

	const available = pathsInTree('FETCH_HEAD');

	if (!available.length) {
		console.warn(`${REMOTE}/${BRANCH} holds none of the generated paths; nothing to restore.`);
		return;
	}

	git(['restore', '--source=FETCH_HEAD', '--worktree', '--', ...available]);
	console.log(`Restored ${available.join(', ')} from ${REMOTE}/${BRANCH}.`);
}

// Builds the commit in a scratch index so the checked-out branch, its index, and any
// unrelated local changes stay untouched.
function publish(message) {
	const present = GENERATED_PATHS.filter((entry) => existsSync(path.join(REPO_ROOT, entry)));

	if (!present.length) {
		throw new Error(`None of ${GENERATED_PATHS.join(', ')} exist; refusing to publish an empty snapshot.`);
	}

	const indexFile = path.join(os.tmpdir(), `generated-assets-${process.pid}.index`);
	rmSync(indexFile, { force: true });

	try {
		git(['add', '--force', '--', ...present], { env: { GIT_INDEX_FILE: indexFile } });
		const tree = git(['write-tree'], { env: { GIT_INDEX_FILE: indexFile } }).stdout;
		const commit = git(['commit-tree', tree, '-m', message]).stdout;

		git(['push', '--force', REMOTE, `${commit}:refs/heads/${BRANCH}`]);
		console.log(`Pushed ${present.join(', ')} to ${REMOTE}/${BRANCH} as ${commit.slice(0, 7)}.`);
	} finally {
		rmSync(indexFile, { force: true });
	}
}

const [command, ...rest] = process.argv.slice(2);
const message = rest.join(' ').trim();

if (command === 'restore') {
	restore();
} else if (command === 'publish' && message) {
	publish(message);
} else {
	console.error('Usage: node scripts/generated-assets.mjs restore');
	console.error('       node scripts/generated-assets.mjs publish "<commit message>"');
	process.exit(1);
}
