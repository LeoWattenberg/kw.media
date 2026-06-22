import type { Locale } from '../i18n';
import type { PageBlock, SitePage } from './page-types';

export interface SitePageTranslation {
	id?: string;
	path: string;
	title: string;
	description: string;
	blocks: PageBlock[];
}

export interface SitePageTranslations {
	id: string;
	translations: Partial<Record<Locale, SitePageTranslation>>;
}

export interface SitePageModule {
	id: string;
	pages: SitePage[];
}

export function definePageModule(id: string, source: SitePageTranslations): SitePageModule {
	return {
		id,
		pages: Object.entries(source.translations).map(([locale, translation]) => ({
			id: translation.id ?? `${id}-${locale}`,
			path: translation.path,
			locale: locale as Locale,
			title: translation.title,
			description: translation.description,
			blocks: translation.blocks,
		})),
	};
}
