export function parseStatusPaths(output) {
	const records = output.split('\0').filter(Boolean);
	const paths = new Set();

	for (let index = 0; index < records.length; index += 1) {
		const record = records[index];
		paths.add(record.slice(3));

		if (/[RC]/.test(record.slice(0, 2)) && records[index + 1] !== undefined) {
			// Renames and copies print their source path as the following record.
			index += 1;
			paths.add(records[index]);
		}
	}

	return paths;
}
