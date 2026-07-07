import type { Locale } from '../i18n';

export interface GamePage {
	id: string;
	path: string;
	locale: Locale;
	title: string;
	description: string;
}

export interface GamePageTranslation {
	id?: string;
	path: string;
	title: string;
	description: string;
}

export interface GamePageTranslations {
	id: string;
	translations: Partial<Record<Locale, GamePageTranslation>>;
}

export interface GamePageModule {
	id: string;
	pages: GamePage[];
}

export function defineGameModule(id: string, source: GamePageTranslations): GamePageModule {
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
