import english from './audacity-download-locales/en.json';
import { DOWNLOAD_LANGUAGES, downloadPagePath } from '../lib/audacity-download-localization.js';

export interface DownloadCatalog {
	nativeName: string;
	direction: 'ltr' | 'rtl';
	description: string;
	copy: typeof english.copy;
	comparison: Record<string, string>;
}

const modules = import.meta.glob<DownloadCatalog>('./audacity-download-locales/*.json', { eager: true, import: 'default' });
export const downloadCatalogs = Object.fromEntries(Object.entries(modules).map(([path, catalog]) => [path.split('/').pop()!.replace('.json', ''), catalog]));

export const downloadLanguages = DOWNLOAD_LANGUAGES.map(language => {
	const catalog = downloadCatalogs[language];
	if (!catalog) throw new Error(`Missing download translation: ${language}`);
	return { language, label: catalog.nativeName, direction: catalog.direction, path: downloadPagePath(language) };
});
