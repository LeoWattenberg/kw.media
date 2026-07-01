import type { Locale } from '../i18n';

export interface ToolPage {
	id: string;
	path: string;
	locale: Locale;
	title: string;
	description: string;
}

export interface ToolPageTranslation {
	id?: string;
	path: string;
	title: string;
	description: string;
}

export interface ToolPageTranslations {
	id: string;
	translations: Partial<Record<Locale, ToolPageTranslation>>;
}

export interface ToolPageModule {
	id: string;
	pages: ToolPage[];
}

export function defineToolModule(id: string, source: ToolPageTranslations): ToolPageModule {
	return {
		id,
		pages: Object.entries(source.translations).map(([locale, translation]) => ({
			id: translation.id ?? `${id}-${locale}`,
			path: translation.path,
			locale: locale as Locale,
			title: translation.title,
			description: translation.description,
		})),
	};
}
