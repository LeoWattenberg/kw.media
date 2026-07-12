import type { Locale } from '../i18n';
import type { ToolPage, ToolPageModule } from '../lib/tool-page-module';
import generatedToolMetadata from './generated-tool-metadata.json';

export type { ToolPage, ToolPageModule } from '../lib/tool-page-module';

interface ToolPageAstroModule {
	default: unknown;
	toolModule: ToolPageModule;
}

const toolAstroModules = import.meta.glob<ToolPageAstroModule>('./tools/**/*.astro', {
	eager: true,
});

const toolModules = Object.values(toolAstroModules);
const generatedMetadata = generatedToolMetadata as Record<string, { description?: string; content?: string[] }>;

export const toolPages: ToolPage[] = toolModules.flatMap((module) => module.toolModule.pages).map((page) => {
	const generated = generatedMetadata[page.path];
	return generated ? { ...page, ...generated } : page;
});

export function findToolPage(pathname: string): ToolPage | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return toolPages.find((page) => page.path === normalizedPath);
}

export function getToolPageComponent(page: ToolPage): unknown {
	const module = toolModules.find((candidate) => candidate.toolModule.pages.some((candidatePage) => candidatePage.id === page.id));

	if (!module) {
		throw new Error(`Missing tool component for ${page.id}`);
	}

	return module.default;
}

export function toolGroup(id: string) {
	return id.replace(/-(de|en)$/, '');
}

const toolEyebrows: Record<string, Record<Locale, string>> = {
	'abx-tester': { de: 'Blind hören & vergleichen', en: 'Blind listening comparison' },
	'audio-analyzer': { de: 'Pegel, Lautheit & Spektrum', en: 'Levels, loudness & spectrum' },
	'background-remover': { de: 'Einfarbige Flächen freistellen', en: 'Remove solid-color backgrounds' },
	'background-remover-checkerboard': { de: 'Gefälschte Transparenz bereinigen', en: 'Clean up fake transparency' },
	'click-to-cut-object-extractor': { de: 'Objekte per Klick auswählen', en: 'Select objects with a click' },
	'crop-doctor': { de: 'Schwarze Balken erkennen', en: 'Detect black bars' },
	'delivery-doctor': { de: 'Uploads & Playback prüfen', en: 'Check uploads & playback' },
	'document-converter': { de: 'Dokumentformate wechseln', en: 'Change document formats' },
	'face-object-redactor': { de: 'Sensible Bildbereiche schützen', en: 'Protect sensitive image areas' },
	'image-format-converter': { de: 'Bildformate wechseln', en: 'Change image formats' },
	'lossless-media-surgeon': { de: 'Ohne Neukodierung bearbeiten', en: 'Edit without re-encoding' },
	'loudness-mastering': { de: 'Lautheit für Plattformen', en: 'Platform-ready loudness' },
	'media-info': { de: 'Codecs & technische Daten', en: 'Codecs & technical details' },
	'metadata-privacy-scrubber': { de: 'Versteckte Daten bereinigen', en: 'Clean hidden data' },
	'mp3-quality-tester': { de: 'Kompression blind vergleichen', en: 'Compare compression blindly' },
	'offline-subtitle-studio': { de: 'SRT & WebVTT bearbeiten', en: 'Edit SRT & WebVTT' },
	'podcast-chapterizer': { de: 'Kapitel erstellen & einbetten', en: 'Create & embed chapters' },
	'podcast-cleaner': { de: 'Sprachaufnahmen aufbereiten', en: 'Clean up spoken audio' },
	'raster-svg-workbench': { de: 'Vektorisieren & rendern', en: 'Vectorize & render' },
	'short-form-safe-zone-previewer': { de: 'Overlays sicher platzieren', en: 'Place overlays safely' },
	'smart-vertical-reframer': { de: 'Face-aware Hochkant-Crops', en: 'Face-aware vertical crops' },
	'subtitle-burner': { de: 'Untertitel fest einbrennen', en: 'Burn in captions' },
	'subtitle-studio': { de: 'Erstellen, bearbeiten & anwenden', en: 'Create, edit & apply captions' },
	'video-audio-converter': { de: 'Audio- & Videoformate wechseln', en: 'Change audio & video formats' },
	'video-to-gif': { de: 'Clips als Animation exportieren', en: 'Export clips as animations' },
	'vtuber-preview': { de: 'Webcam-Tracking ausprobieren', en: 'Try webcam tracking' },
	'watermarker': { de: 'Text- & Bild-Overlays', en: 'Text & image overlays' },
	'whisper-subtitle-generator': { de: 'Sprache lokal transkribieren', en: 'Transcribe speech locally' },
	'youtube-thumbnail-preview': { de: 'Titel & Thumbnail testen', en: 'Test titles & thumbnails' },
};

export function getToolEyebrow(page: ToolPage): string {
	const group = toolGroup(page.id);
	const exact = toolEyebrows[group]?.[page.locale];
	if (exact) return exact;
	if (group.startsWith('image-to-')) return page.locale === 'de' ? 'Bildformat wechseln' : 'Change image format';
	if (group.startsWith('document-to-')) return page.locale === 'de' ? 'Dokumentformat wechseln' : 'Change document format';
	if (group.startsWith('media-to-')) return page.locale === 'de' ? 'Medienformat wechseln' : 'Change media format';
	if (group === 'svg-to-png') return page.locale === 'de' ? 'Vektorgrafik rendern' : 'Render vector graphics';
	if (group === 'png-to-svg') return page.locale === 'de' ? 'Rasterbild vektorisieren' : 'Vectorize raster images';
	return page.locale === 'de' ? 'Direkt im Browser' : 'Runs in your browser';
}

export function getToolPageAlternatePaths(page: ToolPage): Partial<Record<Locale, string>> {
	const group = toolGroup(page.id);
	const alternates = toolPages.filter((candidate) => toolGroup(candidate.id) === group);

	return Object.fromEntries(alternates.map((alternate) => [alternate.locale, alternate.path])) as Partial<Record<Locale, string>>;
}
