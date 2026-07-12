interface GeneratedToolMetadata {
	description?: string;
	content?: string[];
}

const metadataModules = import.meta.glob<Record<string, GeneratedToolMetadata>>(
	'./generated-tool-metadata/**/*.json',
	{ eager: true, import: 'default' },
);

export const generatedToolMetadata = Object.assign({}, ...Object.values(metadataModules)) as Record<string, GeneratedToolMetadata>;
