import initSqlJs from 'sql.js';
import { createAup3Fixture, createAup3ProjectData, serializeAup3Xml } from './aup3-fixture.js';

let sqlPromise;

// Audacity 4 currently keeps the AUP3 tables and binary XML. Its SQLite
// user_version is the format marker that distinguishes an AUP4 project.
export async function createAup4Fixture(options = {}) {
	const SQL = options.SQL || await (sqlPromise ||= initSqlJs());
	const settings = { projectName: 'fixture.aup4', ...options, SQL };
	const database = new SQL.Database(await createAup3Fixture(settings));
	try {
		const { project } = createAup3ProjectData(settings);
		project.attributes.version = options.projectVersion ?? '2.0.0';
		project.attributes.audacityversion = '4.0.1';
		for (const [trackIndex, track] of (options.tracks || []).entries()) {
			for (const [clipIndex, clip] of (track.clips || []).entries()) {
				const attributes = project.children[trackIndex].children[clipIndex].attributes;
				if (clip.clipTempo != null) attributes.clipTempo = clip.clipTempo;
				if (clip.clipStretchToMatchTempo != null) attributes.clipStretchToMatchTempo = clip.clipStretchToMatchTempo;
			}
		}
		if (options.thumbnailData != null) {
			project.children.push({ name: 'thumbnail', attributes: {}, children: [],
				attributeRecords: [{ name: 'data', type: 16, value: Uint8Array.from(options.thumbnailData) }],
			});
		}
		const { dictionary, document } = serializeAup3Xml(project);
		database.run('UPDATE project SET dict = ?, doc = ?', [dictionary, document]);
		if (options.autosave) database.run('UPDATE autosave SET dict = ?, doc = ?', [dictionary, document]);
		database.run(`PRAGMA user_version = ${options.userVersion ?? 0x04000001}`);
		return database.export();
	} finally {
		database.close();
	}
}
