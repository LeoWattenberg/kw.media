import type { Locale } from '../i18n';

export type PageBlock =
	| HeroBlock
	| HtmlBlock
	| CredentialsBlock
	| ServicesBlock
	| StatsBlock
	| TextBlock
	| TestimonialsBlock
	| FaqBlock
	| PricingBlock
	| PersonBlock
	| PostListBlock
	| YouTubePlaylistBlock
	| CtaBlock;

export interface Action {
	label: string;
	href: string;
	variant?: 'primary' | 'secondary';
}

export interface HeroBlock {
	type: 'hero';
	eyebrow?: string;
	title: string;
	text: string;
	actions?: Action[];
	image?: string;
	imageAlt?: string;
}

export interface HtmlBlock {
	type: 'html';
	html: string;
}

export interface CredentialsBlock {
	type: 'credentials';
	items: string[];
}

export interface ServicesBlock {
	type: 'services';
	eyebrow?: string;
	title: string;
	intro?: string;
	linkLabel?: string;
	items: Array<{
		title: string;
		text: string;
		href?: string;
	}>;
}

export interface StatsBlock {
	type: 'stats';
	items: Array<{
		value: string;
		label: string;
	}>;
}

export interface TextBlock {
	type: 'text';
	eyebrow?: string;
	title: string;
	body: string[];
	checks?: string[];
	image?: string;
	imageAlt?: string;
	reverse?: boolean;
}

export interface TestimonialsBlock {
	type: 'testimonials';
	eyebrow?: string;
	title: string;
	intro?: string;
	items: Array<{
		quote: string;
		name: string;
		meta?: string;
	}>;
}

export interface FaqBlock {
	type: 'faq';
	title: string;
	items: Array<{
		question: string;
		answer: string[];
	}>;
}

export interface PricingBlock {
	type: 'pricing';
	eyebrow?: string;
	title: string;
	note?: string;
	items: Array<{
		name: string;
		summary: string;
		price: string;
		period?: string;
		highlight?: string;
		features: string[];
		action: Action;
	}>;
}

export interface PersonBlock {
	type: 'person';
	eyebrow?: string;
	title: string;
	name: string;
	role?: string;
	image?: string;
	imageAlt?: string;
	credentials: string[];
	body: string[];
	email: string;
}

export interface PostListBlock {
	type: 'posts';
	title: string;
	categoryId?: number;
	authorName?: string;
	limit?: number;
	moreHref?: string;
	moreLabel?: string;
}

export interface YouTubePlaylistBlock {
	type: 'youtubePlaylist';
	title: string;
	eyebrow?: string;
	playlistId: string;
}

export interface CtaBlock {
	type: 'cta';
	title: string;
	text: string;
	email: string;
	items?: string[];
}

export interface SitePage {
	id: string;
	path: string;
	locale: Locale;
	title: string;
	description: string;
	blocks: PageBlock[];
}
