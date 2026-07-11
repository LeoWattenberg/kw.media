import type { Locale } from '../i18n';
import type { ToolPage } from '../lib/tool-page-module';

export type VirtualConverterRenderer = 'document' | 'image-format' | 'raster-svg' | 'video-audio';

export interface VirtualConverterDefinition {
	id: string;
	renderer: VirtualConverterRenderer;
	defaultValue: string;
	translations: Record<Locale, {
		path: string;
		title: string;
		description: string;
	}>;
}

export const virtualConverterDefinitions: VirtualConverterDefinition[] = [
	{
		id: 'svg-to-png',
		renderer: 'raster-svg',
		defaultValue: 'png',
		translations: {
			de: {
				path: '/de/tools/converters/svg-to-png/',
				title: 'SVG zu PNG',
				description: 'Rendere SVG-Markup oder SVG-Dateien lokal im Browser als PNG.',
			},
			en: {
				path: '/en/tools/converters/svg-to-png/',
				title: 'SVG to PNG',
				description: 'Render SVG markup or SVG files locally in the browser as PNG.',
			},
		},
	},
	{
		id: 'png-to-svg',
		renderer: 'raster-svg',
		defaultValue: 'vector',
		translations: {
			de: {
				path: '/de/tools/converters/png-to-svg/',
				title: 'PNG zu SVG',
				description: 'Vektorisiere PNG- und andere Rasterbilder lokal im Browser zu SVG.',
			},
			en: {
				path: '/en/tools/converters/png-to-svg/',
				title: 'PNG to SVG',
				description: 'Vectorize PNG and other raster images locally in the browser to SVG.',
			},
		},
	},
	...[
		['image-to-png', 'PNG', 'PNG'],
		['image-to-jpeg', 'JPEG', 'JPEG'],
		['image-to-webp', 'WEBP', 'WebP'],
		['image-to-avif', 'AVIF', 'AVIF'],
		['image-to-gif', 'GIF', 'GIF'],
		['image-to-tiff', 'TIFF', 'TIFF'],
		['image-to-bmp', 'BMP', 'BMP'],
		['image-to-ico', 'ICO', 'ICO'],
	].map(([id, defaultValue, label]) => ({
		id,
		renderer: 'image-format' as const,
		defaultValue,
		translations: {
			de: {
				path: `/de/tools/converters/${id}/`,
				title: `Bild zu ${label}`,
				description: `Konvertiere lokale Bilder clientseitig in das ${label}-Format.`,
			},
			en: {
				path: `/en/tools/converters/${id}/`,
				title: `Image to ${label}`,
				description: `Convert local images client-side into the ${label} format.`,
			},
		},
	})),
	...[
		['document-to-html', 'html', 'HTML', 'HTML'],
		['document-to-markdown', 'markdown', 'Markdown', 'Markdown'],
		['document-to-txt', 'plain', 'plain text', 'Klartext'],
		['document-to-pdf', 'pdf', 'PDF', 'PDF'],
		['document-to-docx', 'docx', 'DOCX', 'DOCX'],
		['document-to-odt', 'odt', 'ODT', 'ODT'],
		['document-to-epub', 'epub', 'EPUB', 'EPUB'],
		['document-to-latex', 'latex', 'LaTeX', 'LaTeX'],
		['document-to-rtf', 'rtf', 'RTF', 'RTF'],
	].map(([id, defaultValue, labelEn, labelDe]) => ({
		id,
		renderer: 'document' as const,
		defaultValue,
		translations: {
			de: {
				path: `/de/tools/converters/${id}/`,
				title: `Dokument zu ${labelDe}`,
				description: `Konvertiere Dokumente lokal im Browser in ${labelDe}.`,
			},
			en: {
				path: `/en/tools/converters/${id}/`,
				title: `Document to ${labelEn}`,
				description: `Convert documents locally in the browser to ${labelEn}.`,
			},
		},
	})),
	...[
		['media-to-wav', 'wav', 'WAV'],
		['media-to-mp3', 'mp3', 'MP3'],
		['media-to-ogg', 'ogg', 'OGG'],
		['media-to-m4a', 'm4a', 'M4A'],
		['media-to-flac', 'flac', 'FLAC'],
		['media-to-mp4', 'mp4', 'MP4'],
		['media-to-webm', 'webm', 'WebM'],
		['media-to-mov', 'mov', 'MOV'],
	].map(([id, defaultValue, label]) => ({
		id,
		renderer: 'video-audio' as const,
		defaultValue,
		translations: {
			de: {
				path: `/de/tools/converters/${id}/`,
				title: `Medien zu ${label}`,
				description: `Konvertiere lokale Audio- oder Videodateien browserseitig in ${label}.`,
			},
			en: {
				path: `/en/tools/converters/${id}/`,
				title: `Media to ${label}`,
				description: `Convert local audio or video files in the browser to ${label}.`,
			},
		},
	})),
];

export const virtualConverterToolIds = virtualConverterDefinitions.map((definition) => definition.id);

export const virtualConverterPages: ToolPage[] = virtualConverterDefinitions.flatMap((definition) =>
	Object.entries(definition.translations).map(([locale, translation]) => ({
		id: `${definition.id}-${locale}`,
		locale: locale as Locale,
		path: translation.path,
		title: translation.title,
		description: translation.description,
	})),
);

export function getVirtualConverterDefinition(id: string): VirtualConverterDefinition | undefined {
	return virtualConverterDefinitions.find((definition) => definition.id === id);
}
