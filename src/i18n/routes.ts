import { defaultLocale, isLocale, type Locale } from './config';

export interface LocalizedRoute {
	de: string;
	en: string;
}

export const routes = {
	home: {
		de: '/',
		en: '/en/',
	},
	creators: {
		de: '/de/creator/',
		en: '/en/creator/',
	},
	brands: {
		de: '/de/b2b/',
		en: '/en/b2b/',
	},
	courses: {
		de: '/de/kurse/',
		en: '/en/lectures-courses/',
	},
	live: {
		de: '/de/live/',
		en: '/en/live/',
	},
	ads: {
		de: '/de/werbung/',
		en: '/en/ads/',
	},
	tips: {
		de: '/de/youtube-tipps/',
		en: '/en/youtube-tips/',
	},
	imprintService: {
		de: '/impressumsservice/',
		en: '/en/imprint-service/',
	},
	vtuber: {
		de: '/de/vtuber/',
		en: '/en/vtuber/',
	},
	legal: {
		de: '/impressum/',
		en: '/impressum/',
	},
} satisfies Record<string, LocalizedRoute>;

export function routeFor(route: keyof typeof routes, locale: Locale): string {
	return routes[route][locale];
}

export function localeFromPath(pathname: string): Locale {
	const segment = pathname.split('/').filter(Boolean)[0];
	return isLocale(segment) ? segment : defaultLocale;
}
