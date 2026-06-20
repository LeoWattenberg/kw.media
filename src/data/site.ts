import { routeFor, type Locale } from '../i18n';

export interface NavItem {
	labelKey: string;
	href: string;
	children?: NavItem[];
}

export function getNavigation(locale: Locale): NavItem[] {
	return [
		{
			labelKey: 'nav.forCreators',
			href: routeFor('creators', locale),
			children: [
				{
					labelKey: 'nav.tips',
					href: routeFor('tips', locale),
				},
			],
		},
		{
			labelKey: 'nav.forBrands',
			href: routeFor('brands', locale),
			children: [
				{
					labelKey: 'nav.live',
					href: routeFor('live', locale),
				},
				{
					labelKey: 'nav.ads',
					href: routeFor('ads', locale),
				},
			],
		},
		{
			labelKey: 'nav.vtuber',
			href: routeFor('vtuber', locale),
		},
		{
			labelKey: 'nav.dubbing',
			href: routeFor('dubbing', locale),
		},
		{
			labelKey: 'nav.imprintService',
			href: routeFor('imprintService', locale),
		},
	];
}

export const socialLinks = [
	{
		label: 'YouTube',
		href: 'https://www.youtube.com/channel/UCGu6U-UNczXKxShRiJj6kXQ',
	},
	{
		label: 'LinkedIn',
		href: 'https://www.linkedin.com/company/kwmediaug',
	},
	{
		label: 'X',
		href: 'https://x.com/kwmediaUG',
	},
];
