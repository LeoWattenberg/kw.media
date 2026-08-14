export const COMMIT_GRAPH_REPO = 'LeoWattenberg/Soundscaper';
export const COMMIT_GRAPH_DAYS = 30;
export const COMMIT_GRAPH_PAGE_SIZE = 100;
export const COMMIT_GRAPH_MAX_PAGES = 30;
export const COMMIT_GRAPH_HEAT_STEPS = 5;
/*
 * A single vendored-dependency commit can change a hundred times as many lines as an ordinary hour,
 * and scaling against it leaves every real hour a hairline. The line chart therefore tops out at a
 * quantile of its non-empty cells and marks the bars that run past it — but only when the peak is
 * genuinely far beyond that cut, so an evenly spread window keeps an exact axis.
 */
export const COMMIT_GRAPH_CLIP_QUANTILE = 0.95;
export const COMMIT_GRAPH_CLIP_RATIO = 3;
/*
 * Line counts are not part of the commit list response, so they cost one request per commit. The
 * snapshot job therefore reuses every stat it already knows and tops up at most this many per run,
 * which keeps a first backfill of a busy repository inside the hourly Actions token allowance.
 */
export const COMMIT_GRAPH_MAX_STAT_REQUESTS = 600;
export const COMMIT_GRAPH_STAT_CONCURRENCY = 8;
export const COMMIT_GRAPH_SNAPSHOT_PATH = '/data/soundscaper-commits.json';

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

const monthNames = {
	de: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
	en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

const weekdayNames = {
	de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
	en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
};

export function commitsApiUrl(repo = COMMIT_GRAPH_REPO, { sinceIso, page = 1, perPage = COMMIT_GRAPH_PAGE_SIZE } = {}) {
	const url = new URL(`https://api.github.com/repos/${repo}/commits`);
	if (sinceIso) url.searchParams.set('since', sinceIso);
	url.searchParams.set('per_page', String(perPage));
	url.searchParams.set('page', String(page));
	return url.toString();
}

export function commitStatsUrl(repo = COMMIT_GRAPH_REPO, sha = '') {
	return `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(sha)}`;
}

export function windowStartIso(nowMs, days = COMMIT_GRAPH_DAYS) {
	const span = Math.max(1, Math.floor(Number(days) || 0));
	return new Date(Number(nowMs) - (span + 1) * DAY_MS).toISOString();
}

export function parseLastPage(linkHeader) {
	const links = String(linkHeader || '').split(',');
	for (const link of links) {
		const match = link.match(/<([^>]+)>\s*;\s*rel="last"/);
		if (match) {
			const page = Number(new URL(match[1]).searchParams.get('page'));
			if (Number.isFinite(page) && page > 0) return Math.floor(page);
		}
	}
	return 1;
}

export function parseIsoParts(iso) {
	const match = ISO_PATTERN.exec(String(iso || '').trim());
	if (!match) return null;
	const [, year, month, day, hour, minute, second, zone] = match;
	return {
		year: Number(year),
		month: Number(month),
		day: Number(day),
		hour: Number(hour),
		minute: Number(minute),
		second: Number(second || 0),
		offsetMinutes: parseOffsetMinutes(zone),
	};
}

export function parseOffsetMinutes(zone) {
	if (!zone || zone === 'Z') return 0;
	const match = /^([+-])(\d{2}):?(\d{2})$/.exec(zone);
	if (!match) return 0;
	const sign = match[1] === '-' ? -1 : 1;
	return sign * (Number(match[2]) * 60 + Number(match[3]));
}

export function dayKey(year, month, day) {
	return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function dayKeyToUtcMs(key) {
	const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
	if (!parts) return Number.NaN;
	return Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]));
}

export function utcMsToDayKey(ms) {
	const date = new Date(Number(ms));
	if (Number.isNaN(date.getTime())) return '';
	return dayKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function dayKeysEndingAt(endDayKey, days = COMMIT_GRAPH_DAYS) {
	const end = dayKeyToUtcMs(endDayKey);
	if (Number.isNaN(end)) return [];
	const span = Math.max(1, Math.floor(Number(days) || 0));
	return Array.from({ length: span }, (_, index) => utcMsToDayKey(end - (span - 1 - index) * DAY_MS));
}

export function commitCell(iso, mode = 'commit') {
	if (mode === 'viewer') {
		const date = new Date(String(iso));
		if (Number.isNaN(date.getTime())) return null;
		return { dayKey: dayKey(date.getFullYear(), date.getMonth() + 1, date.getDate()), hour: date.getHours() };
	}

	const parts = parseIsoParts(iso);
	if (!parts) return null;
	return { dayKey: dayKey(parts.year, parts.month, parts.day), hour: parts.hour };
}

export function normalizeCommits(payload) {
	if (!Array.isArray(payload)) return [];

	return payload
		.map((entry) => ({
			sha: String(entry?.sha || '').slice(0, 7),
			iso: entry?.commit?.author?.date || entry?.commit?.committer?.date || '',
			isMerge: Array.isArray(entry?.parents) && entry.parents.length > 1,
		}))
		.filter((commit) => Boolean(commit.iso));
}

export function filterCommits(commits, { includeMerges = true } = {}) {
	const list = Array.isArray(commits) ? commits : [];
	return includeMerges ? list : list.filter((commit) => !commit.isMerge);
}

export function normalizeCommitStats(payload) {
	const additions = Number(payload?.stats?.additions);
	const deletions = Number(payload?.stats?.deletions);
	if (!Number.isFinite(additions) || !Number.isFinite(deletions)) return null;
	return { additions: Math.max(0, Math.round(additions)), deletions: Math.max(0, Math.round(deletions)) };
}

export function hasCommitStats(commit) {
	return Number.isFinite(commit?.additions) && Number.isFinite(commit?.deletions);
}

export function commitStatsBySha(commits) {
	const stats = new Map();
	for (const commit of Array.isArray(commits) ? commits : []) {
		if (commit?.sha && hasCommitStats(commit)) stats.set(commit.sha, { additions: commit.additions, deletions: commit.deletions });
	}
	return stats;
}

/* Live commit lists arrive without line counts, so known stats are grafted back on by sha. */
export function mergeCommitStats(commits, stats) {
	const lookup = stats instanceof Map ? stats : new Map(Object.entries(stats ?? {}));
	return (Array.isArray(commits) ? commits : []).map((commit) => {
		if (hasCommitStats(commit)) return commit;
		const entry = lookup.get(commit?.sha);
		return entry ? { ...commit, additions: entry.additions, deletions: entry.deletions } : commit;
	});
}

export function buildCommitGrid(commits, { mode = 'commit', days = COMMIT_GRAPH_DAYS, endDayKey } = {}) {
	const keys = dayKeysEndingAt(endDayKey, days);
	const rows = keys.map((key) => ({
		dayKey: key,
		hours: new Array(24).fill(0),
		additions: new Array(24).fill(0),
		deletions: new Array(24).fill(0),
		total: 0,
		added: 0,
		removed: 0,
	}));
	const rowsByKey = new Map(rows.map((row) => [row.dayKey, row]));
	const hours = new Array(24).fill(0);
	let total = 0;
	let skipped = 0;
	let statCommits = 0;
	let added = 0;
	let removed = 0;

	for (const commit of Array.isArray(commits) ? commits : []) {
		const cell = commitCell(commit?.iso, mode);
		const row = cell && rowsByKey.get(cell.dayKey);
		if (!row) {
			skipped += 1;
			continue;
		}
		row.hours[cell.hour] += 1;
		row.total += 1;
		hours[cell.hour] += 1;
		total += 1;
		if (!hasCommitStats(commit)) continue;
		row.additions[cell.hour] += commit.additions;
		row.deletions[cell.hour] += commit.deletions;
		row.added += commit.additions;
		row.removed += commit.deletions;
		added += commit.additions;
		removed += commit.deletions;
		statCommits += 1;
	}

	const cells = rows.flatMap((row) => row.hours);
	const lineCells = rows.flatMap((row) => [...row.additions, ...row.deletions]);

	return {
		days: rows,
		hours,
		total,
		skipped,
		statCommits,
		added,
		removed,
		maxHour: Math.max(0, ...hours),
		maxCell: Math.max(0, ...cells),
		lineScale: clipScale(lineCells),
		heatScale: buildHeatScale(cells),
	};
}

export function summarizeGrid(grid) {
	const rows = grid?.days ?? [];
	const hours = grid?.hours ?? new Array(24).fill(0);
	const busiestHour = hours.reduce((best, count, hour) => (count > hours[best] ? hour : best), 0);
	const busiestDay = rows.reduce((best, row) => (best && best.total >= row.total ? best : row), rows[0] ?? null);
	const total = grid?.total ?? 0;
	const added = grid?.added ?? 0;
	const removed = grid?.removed ?? 0;
	const peak = peakCell(rows, (row, hour) => row.hours[hour]);
	const peakLines = peakCell(rows, (row, hour) => row.additions[hour] + row.deletions[hour]);

	return {
		total,
		activeDays: rows.filter((row) => row.total > 0).length,
		trackedDays: rows.length,
		busiestHour,
		busiestHourTotal: hours[busiestHour] ?? 0,
		busiestDayKey: busiestDay?.dayKey ?? '',
		busiestDayTotal: busiestDay?.total ?? 0,
		dailyAverage: rows.length ? total / rows.length : 0,
		added,
		removed,
		net: added - removed,
		statCommits: grid?.statCommits ?? 0,
		statMissing: Math.max(0, total - (grid?.statCommits ?? 0)),
		dailyAddedAverage: rows.length ? added / rows.length : 0,
		dailyRemovedAverage: rows.length ? removed / rows.length : 0,
		peakDayKey: peak.dayKey,
		peakHour: peak.hour,
		peakTotal: peak.total,
		peakLinesDayKey: peakLines.dayKey,
		peakLinesHour: peakLines.hour,
		peakLinesTotal: peakLines.total,
	};
}

/* The busiest single hour of the window, which is what the time series peaks at. */
function peakCell(rows, valueOf) {
	let best = { dayKey: '', hour: 0, total: 0 };
	for (const row of rows) {
		for (let hour = 0; hour < 24; hour += 1) {
			const value = valueOf(row, hour);
			if (value > best.total) best = { dayKey: row.dayKey, hour, total: value };
		}
	}
	return best;
}

/*
 * Commit activity is long-tailed: one release day can hold ten times a normal day, and scaling the
 * ramp linearly against that peak collapses every ordinary hour into the palest step. The scale is
 * therefore cut at quantiles of the non-empty cells, so each step carries a comparable share of them.
 */
export function buildHeatScale(values, steps = COMMIT_GRAPH_HEAT_STEPS) {
	const positives = (Array.isArray(values) ? values : []).filter((value) => value > 0).sort((first, second) => first - second);
	if (!positives.length) return [];

	return Array.from({ length: Math.max(1, steps) - 1 }, (_, index) =>
		positives[Math.min(positives.length - 1, Math.floor((positives.length * (index + 1)) / steps))]);
}

export function clipScale(values, { quantile = COMMIT_GRAPH_CLIP_QUANTILE, ratio = COMMIT_GRAPH_CLIP_RATIO } = {}) {
	const positives = (Array.isArray(values) ? values : []).filter((value) => value > 0).sort((first, second) => first - second);
	const max = positives.length ? positives[positives.length - 1] : 0;
	const cut = positives.length ? positives[Math.floor((positives.length - 1) * quantile)] : 0;
	if (!positives.length || max <= cut * ratio) return { ceiling: max, max, clipped: 0, cells: positives.length };

	const ceiling = roundUpToTick(cut);
	return { ceiling, max, clipped: positives.filter((value) => value > ceiling).length, cells: positives.length };
}

/* Axis ends read as ticks, so they land on a half-magnitude step: 5,881 becomes 6,000. */
export function roundUpToTick(value) {
	const amount = Number(value) || 0;
	if (amount <= 0) return 0;
	const step = 10 ** Math.floor(Math.log10(amount)) / 2;
	return Math.ceil(amount / step) * step;
}

export function heatLevel(count, scale) {
	if (!(count > 0)) return 0;
	const thresholds = Array.isArray(scale) ? scale : [];
	const index = thresholds.findIndex((threshold) => count <= threshold);
	return index === -1 ? thresholds.length + 1 : index + 1;
}

export function formatHourLabel(hour) {
	return `${String(Math.max(0, Math.min(23, Math.floor(Number(hour) || 0)))).padStart(2, '0')}:00`;
}

export function formatHourRange(hour) {
	const start = Math.max(0, Math.min(23, Math.floor(Number(hour) || 0)));
	return `${formatHourLabel(start)}–${formatHourLabel((start + 1) % 24)}`;
}

export function formatLineCount(value, locale = 'en') {
	const count = Math.round(Number(value) || 0);
	return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US').format(count);
}

/* Line totals read as a delta, so they always carry a sign, using the typographic minus. */
export function formatSignedLines(value, locale = 'en') {
	const count = Math.round(Number(value) || 0);
	const sign = count > 0 ? '+' : count < 0 ? '−' : '±';
	return `${sign}${formatLineCount(Math.abs(count), locale)}`;
}

export function formatDayLabel(key, locale = 'en') {
	const ms = dayKeyToUtcMs(key);
	if (Number.isNaN(ms)) return '';
	const date = new Date(ms);
	const months = monthNames[locale] ?? monthNames.en;
	const weekdays = weekdayNames[locale] ?? weekdayNames.en;
	const weekday = weekdays[date.getUTCDay()];
	const month = months[date.getUTCMonth()];
	return locale === 'de'
		? `${weekday} ${date.getUTCDate()}. ${month}`
		: `${weekday} ${date.getUTCDate()} ${month}`;
}

export function isWeekend(key) {
	const ms = dayKeyToUtcMs(key);
	if (Number.isNaN(ms)) return false;
	const weekday = new Date(ms).getUTCDay();
	return weekday === 0 || weekday === 6;
}

export function describeRateLimit(headers) {
	const read = (name) => {
		const raw = headers?.get?.(name);
		if (raw === null || raw === undefined || raw === '') return null;
		const value = Number(raw);
		return Number.isFinite(value) ? value : null;
	};
	const reset = read('x-ratelimit-reset');

	return {
		limit: read('x-ratelimit-limit'),
		remaining: read('x-ratelimit-remaining'),
		resetMs: reset === null ? null : reset * 1000,
	};
}

export async function fetchCommitWindow({
	repo = COMMIT_GRAPH_REPO,
	sinceIso,
	token = '',
	maxPages = COMMIT_GRAPH_MAX_PAGES,
	concurrency = 4,
	fetchImpl,
	signal,
	onProgress,
} = {}) {
	const request = fetchImpl ?? globalThis.fetch;
	if (typeof request !== 'function') throw new Error('Fetch is not available in this environment.');

	const headers = { accept: 'application/vnd.github+json' };
	if (token) headers.authorization = `Bearer ${token}`;

	const load = async (page) => {
		const response = await request(commitsApiUrl(repo, { sinceIso, page }), { headers, signal });
		if (!response.ok) throw commitRequestError(response);
		return { response, commits: normalizeCommits(await response.json()) };
	};

	const first = await load(1);
	const lastPage = Math.min(parseLastPage(first.response.headers?.get?.('link')), Math.max(1, maxPages));
	const pages = new Array(lastPage);
	pages[0] = first.commits;
	let loaded = 1;
	onProgress?.({ loaded, total: lastPage, commits: first.commits.length });

	const queue = Array.from({ length: lastPage - 1 }, (_, index) => index + 2);
	const workers = Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, async () => {
		for (let page = queue.shift(); page !== undefined; page = queue.shift()) {
			const { commits } = await load(page);
			pages[page - 1] = commits;
			loaded += 1;
			onProgress?.({ loaded, total: lastPage, commits: pages.reduce((sum, entry) => sum + (entry?.length ?? 0), 0) });
		}
	});
	await Promise.all(workers);

	return {
		commits: pages.flatMap((entry) => entry ?? []),
		pages: lastPage,
		truncated: parseLastPage(first.response.headers?.get?.('link')) > lastPage,
		rateLimit: describeRateLimit(first.response.headers),
	};
}

/*
 * One request per commit, so callers pass an already-trimmed sha list. A rate limit drains the queue
 * instead of rejecting: a partial stat set still improves the snapshot, and the next run tops it up.
 */
export async function fetchCommitStats({
	repo = COMMIT_GRAPH_REPO,
	shas = [],
	token = '',
	concurrency = COMMIT_GRAPH_STAT_CONCURRENCY,
	fetchImpl,
	signal,
	onProgress,
} = {}) {
	const request = fetchImpl ?? globalThis.fetch;
	if (typeof request !== 'function') throw new Error('Fetch is not available in this environment.');

	const headers = { accept: 'application/vnd.github+json' };
	if (token) headers.authorization = `Bearer ${token}`;

	const queue = Array.isArray(shas) ? [...shas] : [];
	const total = queue.length;
	const stats = {};
	let requests = 0;
	let limitError = null;

	const workers = Array.from({ length: Math.max(1, Math.min(concurrency, total)) }, async () => {
		for (let sha = queue.shift(); sha !== undefined && !limitError; sha = queue.shift()) {
			const response = await request(commitStatsUrl(repo, sha), { headers, signal });
			requests += 1;
			if (!response.ok) {
				const error = commitRequestError(response);
				if (error.rateLimited) limitError = error;
				continue;
			}
			const entry = normalizeCommitStats(await response.json());
			if (entry) stats[sha] = entry;
			onProgress?.({ loaded: requests, total, sha });
		}
	});
	await Promise.all(workers);

	return { stats, requests, rateLimited: Boolean(limitError), rateLimit: limitError?.rateLimit ?? null };
}

export function commitRequestError(response) {
	const rateLimit = describeRateLimit(response?.headers);
	const limited = response?.status === 403 && rateLimit.remaining === 0;
	const error = new Error(limited ? 'GitHub API rate limit reached' : `GitHub API request failed with status ${response?.status}`);
	error.status = response?.status ?? 0;
	error.rateLimit = rateLimit;
	error.rateLimited = limited;
	return error;
}

export function buildCommitSnapshot(commits, { repo = COMMIT_GRAPH_REPO, days = COMMIT_GRAPH_DAYS, truncated = false, generatedAt } = {}) {
	const sorted = [...(Array.isArray(commits) ? commits : [])].sort((first, second) => String(second.iso).localeCompare(String(first.iso)));
	const merges = [];
	sorted.forEach((commit, index) => {
		if (commit.isMerge) merges.push(index);
	});

	const snapshot = {
		repo,
		windowDays: days,
		truncated,
		generatedAt: generatedAt ?? '',
		timestamps: sorted.map((commit) => commit.iso),
		shas: sorted.map((commit) => commit.sha ?? ''),
		merges,
	};

	/* Line counts arrive over several runs, so the arrays only ship once at least one commit has them. */
	if (sorted.some((commit) => hasCommitStats(commit))) {
		snapshot.additions = sorted.map((commit) => (hasCommitStats(commit) ? commit.additions : null));
		snapshot.deletions = sorted.map((commit) => (hasCommitStats(commit) ? commit.deletions : null));
	}

	return snapshot;
}

export function parseCommitSnapshot(payload) {
	if (!Array.isArray(payload?.timestamps)) return null;
	const merges = new Set(Array.isArray(payload.merges) ? payload.merges : []);
	const shas = Array.isArray(payload.shas) ? payload.shas : [];
	const additions = Array.isArray(payload.additions) ? payload.additions : [];
	const deletions = Array.isArray(payload.deletions) ? payload.deletions : [];

	return {
		repo: payload.repo ?? COMMIT_GRAPH_REPO,
		windowDays: Number(payload.windowDays) || COMMIT_GRAPH_DAYS,
		truncated: Boolean(payload.truncated),
		generatedAt: typeof payload.generatedAt === 'string' ? payload.generatedAt : '',
		commits: payload.timestamps.map((iso, index) => {
			const commit = { sha: String(shas[index] ?? ''), iso: String(iso), isMerge: merges.has(index) };
			if (Number.isFinite(additions[index]) && Number.isFinite(deletions[index])) {
				commit.additions = additions[index];
				commit.deletions = deletions[index];
			}
			return commit;
		}),
	};
}

export function snapshotIsEquivalent(first, second) {
	if (!first || !second) return false;
	const compared = ({ repo, windowDays, truncated, timestamps, shas, merges, additions, deletions }) =>
		JSON.stringify({ repo, windowDays, truncated, timestamps, shas, merges, additions, deletions });
	return compared(first) === compared(second);
}

export function formatAge(ageMs, locale = 'en') {
	const minutes = Math.floor(Number(ageMs) / 60000);
	if (!Number.isFinite(minutes) || minutes < 1) return locale === 'de' ? 'unter 1 Minute' : 'under 1 minute';

	const units = locale === 'de'
		? [[1440, 'Tag', 'Tage'], [60, 'Stunde', 'Stunden'], [1, 'Minute', 'Minuten']]
		: [[1440, 'day', 'days'], [60, 'hour', 'hours'], [1, 'minute', 'minutes']];

	for (const [size, singular, plural] of units) {
		if (minutes >= size) {
			const value = Math.floor(minutes / size);
			return `${value} ${value === 1 ? singular : plural}`;
		}
	}

	return locale === 'de' ? 'unter 1 Minute' : 'under 1 minute';
}
