import type { Locale } from './config';

export const ui = {
	de: {
		siteName: 'Koytek Wattenberg Media',
		nav: {
			home: 'Start',
			forCreators: 'Für Creator',
			forBrands: 'Für Firmen',
			courses: 'Kurse',
			live: 'Live',
			ads: 'Werbung',
			tips: 'YouTube Tipps',
			vtuber: 'VTuber',
			imprintService: 'Impressumsservice',
			legal: 'Impressum',
			language: 'English',
		},
		footer: {
			availability: 'Erste Antwort innerhalb von 24h.',
			about: 'Persönliche Beratung zu Web Content und Web Events',
			legal: 'Impressum und Datenschutzerklärung',
		},
		review: {
			kicker: 'Strukturentwurf',
			title: 'Astro-Migration zur Review',
			intro: 'Diese Seite zeigt die geplanten Routen und wiederverwendbaren Blöcke. Die kopierten Inhalte bleiben bis zur Freigabe in der Referenzablage.',
			source: 'Quelle',
			blocks: 'Geplante Blöcke',
		},
	},
	en: {
		siteName: 'Koytek Wattenberg Media',
		nav: {
			home: 'Home',
			forCreators: 'For Creators',
			forBrands: 'For Brands',
			courses: 'Lectures & Courses',
			live: 'Live',
			ads: 'Ads',
			tips: 'YouTube Tips',
			vtuber: 'VTubers',
			imprintService: 'Imprint service',
			legal: 'Imprint',
			language: 'Deutsch',
		},
		footer: {
			availability: 'First reply within 24h.',
			about: 'Personal consulting for web content and web events',
			legal: 'Imprint and privacy policy',
		},
		review: {
			kicker: 'Structure draft',
			title: 'Astro migration review',
			intro: 'This page shows the planned routes and reusable blocks. Copied content stays in the reference snapshot until the structure is approved.',
			source: 'Source',
			blocks: 'Planned blocks',
		},
	},
} satisfies Record<Locale, Record<string, unknown>>;

type TranslationTree = (typeof ui)[Locale];

export function useTranslations(locale: Locale) {
	const translations = ui[locale] as TranslationTree;

	return function t(key: string): string {
		const value = key.split('.').reduce<unknown>((current, part) => {
			if (current && typeof current === 'object' && part in current) {
				return (current as Record<string, unknown>)[part];
			}

			return undefined;
		}, translations);

		return typeof value === 'string' ? value : key;
	};
}
