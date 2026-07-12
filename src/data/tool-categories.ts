import type { Locale } from '../i18n';
import { virtualConverterToolIds } from './virtual-converters';

export type ToolCategoryId = 'converter' | 'audio' | 'video' | 'image' | 'text' | 'analyzers';

export interface ToolCategory {
	id: ToolCategoryId;
	slug: string;
	toolIds: string[];
	translations: Record<Locale, {
		title: string;
		description: string;
		eyebrow: string;
	}>;
}

export const toolCategories: ToolCategory[] = [
	{
		id: 'converter',
		slug: 'converter',
		toolIds: [
			'document-converter',
			'image-format-converter',
			'raster-svg-workbench',
			'video-audio-converter',
			'video-to-gif',
			...virtualConverterToolIds,
		],
		translations: {
			de: {
				eyebrow: 'Konverter',
				title: 'Konverter-Tools',
				description: 'Dateien direkt im Browser in andere Formate bringen.',
			},
			en: {
				eyebrow: 'Converters',
				title: 'Converter Tools',
				description: 'Move files into other formats right in the browser.',
			},
		},
	},
	{
		id: 'audio',
		slug: 'audio',
		toolIds: [
			'audio-editor',
			'audio-analyzer',
			'subtitle-studio',
			'abx-tester',
			'whisper-subtitle-generator',
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
				description: 'Hören, testen, mastern, bereinigen und Audio aus lokalen Medien verarbeiten.',
			},
			en: {
				eyebrow: 'Audio',
				title: 'Audio Tools',
				description: 'Listen, test, master, clean, and process audio from local media.',
			},
		},
	},
	{
		id: 'video',
		slug: 'video',
		toolIds: [
			'subtitle-studio',
			'video-audio-converter',
			'whisper-subtitle-generator',
			'video-to-gif',
			'crop-doctor',
			'delivery-doctor',
			'lossless-media-surgeon',
			'smart-vertical-reframer',
			'watermarker',
			'offline-subtitle-studio',
			'subtitle-burner',
			'podcast-chapterizer',
			'media-info',
			'metadata-privacy-scrubber',
			'short-form-safe-zone-previewer',
		],
		translations: {
			de: {
				eyebrow: 'Video',
				title: 'Video-Tools',
				description: 'Clips prüfen, schneiden, reframen, konvertieren und ausliefern.',
			},
			en: {
				eyebrow: 'Video',
				title: 'Video Tools',
				description: 'Inspect, trim, reframe, convert, and deliver local clips.',
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
				description: 'Bilder vorbereiten, freistellen, prüfen, markieren und umwandeln.',
			},
			en: {
				eyebrow: 'Image',
				title: 'Image Tools',
				description: 'Prepare, isolate, inspect, mark, and convert image assets.',
			},
		},
	},
	{
		id: 'text',
		slug: 'text',
		toolIds: ['subtitle-studio', 'document-converter', 'whisper-subtitle-generator', 'offline-subtitle-studio', 'subtitle-burner', 'podcast-chapterizer', 'metadata-privacy-scrubber'],
		translations: {
			de: {
				eyebrow: 'Text',
				title: 'Text-Tools',
				description: 'Dokumente, Untertitel, Kapitel und Metadaten lokal bearbeiten.',
			},
			en: {
				eyebrow: 'Text',
				title: 'Text Tools',
				description: 'Work locally with documents, subtitles, chapters, and metadata.',
			},
		},
	},
	{
		id: 'analyzers',
		slug: 'analyzers',
		toolIds: [
			'audio-analyzer',
			'media-info',
			'delivery-doctor',
			'crop-doctor',
			'abx-tester',
			'mp3-quality-tester',
			'youtube-thumbnail-preview',
			'vtuber-preview',
			'short-form-safe-zone-previewer',
		],
		translations: {
			de: {
				eyebrow: 'Analyzer',
				title: 'Analyzer',
				description: 'Medien, Qualitaet, Crops, Thumbnails und Produktionsrisiken einschaetzen.',
			},
			en: {
				eyebrow: 'Analyzers',
				title: 'Analyzers',
				description: 'Judge media, quality, crops, thumbnails, and production risks.',
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
