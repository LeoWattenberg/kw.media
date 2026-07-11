import type { Locale } from '../i18n';

export type ToolCategoryId = 'converter' | 'audio' | 'video' | 'image' | 'text' | 'analyzers';

export interface ToolCategory {
	id: ToolCategoryId;
	slug: string;
	toolIds: string[];
	translations: Record<Locale, {
		title: string;
		description: string;
		eyebrow: string;
		open: string;
	}>;
}

export const toolCategories: ToolCategory[] = [
	{
		id: 'converter',
		slug: 'converter',
		toolIds: ['document-converter', 'image-format-converter', 'raster-svg-workbench', 'video-audio-converter', 'video-to-gif'],
		translations: {
			de: {
				eyebrow: 'Konverter',
				title: 'Konverter',
				description: 'Dateien direkt im Browser in andere Formate bringen.',
				open: 'Konverter oeffnen',
			},
			en: {
				eyebrow: 'Converters',
				title: 'Converters',
				description: 'Move files into other formats right in the browser.',
				open: 'Open converter',
			},
		},
	},
	{
		id: 'audio',
		slug: 'audio',
		toolIds: [
			'abx-tester',
			'mp3-quality-tester',
			'loudness-mastering',
			'podcast-cleaner',
			'podcast-chapterizer',
			'video-audio-converter',
			'lossless-media-surgeon',
			'media-info',
			'metadata-privacy-scrubber',
		],
		translations: {
			de: {
				eyebrow: 'Audio',
				title: 'Audio-Tools',
				description: 'Hoeren, testen, mastern, bereinigen und Audio aus lokalen Medien verarbeiten.',
				open: 'Audio-Tool oeffnen',
			},
			en: {
				eyebrow: 'Audio',
				title: 'Audio Tools',
				description: 'Listen, test, master, clean, and process audio from local media.',
				open: 'Open audio tool',
			},
		},
	},
	{
		id: 'video',
		slug: 'video',
		toolIds: [
			'video-audio-converter',
			'video-to-gif',
			'crop-doctor',
			'delivery-doctor',
			'lossless-media-surgeon',
			'smart-vertical-reframer',
			'watermarker',
			'offline-subtitle-studio',
			'podcast-chapterizer',
			'media-info',
			'metadata-privacy-scrubber',
		],
		translations: {
			de: {
				eyebrow: 'Video',
				title: 'Video-Tools',
				description: 'Clips pruefen, schneiden, reframen, konvertieren und ausliefern.',
				open: 'Video-Tool oeffnen',
			},
			en: {
				eyebrow: 'Video',
				title: 'Video Tools',
				description: 'Inspect, trim, reframe, convert, and deliver local clips.',
				open: 'Open video tool',
			},
		},
	},
	{
		id: 'image',
		slug: 'image',
		toolIds: [
			'image-format-converter',
			'background-remover',
			'background-remover-checkerboard',
			'click-to-cut-object-extractor',
			'face-object-redactor',
			'raster-svg-workbench',
			'watermarker',
			'youtube-thumbnail-preview',
			'metadata-privacy-scrubber',
		],
		translations: {
			de: {
				eyebrow: 'Bild',
				title: 'Bild-Tools',
				description: 'Bilder vorbereiten, freistellen, pruefen, markieren und umwandeln.',
				open: 'Bild-Tool oeffnen',
			},
			en: {
				eyebrow: 'Image',
				title: 'Image Tools',
				description: 'Prepare, isolate, inspect, mark, and convert image assets.',
				open: 'Open image tool',
			},
		},
	},
	{
		id: 'text',
		slug: 'text',
		toolIds: ['document-converter', 'offline-subtitle-studio', 'podcast-chapterizer', 'metadata-privacy-scrubber'],
		translations: {
			de: {
				eyebrow: 'Text',
				title: 'Text-Tools',
				description: 'Dokumente, Untertitel, Kapitel und Metadaten lokal bearbeiten.',
				open: 'Text-Tool oeffnen',
			},
			en: {
				eyebrow: 'Text',
				title: 'Text Tools',
				description: 'Work locally with documents, subtitles, chapters, and metadata.',
				open: 'Open text tool',
			},
		},
	},
	{
		id: 'analyzers',
		slug: 'analyzers',
		toolIds: [
			'media-info',
			'delivery-doctor',
			'crop-doctor',
			'abx-tester',
			'mp3-quality-tester',
			'youtube-thumbnail-preview',
			'vtuber-preview',
		],
		translations: {
			de: {
				eyebrow: 'Analyzer',
				title: 'Analyzer',
				description: 'Medien, Qualitaet, Crops, Thumbnails und Produktionsrisiken einschaetzen.',
				open: 'Analyzer oeffnen',
			},
			en: {
				eyebrow: 'Analyzers',
				title: 'Analyzers',
				description: 'Judge media, quality, crops, thumbnails, and production risks.',
				open: 'Open analyzer',
			},
		},
	},
];

export function getToolCategory(categoryId: ToolCategoryId): ToolCategory {
	const category = toolCategories.find((candidate) => candidate.id === categoryId);

	if (!category) {
		throw new Error(`Unknown tool category: ${categoryId}`);
	}

	return category;
}

export function getToolCategoryPath(category: ToolCategory, locale: Locale): string {
	return `/${locale}/tools/${category.slug}/`;
}
