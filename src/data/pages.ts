import type { Locale } from '../i18n';
import type { PlannedBlock } from '../lib/blocks';

export type PageKind = 'page' | 'archive' | 'post' | 'legal';

export interface PagePlan {
	id: string;
	locale: Locale;
	kind: PageKind;
	path: string;
	title: string;
	source: string;
	sourceId?: number;
	blocks: PlannedBlock[];
}

const sharedMarketingBlocks: PlannedBlock[] = [
	{ kind: 'hero', name: 'Landing proposition' },
	{ kind: 'trustLogos', name: 'Credentials' },
	{ kind: 'serviceGrid', name: 'Services overview' },
	{ kind: 'stats', name: 'Reach counters' },
	{ kind: 'testimonials', name: 'Customer quotes' },
	{ kind: 'cta', name: 'Start now' },
];

export const pagePlans: PagePlan[] = [
	{
		id: 'home-de',
		locale: 'de',
		kind: 'page',
		path: '/',
		title: 'Deutsche Startseite',
		source: 'reference/source-site/pages.json',
		sourceId: 866,
		blocks: sharedMarketingBlocks,
	},
	{
		id: 'home-en',
		locale: 'en',
		kind: 'page',
		path: '/en/',
		title: 'English homepage',
		source: 'reference/source-site/pages.json',
		sourceId: 801,
		blocks: sharedMarketingBlocks,
	},
	{
		id: 'creator-de',
		locale: 'de',
		kind: 'page',
		path: '/de/creator/',
		title: 'Für Creator',
		source: 'reference/source-site/pages.json',
		sourceId: 920,
		blocks: [
			{ kind: 'hero', name: 'Creator promise' },
			{ kind: 'serviceGrid', name: 'Creator services' },
			{ kind: 'faq', name: 'Creator FAQ' },
			{ kind: 'postList', name: 'German YouTube tips preview' },
			{ kind: 'pricing', name: 'Creator packages' },
			{ kind: 'splitContent', name: 'Personal contact' },
			{ kind: 'contact', name: 'Inquiry form' },
		],
	},
	{
		id: 'creator-en',
		locale: 'en',
		kind: 'page',
		path: '/en/creator/',
		title: 'For Creators',
		source: 'reference/source-site/pages.json',
		sourceId: 1214,
		blocks: [
			{ kind: 'hero', name: 'Creator promise' },
			{ kind: 'serviceGrid', name: 'Creator services' },
			{ kind: 'faq', name: 'Creator FAQ' },
			{ kind: 'postList', name: 'English YouTube tips preview' },
			{ kind: 'pricing', name: 'Creator packages' },
			{ kind: 'splitContent', name: 'Personal contact' },
			{ kind: 'contact', name: 'Inquiry form' },
		],
	},
	{
		id: 'brands-de',
		locale: 'de',
		kind: 'page',
		path: '/de/b2b/',
		title: 'Für Firmen',
		source: 'reference/source-site/pages.json',
		sourceId: 1030,
		blocks: [
			{ kind: 'hero', name: 'Brand consulting proposition' },
			{ kind: 'serviceGrid', name: 'B2B services' },
			{ kind: 'splitContent', name: 'YouTube strategy' },
			{ kind: 'pricing', name: 'Consulting packages' },
			{ kind: 'contact', name: 'Inquiry form' },
		],
	},
	{
		id: 'brands-en',
		locale: 'en',
		kind: 'page',
		path: '/en/b2b/',
		title: 'For Brands',
		source: 'reference/source-site/pages.json',
		sourceId: 1224,
		blocks: [
			{ kind: 'hero', name: 'Brand consulting proposition' },
			{ kind: 'serviceGrid', name: 'B2B services' },
			{ kind: 'splitContent', name: 'YouTube strategy' },
			{ kind: 'pricing', name: 'Consulting packages' },
			{ kind: 'contact', name: 'Inquiry form' },
		],
	},
	{
		id: 'live-de',
		locale: 'de',
		kind: 'page',
		path: '/de/live/',
		title: 'Live',
		source: 'reference/source-site/pages.json',
		sourceId: 1000,
		blocks: [
			{ kind: 'hero', name: 'Live production promise' },
			{ kind: 'serviceGrid', name: 'Production services' },
			{ kind: 'splitContent', name: 'Remote and event workflows' },
			{ kind: 'contact', name: 'Inquiry form' },
		],
	},
	{
		id: 'live-en',
		locale: 'en',
		kind: 'page',
		path: '/en/live/',
		title: 'Live',
		source: 'reference/source-site/pages.json',
		sourceId: 1282,
		blocks: [
			{ kind: 'hero', name: 'Live production promise' },
			{ kind: 'serviceGrid', name: 'Production services' },
			{ kind: 'splitContent', name: 'Remote and event workflows' },
			{ kind: 'contact', name: 'Inquiry form' },
		],
	},
	{
		id: 'ads-de',
		locale: 'de',
		kind: 'page',
		path: '/de/werbung/',
		title: 'Werbung',
		source: 'reference/source-site/pages.json',
		sourceId: 998,
		blocks: [
			{ kind: 'hero', name: 'Ads proposition' },
			{ kind: 'serviceGrid', name: 'Campaign services' },
			{ kind: 'splitContent', name: 'Google Ads expertise' },
			{ kind: 'contact', name: 'Inquiry form' },
		],
	},
	{
		id: 'ads-en',
		locale: 'en',
		kind: 'page',
		path: '/en/ads/',
		title: 'Ads',
		source: 'reference/source-site/pages.json',
		sourceId: 1287,
		blocks: [
			{ kind: 'hero', name: 'Ads proposition' },
			{ kind: 'serviceGrid', name: 'Campaign services' },
			{ kind: 'splitContent', name: 'Google Ads expertise' },
			{ kind: 'contact', name: 'Inquiry form' },
		],
	},
	{
		id: 'imprint-service',
		locale: 'de',
		kind: 'page',
		path: '/impressumsservice/',
		title: 'Impressumsservice',
		source: 'reference/source-site/pages.json',
		sourceId: 2378,
		blocks: [
			{ kind: 'hero', name: 'Privacy and legal promise' },
			{ kind: 'faq', name: 'Legal service FAQ' },
			{ kind: 'pricing', name: 'Imprint service packages' },
			{ kind: 'cta', name: 'Signup instructions' },
		],
	},
	{
		id: 'blog',
		locale: 'en',
		kind: 'archive',
		path: '/blog/',
		title: 'Blog',
		source: 'reference/source-site/posts.json',
		blocks: [{ kind: 'postList', name: 'All posts archive' }],
	},
	{
		id: 'tips-de',
		locale: 'de',
		kind: 'archive',
		path: '/category/youtube-tipps-de/',
		title: 'YouTube Tipps & Tricks auf Deutsch',
		source: 'reference/source-site/posts.json',
		blocks: [{ kind: 'postList', name: 'German tips archive' }],
	},
	{
		id: 'tips-en',
		locale: 'en',
		kind: 'archive',
		path: '/category/youtube-tips-en/',
		title: 'YouTube Tips & Tricks in English',
		source: 'reference/source-site/posts.json',
		blocks: [{ kind: 'postList', name: 'English tips archive' }],
	},
	{
		id: 'legal',
		locale: 'de',
		kind: 'legal',
		path: '/impressum/',
		title: 'Impressum und Datenschutzerklärung',
		source: 'reference/source-site/pages.json',
		sourceId: 3,
		blocks: [{ kind: 'legal', name: 'Imprint and privacy policy' }],
	},
];

export function findPagePlan(pathname: string): PagePlan | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return pagePlans.find((page) => page.path === normalizedPath);
}
