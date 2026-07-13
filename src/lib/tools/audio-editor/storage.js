import { collectProjectSourceIds, compactProjectSourceMetadata } from './retention.js';

const DATABASE_VERSION = 1;
const DEFAULT_DATABASE_NAME = 'kw-media-audio-editor';
const PENDING_SOURCE_RETENTION_MS = 24 * 60 * 60 * 1000;
const memoryDatabases = new Map();

/**
 * Local project/source persistence. IndexedDB is preferred; a process-local
 * memory implementation keeps the editor usable in private or restricted
 * contexts where IndexedDB cannot be opened.
 */
export function createProjectStore(options = {}) {
	return new AudioEditorProjectStore(options);
}

export class AudioEditorProjectStore {
	constructor({
		indexedDB = globalThis.indexedDB,
		databaseName = DEFAULT_DATABASE_NAME,
		memoryFallback = true,
		storageManager = globalThis.navigator?.storage,
		opfsRoot = null,
		preferOpfs = true,
		revisionLimit = 20,
	} = {}) {
		this.databaseName = databaseName;
		this.indexedDB = indexedDB;
		this.memoryFallback = memoryFallback;
		this.storageManager = storageManager;
		this.opfsRoot = opfsRoot;
		this.preferOpfs = preferOpfs;
		this.revisionLimit = Math.max(2, Math.floor(revisionLimit));
		this.opfsDirectoryPromise = null;
		this.backend = indexedDB ? 'indexeddb' : 'memory';
		this.databasePromise = null;
		this.memory = getMemoryDatabase(databaseName);
		this.sourcePrunePromise = Promise.resolve();
	}

	async ready() {
		await this.#database();
		return this;
	}

	async saveProject(project) {
		if (!project || typeof project.id !== 'string' || !project.id) {
			throw new Error('A project with a stable string id is required.');
		}
		const snapshot = compactProjectSourceMetadata(clone(project));
		const revision = nonNegativeInteger(snapshot.revision, 0);
		const revisionRecord = {
			key: revisionKey(snapshot.id, revision),
			projectId: snapshot.id,
			revision,
			project: snapshot,
		};
		const database = await this.#database();
		if (!database) {
			this.memory.projects.set(snapshot.id, snapshot);
			this.memory.revisions.set(revisionRecord.key, revisionRecord);
			for (const sourceId of collectProjectSourceIds(snapshot)) {
				const source = this.memory.sources.get(sourceId);
				if (source?.pendingProjectUntil) this.memory.sources.set(sourceId, publishSource(source));
			}
			await this.#pruneProjectRevisions(snapshot.id);
			return clone(snapshot);
		}

		await transact(database, ['projects', 'revisions', 'sources'], 'readwrite', async ({ projects, revisions, sources }) => {
			projects.put(snapshot);
			revisions.put(revisionRecord);
			for (const sourceId of collectProjectSourceIds(snapshot)) {
				const source = await request(sources.get(sourceId));
				if (source?.pendingProjectUntil) sources.put(publishSource(source));
			}
		});
		await this.#pruneProjectRevisions(snapshot.id);
		return clone(snapshot);
	}

	async loadProject(projectId, { revision } = {}) {
		const database = await this.#database();
		if (!database) {
			const value = revision === undefined
				? this.memory.projects.get(projectId)
				: this.memory.revisions.get(revisionKey(projectId, revision))?.project;
			return value ? clone(compactProjectSourceMetadata(value)) : null;
		}

		const storeName = revision === undefined ? 'projects' : 'revisions';
		const key = revision === undefined ? projectId : revisionKey(projectId, revision);
		const value = await transact(database, storeName, 'readonly', (stores) => request(stores[storeName].get(key)));
		return value ? clone(compactProjectSourceMetadata(value.project || value)) : null;
	}

	async listProjects() {
		const database = await this.#database();
		if (!database) {
			return [...this.memory.projects.values()].map((project) => clone(compactProjectSourceMetadata(project))).sort(sortProjects);
		}
		const projects = await transact(database, 'projects', 'readonly', ({ projects }) => request(projects.getAll()));
		return projects.map((project) => clone(compactProjectSourceMetadata(project))).sort(sortProjects);
	}

	async listProjectRevisions(projectId) {
		const database = await this.#database();
		let records;
		if (!database) {
			records = [...this.memory.revisions.values()].filter((record) => record.projectId === projectId);
		} else {
			records = await transact(database, 'revisions', 'readonly', ({ revisions }) => {
				return request(revisions.index('projectId').getAll(projectId));
			});
		}
		return records.sort((left, right) => right.revision - left.revision).map((record) => ({
			revision: record.revision,
			project: clone(compactProjectSourceMetadata(record.project)),
		}));
	}

	async deleteProject(projectId) {
		const database = await this.#database();
		if (!database) {
			this.memory.projects.delete(projectId);
			for (const [key, record] of this.memory.revisions) {
				if (record.projectId === projectId) this.memory.revisions.delete(key);
			}
			return;
		}
		await transact(database, ['projects', 'revisions'], 'readwrite', async ({ projects, revisions }) => {
			projects.delete(projectId);
			await deleteByIndex(revisions.index('projectId'), projectId);
		});
	}

	async duplicateProject(projectId, { id, title } = {}) {
		const source = await this.loadProject(projectId);
		if (!source) throw new Error('The project to duplicate could not be found.');
		const timestamp = new Date().toISOString();
		const copy = {
			...source,
			id: id || createId('project'),
			title: title || `${source.title || 'Untitled'} copy`,
			revision: 0,
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		return this.saveProject(copy);
	}

	async saveSetting(key, value) {
		return this.#putKeyValue('settings', key, value);
	}

	async loadSetting(key, fallback = null) {
		const value = await this.#getKeyValue('settings', key);
		return value === undefined ? fallback : value;
	}

	async saveAnalysis(key, value) {
		return this.#putKeyValue('analysis', key, value);
	}

	async loadAnalysis(key) {
		return (await this.#getKeyValue('analysis', key)) ?? null;
	}

	async deleteAnalysis(key) {
		const database = await this.#database();
		if (!database) this.memory.analysis.delete(key);
		else await transact(database, 'analysis', 'readwrite', ({ analysis }) => { analysis.delete(key); });
	}

	/**
	 * Start an atomic, chunked source write. Each `write()` persists its chunk
	 * before resolving, so a recording never needs to retain the whole take.
	 */
	async beginSourceWrite(sourceId, metadata = {}) {
		if (!sourceId) throw new Error('A source id is required.');
		await this.#database();
		const token = `${sourceId}:pending:${createId('write')}`;
		const opfsWriter = await this.#createOpfsWriter(token);
		let chunkIndex = 0;
		let totalFrames = 0;
		let channelCount = null;
		let closed = false;
		const store = this;

		return {
			get framesWritten() { return totalFrames; },
			async write(inputChannels) {
				if (closed) throw new Error('The source writer is closed.');
				const channels = normalizeChannels(inputChannels);
				if (!channels.length) return;
				const frameLength = channels[0].length;
				if (channels.some((channel) => channel.length !== frameLength)) {
					throw new Error('All source channels must contain the same number of frames.');
				}
				if (channelCount === null) channelCount = channels.length;
				if (channels.length !== channelCount) throw new Error('Source channel count changed during a write.');
				const record = {
					key: `${token}:${String(chunkIndex).padStart(10, '0')}`,
					sourceToken: token,
					index: chunkIndex,
					frames: frameLength,
					channels: channels.map((channel) => channel.slice().buffer),
					createdAt: Date.now(),
				};
				if (opfsWriter) await opfsWriter.write(channels);
				else await store.#writeSourceChunk(record);
				chunkIndex += 1;
				totalFrames += frameLength;
			},
			async commit(extraMetadata = {}) {
				if (closed) throw new Error('The source writer is closed.');
				closed = true;
				const previous = await store.getSourceMetadata(sourceId);
				if (opfsWriter) await opfsWriter.close();
				const record = {
					...clone(metadata),
					...clone(extraMetadata),
					id: sourceId,
					storage: opfsWriter ? 'opfs' : 'indexeddb-chunks',
					sourceToken: token,
					path: opfsWriter?.path,
					channelCount: channelCount || nonNegativeInteger(metadata.channelCount, 0),
					frameLength: totalFrames,
					frameCount: totalFrames,
					chunkCount: chunkIndex,
					committedAt: new Date().toISOString(),
					pendingProjectUntil: new Date(Date.now() + PENDING_SOURCE_RETENTION_MS).toISOString(),
				};
				try {
					await store.#putSourceMetadata(record);
				} catch (error) {
					if (opfsWriter) await opfsWriter.remove();
					else await store.#deleteSourceChunks(token);
					throw error;
				}
				if (previous) await store.#deleteStoredSource(previous);
				return clone(record);
			},
			async abort() {
				if (closed) return;
				closed = true;
				if (opfsWriter) await opfsWriter.abort();
				else await store.#deleteSourceChunks(token);
			},
		};
	}

	/** Persist an AudioBuffer in bounded chunks without an intermediate copy. */
	async writeAudioBuffer(sourceId, audioBuffer, metadata = {}, { chunkFrames = 65_536 } = {}) {
		if (!audioBuffer?.numberOfChannels || !audioBuffer?.length || !audioBuffer?.getChannelData) {
			throw new TypeError('A non-empty AudioBuffer is required.');
		}
		const boundedChunkFrames = positiveInteger(chunkFrames, 65_536);
		const writer = await this.beginSourceWrite(sourceId, {
			...metadata,
			sampleRate: audioBuffer.sampleRate,
			channelCount: audioBuffer.numberOfChannels,
		});
		try {
			for (let offset = 0; offset < audioBuffer.length; offset += boundedChunkFrames) {
				const end = Math.min(audioBuffer.length, offset + boundedChunkFrames);
				const channels = Array.from(
					{ length: audioBuffer.numberOfChannels },
					(_, channel) => audioBuffer.getChannelData(channel).subarray(offset, end),
				);
				await writer.write(channels);
			}
			return await writer.commit();
		} catch (error) {
			await writer.abort();
			throw error;
		}
	}

	async getSourceMetadata(sourceId) {
		const database = await this.#database();
		if (!database) return clone(this.memory.sources.get(sourceId) || null);
		const value = await transact(database, 'sources', 'readonly', ({ sources }) => request(sources.get(sourceId)));
		return value ? clone(value) : null;
	}

	async listSources() {
		const database = await this.#database();
		const values = !database
			? [...this.memory.sources.values()]
			: await transact(database, 'sources', 'readonly', ({ sources }) => request(sources.getAll()));
		return values.map(clone);
	}

	async *readSourceChunks(sourceId) {
		const source = await this.getSourceMetadata(sourceId);
		if (!source) throw new Error('The requested audio source could not be found.');
		if (source.storage === 'opfs') {
			yield* this.#readOpfsSourceChunks(source);
			return;
		}
		const database = await this.#database();
		let records;
		if (!database) {
			records = [...this.memory.sourceChunks.values()].filter((record) => record.sourceToken === source.sourceToken);
		} else {
			records = await transact(database, 'sourceChunks', 'readonly', ({ sourceChunks }) => {
				return request(sourceChunks.index('sourceToken').getAll(source.sourceToken));
			});
		}
		records.sort((left, right) => left.index - right.index);
		for (const record of records) {
			yield {
				index: record.index,
				frames: record.frames,
				channels: record.channels.map((buffer) => new Float32Array(buffer.slice(0))),
			};
		}
	}

	/** Rehydrate a persisted source directly into its destination AudioBuffer. */
	async loadSourceAudioBuffer(sourceId, audioContext) {
		if (!audioContext?.createBuffer) throw new TypeError('An AudioContext is required to load a source.');
		const source = await this.getSourceMetadata(sourceId);
		if (!source) throw new Error('The requested audio source could not be found.');
		const frameCount = nonNegativeInteger(source.frameCount ?? source.frameLength, 0);
		const channelCount = nonNegativeInteger(source.channelCount, 0);
		if (!frameCount || !channelCount) throw new Error('The stored audio source metadata is invalid.');
		const buffer = audioContext.createBuffer(channelCount, frameCount, source.sampleRate || 48000);
		let offset = 0;
		for await (const chunk of this.readSourceChunks(sourceId)) {
			for (let channel = 0; channel < channelCount; channel += 1) {
				if (!chunk.channels[channel]) throw new Error('A stored audio source channel is missing.');
				if (typeof buffer.copyToChannel === 'function') buffer.copyToChannel(chunk.channels[channel], channel, offset);
				else buffer.getChannelData(channel).set(chunk.channels[channel], offset);
			}
			offset += chunk.frames;
		}
		if (offset !== frameCount) throw new Error('The stored audio source frame count does not match its metadata.');
		return buffer;
	}

	async deleteSource(sourceId) {
		const source = await this.getSourceMetadata(sourceId);
		if (!source) return;
		const database = await this.#database();
		if (!database) this.memory.sources.delete(sourceId);
		else await transact(database, 'sources', 'readwrite', ({ sources }) => { sources.delete(sourceId); });
		await this.#deleteStoredSource(source);
		await this.deleteAnalysis(`audio-editor-peaks-v1:${sourceId}`);
	}

	/**
	 * Delete immutable source data that no live or durable snapshot can reach.
	 * Durable roots and deletions share one IndexedDB transaction, preventing a
	 * concurrent autosave from racing the reachability check. Callers pass
	 * unsaved undo/redo snapshots and other live-only roots explicitly.
	 */
	pruneUnreferencedSources(options = {}) {
		const operation = this.sourcePrunePromise.then(() => this.#pruneUnreferencedSources(options));
		this.sourcePrunePromise = operation.catch(() => undefined);
		return operation;
	}

	/** Remove only old, uncommitted chunks/files so active tabs keep their writes. */
	async cleanupTemporaryAssets({ maximumAgeMs = 24 * 60 * 60 * 1000 } = {}) {
		const sources = await this.listSources();
		const tokens = new Set(sources.map((source) => source.sourceToken).filter(Boolean));
		const paths = new Set(sources.map((source) => source.path).filter(Boolean));
		const cutoff = Date.now() - maximumAgeMs;
		const database = await this.#database();
		if (!database) {
			for (const [key, chunk] of this.memory.sourceChunks) {
				if (!tokens.has(chunk.sourceToken) && Number(chunk.createdAt) < cutoff) this.memory.sourceChunks.delete(key);
			}
		} else {
			const chunks = await transact(database, 'sourceChunks', 'readonly', ({ sourceChunks }) => request(sourceChunks.getAll()));
			const staleKeys = chunks
				.filter((chunk) => !tokens.has(chunk.sourceToken) && Number(chunk.createdAt) < cutoff)
				.map((chunk) => chunk.key);
			if (staleKeys.length) await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => {
				for (const key of staleKeys) sourceChunks.delete(key);
			});
		}

		const directory = await this.#opfsDirectory();
		if (!directory?.entries) return;
		for await (const [name, handle] of directory.entries()) {
			if (paths.has(name) || handle.kind !== 'file') continue;
			try {
				const file = await handle.getFile();
				if (file.lastModified < cutoff) await directory.removeEntry(name);
			} catch { /* A concurrently removed file needs no cleanup. */ }
		}
	}

	async estimateStorage() {
		if (!this.storageManager?.estimate) return { usage: null, quota: null };
		try {
			const result = await this.storageManager.estimate();
			return { usage: result.usage ?? null, quota: result.quota ?? null };
		} catch {
			return { usage: null, quota: null };
		}
	}

	async requestPersistentStorage() {
		if (!this.storageManager?.persist) return false;
		try {
			return Boolean(await this.storageManager.persist());
		} catch {
			return false;
		}
	}

	async clear() {
		const opfsSources = [];
		const database = await this.#database();
		if (!database) {
			opfsSources.push(...[...this.memory.sources.values()].filter((source) => source.storage === 'opfs'));
			for (const value of Object.values(this.memory)) value.clear();
		} else {
			opfsSources.push(...await transact(database, 'sources', 'readonly', ({ sources }) => request(sources.getAll())));
			await transact(database, ['projects', 'revisions', 'settings', 'analysis', 'sources', 'sourceChunks'], 'readwrite', (stores) => {
				for (const store of Object.values(stores)) store.clear();
			});
		}
		for (const source of opfsSources) if (source.storage === 'opfs') await this.#deleteStoredSource(source);
	}

	async close() {
		if (!this.databasePromise) return;
		const database = await this.databasePromise.catch(() => null);
		database?.close();
		this.databasePromise = null;
	}

	async #putKeyValue(storeName, key, value) {
		const database = await this.#database();
		const record = { key, value: clone(value) };
		if (!database) this.memory[storeName].set(key, record);
		else await transact(database, storeName, 'readwrite', (stores) => { stores[storeName].put(record); });
		return clone(value);
	}

	async #pruneUnreferencedSources({
		protectedProjects = [],
		protectedSourceIds = [],
		minimumAgeMs = 60_000,
		now = Date.now(),
	} = {}) {
		const protectedIds = new Set(protectedSourceIds || []);
		for (const project of protectedProjects || []) collectProjectSourceIds(project, protectedIds);
		const maximumAge = Math.max(0, Number(minimumAgeMs) || 0);
		const currentTime = Number.isFinite(Number(now)) ? Number(now) : Date.now();
		const deletedSources = [];
		const deferredSourceIds = [];
		let nextEligibleAt = null;
		const database = await this.#database();

		if (!database) {
			for (const [id, project] of this.memory.projects) {
				const compacted = compactProjectSourceMetadata(project);
				if (compacted !== project) this.memory.projects.set(id, compacted);
				collectProjectSourceIds(compacted, protectedIds);
			}
			for (const [key, record] of this.memory.revisions) {
				const compacted = compactProjectSourceMetadata(record.project);
				if (compacted !== record.project) this.memory.revisions.set(key, { ...record, project: compacted });
				collectProjectSourceIds(compacted, protectedIds);
			}
			for (const [sourceId, source] of this.memory.sources) {
				if (protectedIds.has(sourceId)) continue;
				const eligibleAt = sourceEligibleAt(source, maximumAge);
				if (eligibleAt > currentTime) {
					deferredSourceIds.push(sourceId);
					nextEligibleAt = nextEligibleAt === null ? eligibleAt : Math.min(nextEligibleAt, eligibleAt);
					continue;
				}
				deletedSources.push(source);
				this.memory.sources.delete(sourceId);
				this.memory.analysis.delete(`audio-editor-peaks-v1:${sourceId}`);
				for (const [key, chunk] of this.memory.sourceChunks) {
					if (chunk.sourceToken === source.sourceToken) this.memory.sourceChunks.delete(key);
				}
			}
		} else {
			const result = await transact(
				database,
				['projects', 'revisions', 'analysis', 'sources', 'sourceChunks'],
				'readwrite',
				async ({ projects, revisions, analysis, sources, sourceChunks }) => {
					const savedProjects = await request(projects.getAll());
					const savedRevisions = await request(revisions.getAll());
					for (const saved of savedProjects) {
						const compacted = compactProjectSourceMetadata(saved);
						if (compacted !== saved) projects.put(compacted);
						collectProjectSourceIds(compacted, protectedIds);
					}
					for (const record of savedRevisions) {
						const compacted = compactProjectSourceMetadata(record.project);
						if (compacted !== record.project) revisions.put({ ...record, project: compacted });
						collectProjectSourceIds(compacted, protectedIds);
					}

					const storedSources = await request(sources.getAll());
					const removed = [];
					for (const source of storedSources) {
						if (protectedIds.has(source.id)) continue;
						const eligibleAt = sourceEligibleAt(source, maximumAge);
						if (eligibleAt > currentTime) {
							deferredSourceIds.push(source.id);
							nextEligibleAt = nextEligibleAt === null ? eligibleAt : Math.min(nextEligibleAt, eligibleAt);
							continue;
						}
						removed.push(source);
						sources.delete(source.id);
						analysis.delete(`audio-editor-peaks-v1:${source.id}`);
						if (source.sourceToken) await deleteByIndex(sourceChunks.index('sourceToken'), source.sourceToken);
					}
					return removed;
				},
			);
			deletedSources.push(...result);
		}

		for (const source of deletedSources) {
			if (source.storage === 'opfs') await this.#deleteStoredSource(source);
		}
		return {
			deletedSourceIds: deletedSources.map((source) => source.id),
			deferredSourceIds,
			retainedSourceIds: [...protectedIds],
			nextEligibleAt,
		};
	}

	async #pruneProjectRevisions(projectId) {
		const database = await this.#database();
		if (!database) {
			const records = [...this.memory.revisions.values()]
				.filter((record) => record.projectId === projectId)
				.sort((left, right) => right.revision - left.revision);
			for (const record of records.slice(this.revisionLimit)) this.memory.revisions.delete(record.key);
			return;
		}
		const records = await transact(database, 'revisions', 'readonly', ({ revisions }) => request(revisions.index('projectId').getAll(projectId)));
		records.sort((left, right) => right.revision - left.revision);
		if (records.length <= this.revisionLimit) return;
		await transact(database, 'revisions', 'readwrite', ({ revisions }) => {
			for (const record of records.slice(this.revisionLimit)) revisions.delete(record.key);
		});
	}

	async #getKeyValue(storeName, key) {
		const database = await this.#database();
		const record = !database
			? this.memory[storeName].get(key)
			: await transact(database, storeName, 'readonly', (stores) => request(stores[storeName].get(key)));
		return record ? clone(record.value) : undefined;
	}

	async #writeSourceChunk(record) {
		const database = await this.#database();
		if (!database) this.memory.sourceChunks.set(record.key, cloneChunk(record));
		else await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => { sourceChunks.put(record); });
	}

	async #putSourceMetadata(record) {
		const database = await this.#database();
		if (!database) this.memory.sources.set(record.id, clone(record));
		else await transact(database, 'sources', 'readwrite', ({ sources }) => { sources.put(record); });
	}

	async #deleteSourceChunks(token) {
		if (!token) return;
		const database = await this.#database();
		if (!database) {
			for (const [key, record] of this.memory.sourceChunks) {
				if (record.sourceToken === token) this.memory.sourceChunks.delete(key);
			}
			return;
		}
		await transact(database, 'sourceChunks', 'readwrite', ({ sourceChunks }) => deleteByIndex(sourceChunks.index('sourceToken'), token));
	}

	async #deleteStoredSource(source) {
		if (source?.storage === 'opfs' && source.path) {
			const directory = await this.#opfsDirectory();
			try { await directory?.removeEntry(source.path); } catch { /* Missing and orphaned files are harmless. */ }
			return;
		}
		if (source?.sourceToken) await this.#deleteSourceChunks(source.sourceToken);
	}

	async #createOpfsWriter(token) {
		const directory = await this.#opfsDirectory();
		if (!directory?.getFileHandle) return null;
		const path = `${token.replace(/[^a-z0-9._-]+/gi, '-')}.pcm`;
		try {
			const handle = await directory.getFileHandle(path, { create: true });
			const writable = await handle.createWritable();
			let closed = false;
			return {
				path,
				async write(channels) {
					if (closed) throw new Error('The OPFS source writer is closed.');
					const header = new Uint8Array(8);
					const view = new DataView(header.buffer);
					view.setUint32(0, channels[0]?.length || 0, true);
					view.setUint16(4, channels.length, true);
					await writable.write(new Blob([header, ...channels]));
				},
				async close() {
					if (closed) return;
					closed = true;
					await writable.close();
				},
				async remove() {
					try { await directory.removeEntry(path); } catch { /* Already absent. */ }
				},
				async abort() {
					if (!closed) {
						closed = true;
						if (typeof writable.abort === 'function') await writable.abort();
						else await writable.close();
					}
					try { await directory.removeEntry(path); } catch { /* Already absent. */ }
				},
			};
		} catch {
			try { await directory.removeEntry(path); } catch { /* Creation may not have reached disk. */ }
			return null;
		}
	}

	async *#readOpfsSourceChunks(source) {
		const directory = await this.#opfsDirectory();
		if (!directory) throw new Error('Origin-private audio storage is unavailable.');
		let file;
		try {
			const handle = await directory.getFileHandle(source.path);
			file = await handle.getFile();
		} catch {
			throw new Error('The requested local audio source is missing.');
		}
		let offset = 0;
		let index = 0;
		while (offset < file.size) {
			if (file.size - offset < 8) throw new Error('The local audio source is truncated.');
			const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
			const frames = header.getUint32(0, true);
			const channelCount = header.getUint16(4, true);
			offset += 8;
			const channelBytes = frames * Float32Array.BYTES_PER_ELEMENT;
			if (!frames || !channelCount || offset + channelBytes * channelCount > file.size) {
				throw new Error('The local audio source contains an invalid chunk.');
			}
			const channels = [];
			for (let channel = 0; channel < channelCount; channel += 1) {
				channels.push(new Float32Array(await file.slice(offset, offset + channelBytes).arrayBuffer()));
				offset += channelBytes;
			}
			yield { index, frames, channels };
			index += 1;
		}
	}

	async #opfsDirectory() {
		if (!this.preferOpfs) return null;
		if (!this.opfsDirectoryPromise) {
			this.opfsDirectoryPromise = (async () => {
				try {
					const root = this.opfsRoot || await this.storageManager?.getDirectory?.();
					if (!root?.getDirectoryHandle) return null;
					return root.getDirectoryHandle('audio-editor-sources', { create: true });
				} catch {
					return null;
				}
			})();
		}
		return this.opfsDirectoryPromise;
	}

	async #database() {
		if (this.backend === 'memory') return null;
		if (!this.databasePromise) {
			this.databasePromise = openDatabase(this.indexedDB, this.databaseName).catch((error) => {
				this.databasePromise = null;
				if (!this.memoryFallback) throw error;
				this.backend = 'memory';
				return null;
			});
		}
		return this.databasePromise;
	}
}

function openDatabase(indexedDB, databaseName) {
	return new Promise((resolve, reject) => {
		let openRequest;
		try {
			openRequest = indexedDB.open(databaseName, DATABASE_VERSION);
		} catch (error) {
			reject(error);
			return;
		}
		openRequest.onupgradeneeded = () => {
			const database = openRequest.result;
			if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' });
			if (!database.objectStoreNames.contains('revisions')) {
				const store = database.createObjectStore('revisions', { keyPath: 'key' });
				store.createIndex('projectId', 'projectId', { unique: false });
			}
			if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('analysis')) database.createObjectStore('analysis', { keyPath: 'key' });
			if (!database.objectStoreNames.contains('sources')) database.createObjectStore('sources', { keyPath: 'id' });
			if (!database.objectStoreNames.contains('sourceChunks')) {
				const store = database.createObjectStore('sourceChunks', { keyPath: 'key' });
				store.createIndex('sourceToken', 'sourceToken', { unique: false });
			}
		};
		openRequest.onsuccess = () => resolve(openRequest.result);
		openRequest.onerror = () => reject(openRequest.error || new Error('Could not open editor storage.'));
		openRequest.onblocked = () => reject(new Error('Editor storage is blocked by another tab.'));
	});
}

async function transact(database, storeNames, mode, operation) {
	const names = Array.isArray(storeNames) ? storeNames : [storeNames];
	const transaction = database.transaction(names, mode);
	const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
	const completion = transactionCompletion(transaction);
	let result;
	try {
		result = await operation(stores, transaction);
	} catch (error) {
		try { transaction.abort(); } catch { /* Transaction may already be inactive. */ }
		throw error;
	}
	await completion;
	return result;
}

function request(idbRequest) {
	return new Promise((resolve, reject) => {
		idbRequest.onsuccess = () => resolve(idbRequest.result);
		idbRequest.onerror = () => reject(idbRequest.error || new Error('An IndexedDB request failed.'));
	});
}

function transactionCompletion(transaction) {
	return new Promise((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () => reject(transaction.error || new Error('The IndexedDB transaction was aborted.'));
		transaction.onerror = () => reject(transaction.error || new Error('The IndexedDB transaction failed.'));
	});
}

function deleteByIndex(index, key) {
	return new Promise((resolve, reject) => {
		// IDBKeyCursor cannot mutate records; a value cursor can delete them.
		const cursorRequest = index.openCursor(key);
		cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Could not enumerate IndexedDB records.'));
		cursorRequest.onsuccess = () => {
			const cursor = cursorRequest.result;
			if (!cursor) {
				resolve();
				return;
			}
			cursor.delete();
			cursor.continue();
		};
	});
}

function getMemoryDatabase(name) {
	if (!memoryDatabases.has(name)) {
		memoryDatabases.set(name, {
			projects: new Map(),
			revisions: new Map(),
			settings: new Map(),
			analysis: new Map(),
			sources: new Map(),
			sourceChunks: new Map(),
		});
	}
	return memoryDatabases.get(name);
}

function normalizeChannels(input) {
	if (!input || typeof input.length !== 'number') return [];
	return Array.from(input, (channel) => channel instanceof Float32Array ? channel : Float32Array.from(channel || []));
}

function sourceEligibleAt(source, minimumAgeMs) {
	const committedAt = Date.parse(source?.committedAt || '');
	const pendingProjectUntil = Date.parse(source?.pendingProjectUntil || '');
	return Math.max(
		Number.isFinite(committedAt) ? committedAt + minimumAgeMs : 0,
		Number.isFinite(pendingProjectUntil) ? pendingProjectUntil : 0,
	);
}

function publishSource(source) {
	const { pendingProjectUntil: _pendingProjectUntil, ...published } = source;
	return published;
}

function cloneChunk(record) {
	return {
		...record,
		channels: record.channels.map((buffer) => buffer.slice(0)),
	};
}

function clone(value) {
	if (value === undefined || value === null) return value;
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value));
}

function revisionKey(projectId, revision) {
	return `${projectId}:${String(nonNegativeInteger(revision, 0)).padStart(12, '0')}`;
}

function createId(prefix) {
	if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function nonNegativeInteger(value, fallback) {
	return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

function positiveInteger(value, fallback) {
	return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sortProjects(left, right) {
	return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}
