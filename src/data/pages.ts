import type { Locale } from '../i18n';

export type PageBlock =
	| HeroBlock
	| CredentialsBlock
	| ServicesBlock
	| StatsBlock
	| TextBlock
	| TestimonialsBlock
	| FaqBlock
	| PricingBlock
	| PersonBlock
	| PostListBlock
	| CtaBlock
	| RawPageBlock;

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
	limit?: number;
	moreHref?: string;
	moreLabel?: string;
}

export interface CtaBlock {
	type: 'cta';
	title: string;
	text: string;
	email: string;
	items?: string[];
}

export interface RawPageBlock {
	type: 'rawPage';
	sourceId: number;
}

export interface SitePage {
	id: string;
	path: string;
	locale: Locale;
	title: string;
	description: string;
	blocks: PageBlock[];
}

const assets = {
	about: 'https://kw.media/wp-content/uploads/2020/03/about.jpg',
	home: 'https://kw.media/wp-content/uploads/2021/04/yt-banner.png',
	creator: 'https://kw.media/wp-content/uploads/2022/03/happy-couple-of-bloggers-recording-a-video-prepari-2021-09-01-07-29-39-utc-scaled.jpg',
	live: 'https://kw.media/wp-content/uploads/2022/04/shooting-concert-professional-camera-view-of-the-2021-08-26-22-32-50-utc-scaled.jpg',
	ads: 'https://kw.media/wp-content/uploads/2022/04/close-up-woman-hand-holding-mobile-watching-video-2021-11-01-17-23-58-utc-scaled.jpg',
	brand: 'https://kw.media/wp-content/uploads/2022/03/professional-film-camera-and-lens-2021-08-30-08-50-07-utc-scaled.jpg',
	vtuber: 'https://kw.media/wp-content/uploads/2021/03/Leo_mit_angel.png',
	martin: 'https://kw.media/wp-content/uploads/2020/01/martinkoytek_540.jpg',
	leo: 'https://kw.media/wp-content/uploads/2021/03/Leo_mit_angel.png',
};

const credentialsDe: CredentialsBlock = {
	type: 'credentials',
	items: ['YouTube Certified', 'YouTube Product Expert', 'Google Partner'],
};

const credentialsEn: CredentialsBlock = {
	type: 'credentials',
	items: ['YouTube Certified', 'YouTube Product Expert', 'Google Partner'],
};

const germanTestimonials: TestimonialsBlock = {
	type: 'testimonials',
	eyebrow: 'Kundenstimmen',
	title: 'Das sagen unsere Kunden über uns',
	intro: 'Wir legen Wert auf individuelle Betreuung - maßgeschneidert für Ihre Ziele.',
	items: [
		{
			quote: 'Die Zusammenarbeit hätte besser nicht laufen können. Mit kurzer Vorlaufzeit wurde das Event schnell und kompetent umgesetzt. Die Adaption auf unsere Bedürfnisse war super. Gerne wieder!',
			name: 'Bündnis 90 Die Grünen',
			meta: 'Kreisverband Köln',
		},
		{
			quote: 'Unser Lösungsweg bei allen Fragen und Problemen rund um Social Media. Gerade im Bereich YouTube ein starker Partner mit hohem Wissensstand und einer schnellen Reaktionszeit.',
			name: 'Pirate Racing',
			meta: 'YouTube-Kanal',
		},
		{
			quote: 'Super angenehme Zusammenarbeit. Schnelle Antworten und zielorientierte Lösungsvorschläge. Seriöses, strukturiertes und engagiertes gehören zu den Stärken von Martin.',
			name: 'Maki',
			meta: 'YouTube-Kanal',
		},
		{
			quote: 'Die Arbeit mit Martin ist sehr freundschaftlich und professionell. Ich schätze seine YouTube-Expertise sehr und kann mich bei jedem YouTube-Problem auf eine hilfreiche Antwort verlassen.',
			name: 'Chris Kiss',
			meta: 'YouTube-Kanal',
		},
	],
};

const aboutDe: TextBlock = {
	type: 'text',
	eyebrow: 'Erfahren - Anpassungsfähig - Schnell',
	title: 'Wir erreichen Ihre Ziele',
	body: [
		'Gemeinsam bringen wir 20 Jahre Webvideo-Erfahrung in Ihre Projekte ein. Wir kennen die Plattformen, ihre Regeln und die Arbeit hinter erfolgreichen Web-Events.',
	],
	checks: [
		'Gemeinsam 20 Jahre Webvideo Erfahrung',
		'Kontinuierliche Weiterbildung',
		'Erfassung aktueller Trends im Online Marketing',
		'Zügige und sorgfältige Umsetzung von Projekten',
		'Ehrliche Beratung',
		'Kompetente Partner für Ihren Erfolg',
	],
	image: assets.about,
	imageAlt: 'Teamarbeit bei kw.media',
};

const aboutEn: TextBlock = {
	type: 'text',
	eyebrow: 'Experienced, adaptable, fast and honest',
	title: 'About us',
	body: [
		'Together we bring 20 years of web video experience into our work, answered several ten thousand YouTube questions, supported and grew countless creators.',
		'We adapt quickly to changes on YouTube and with our customers. Instead of promising the blue out of the sky, we remain humble and realistic, brainstorm with you and focus our work to deliver only the highest quality.',
	],
	image: assets.about,
	imageAlt: 'kw.media team workspace',
};

const contactDe: CtaBlock = {
	type: 'cta',
	title: 'Jetzt durchstarten!',
	text: 'Jeder Kanal und jedes Projekt ist anders. Schildern Sie uns Ihr Projekt und Ihre Vorstellungen, und wir erarbeiten gemeinsam eine individuelle Lösung.',
	email: 'team@kw.media',
};

const contactEn: CtaBlock = {
	type: 'cta',
	title: 'Interested?',
	text: 'Every channel and every project is a different challenge. Tell us about your vision and we will work on an individual solution for you.',
	email: 'team@kw.media',
};

const martinDe: PersonBlock = {
	type: 'person',
	eyebrow: 'Ihr persönlicher Ansprechpartner',
	title: 'Direkter Kontakt',
	name: 'Martin Koytek',
	image: assets.martin,
	imageAlt: 'Martin Koytek',
	credentials: ['YouTube Certified', 'Google Ads Partner', 'YouTube Diamond Produktexperte'],
	body: [
		'Ich bin gerne für Ihre Fragen da. Wenn Sie noch zweifeln, ob kw.media Ihr richtiger Partner für Ihre Strategie ist, dann schreiben Sie mir und in einem kostenlosen Erstgespräch finden wir es heraus.',
	],
	email: 'team@kw.media',
};

const martinEn: PersonBlock = {
	type: 'person',
	eyebrow: 'Your personal point of contact',
	title: 'Direct contact',
	name: 'Martin Koytek',
	image: assets.martin,
	imageAlt: 'Martin Koytek',
	credentials: ['YouTube Certified', 'Google Ads Partner', 'YouTube Product Expert'],
	body: [
		"I'm always available for your questions. If you have any concerns whether kw.media is the right partner for your strategy, just write me and we'll figure it out in a free initial meeting.",
	],
	email: 'team@kw.media',
};

const creatorPricingDe: PricingBlock = {
	type: 'pricing',
	title: 'Unsere Preise',
	note: 'Ein Monat kostenlos bei Buchung für ein ganzes Jahr. Preise ohne MwSt. Individuelle Preise auf Anfrage möglich.',
	items: [
		{
			name: 'kw.media basic',
			summary: 'Für neue Creator',
			price: '20 €',
			period: 'monatlich',
			features: ['YouTube Feature Support', 'Regelmäßige Kanalanalysen'],
			action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' },
		},
		{
			name: 'kw.media classic',
			summary: 'Für Creator mit Wachstumsambitionen',
			price: '50 €',
			period: 'monatlich',
			highlight: 'Beliebt',
			features: [
				'Alles aus basic',
				'Individueller Support',
				'Einrichtung von Community-Funktionen',
				'Backups von deinen Videos',
				'Anbieterkennzeichnung für deinen Kanal',
			],
			action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' },
		},
		{
			name: 'kw.media premium',
			summary: 'Damit dein Kanal brummt',
			price: '500 €',
			period: 'monatlich',
			features: ['Alles aus classic', 'Assetproduktion', 'Google Ads Kampagnenpflege'],
			action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' },
		},
	],
};

const creatorPricingEn: PricingBlock = {
	type: 'pricing',
	title: 'Our prices',
	note: 'One free month when booking for an entire year. Prices excluding VAT. Individual pricing available on request.',
	items: [
		{
			name: 'kw.media basic',
			summary: 'For new creators',
			price: '20 €',
			period: 'per month',
			features: ['YouTube feature support', 'Regular channel analysis'],
			action: { label: 'Order now', href: 'mailto:team@kw.media' },
		},
		{
			name: 'kw.media classic',
			summary: 'For creators looking to grow',
			price: '50 €',
			period: 'per month',
			highlight: 'Popular',
			features: [
				'Everything from basic',
				'Individual support',
				'Setup of community features',
				'Video backups included',
				'Provider identification service for your channel',
			],
			action: { label: 'Order now', href: 'mailto:team@kw.media' },
		},
		{
			name: 'kw.media premium',
			summary: 'To make your channel soar',
			price: '500 €',
			period: 'per month',
			features: ['Everything from classic', 'Asset production', 'Google Ads campaign maintenance'],
			action: { label: 'Order now', href: 'mailto:team@kw.media' },
		},
	],
};

export const sitePages: SitePage[] = [
	{
		id: 'home-de',
		path: '/',
		locale: 'de',
		title: 'Koytek Wattenberg Media',
		description: 'Strategien für YouTube, Liveübertragungen und Online-Marketing.',
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Online Marketing, YouTube und Live',
				title: 'Die beste Lösung für Ihr Online Marketing',
				text: 'Wir erstellen effektive Strategien für YouTube, Liveübertragungen und alles für Ihren Erfolg im Netz.',
				image: assets.home,
				imageAlt: 'YouTube Banner von kw.media',
				actions: [
					{ label: 'Für Firmen', href: '/de/b2b/', variant: 'primary' },
					{ label: 'Für Creator', href: '/de/creator/', variant: 'secondary' },
				],
			},
			credentialsDe,
			{
				type: 'services',
				eyebrow: 'Ihr Erfolg ist unsere Priorität',
				title: 'So bringen wir Ihr Business auf das nächste Level',
				linkLabel: 'Mehr erfahren',
				items: [
					{ title: 'Events', text: 'Aufnahmen, Liveübertragung und Produktion von Events.', href: '/de/live/' },
					{ title: 'Beratung', text: 'Content Strategie, Beratungen und Analysen für YouTube Kanäle.', href: '/de/creator/' },
					{ title: 'Online-Werbung', text: 'Beratung und Optimierung von Google Ads-Kampagnen und anderen Plattformen.', href: '/de/werbung/' },
				],
			},
			{ type: 'stats', items: [{ value: '100M+', label: 'Videoaufrufe in DACH' }, { value: '1M+', label: 'Abonnenten insgesamt' }] },
			aboutDe,
			germanTestimonials,
			contactDe,
		],
	},
	{
		id: 'home-en',
		path: '/en/',
		locale: 'en',
		title: 'YouTube Consulting, Live Stream Production, Ads and SEO',
		description: 'YouTube consulting, live streaming, ads and creator support.',
		blocks: [
			{
				type: 'hero',
				eyebrow: 'YouTube, live streaming and ads',
				title: 'Questions about YouTube, live streaming and ads?',
				text: 'We are here to help with strategy, production, advertising and the practical work that moves channels forward.',
				image: assets.home,
				imageAlt: 'kw.media YouTube banner',
				actions: [{ label: 'Contact us', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			credentialsEn,
			{
				type: 'services',
				eyebrow: 'What we do best',
				title: 'Your success is our priority',
				linkLabel: 'Learn more',
				items: [
					{ title: 'Consultation', text: 'Content strategy consultation and analyses for YouTube channels.', href: '/en/creator/' },
					{ title: 'VTuber model creation', text: 'Creation, rigging and stream integration of 3D models.', href: '/en/vtuber/' },
					{ title: 'Events', text: 'Recording, livestreaming and event production.', href: '/en/live/' },
					{ title: 'Online advertisement', text: 'Consultation and optimization of Google Ads campaigns and other platforms.', href: '/en/ads/' },
				],
			},
			{ type: 'posts', title: 'YouTube Tips & Tricks', categoryId: 18, limit: 3, moreHref: '/en/youtube-tips/', moreLabel: 'More tips' },
			{ type: 'stats', items: [{ value: '100M+', label: 'Views in DACH' }, { value: '1M+', label: 'Subscribers' }] },
			aboutEn,
			contactEn,
		],
	},
	{
		id: 'creator-de',
		path: '/de/creator/',
		locale: 'de',
		title: 'Creator Support und Beratung',
		description: 'YouTube Support, Kanalberatung, Monetarisierung und Backups für Creator.',
		blocks: [
			{
				type: 'hero',
				title: 'Wir helfen Talenten',
				text: 'Du möchtest mehr aus deinem YouTube-Kanal rausholen? Dann komm zu kw.media.',
				image: assets.creator,
				imageAlt: 'Creator bei der Videoproduktion',
				actions: [{ label: 'Lass uns starten', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'services',
				eyebrow: 'Erreiche dein Next Level',
				title: 'So bringen wir dich voran',
				items: [
					{ title: 'Kanalanalysen', text: 'Wir helfen dir, deine Zahlen zu interpretieren und das Maximum aus deinem Kanal zu holen.' },
					{ title: 'Bessere Monetarisierung', text: 'Wir optimieren deinen Kanal für höhere Einnahmen und holen mit dir mehr aus Product Placements heraus.' },
					{ title: 'Backups', text: 'Kontinuierliche, verschlüsselte Backups für deine Daten und Videoprojekte.' },
					{ title: 'Beratung', text: 'Ob Contentstrategie, neue Kanalausrichtung oder Kanalwiederbelebung: wir helfen dir auf deinem Weg.' },
					{ title: 'Individueller YouTube-Support', text: 'Direkter YouTube Support bei Fragen und Problemen aller Art.' },
					{ title: 'Community-Richtlinien und mehr', text: 'Wir sind zwar keine Anwälte, kennen uns aber im Gestrüpp diverser YouTube-Regeln gut aus.' },
				],
			},
			{
				type: 'faq',
				title: 'Häufige Fragen',
				items: [
					{ question: 'Wie verdient ein Influencer Geld?', answer: ['Neben Werbeeinnahmen auf YouTube kannst du Kooperationen eingehen, eigene Produkte verkaufen oder weitere Einnahmequellen wie Merchandise und Kurse aufbauen.'] },
					{ question: 'Ab wann gilt man als Influencer?', answer: ['Als Influencer brauchst du eine Community, die dir vertraut und deine Meinung schätzt. Das entsteht durch guten Content und gezielte Ansprache.'] },
					{ question: 'Kann man in YouTube Deutschland noch erfolgreich werden?', answer: ['Ja. Mit dem richtigen Thema und einer passenden Strategie kannst du auch heute erfolgreich werden. Dabei helfen wir dir gerne.'] },
					{ question: 'Kann ich andere YouTube Creator kennenlernen?', answer: ['Als Teil des kw.media Teams lernst du auch andere Creator kennen und sparst dir viel mühsames Networking.'] },
				],
			},
			{ type: 'posts', title: 'YouTube Tipps & Tricks', categoryId: 17, limit: 3, moreHref: '/de/youtube-tipps/', moreLabel: 'Mehr Tipps' },
			creatorPricingDe,
			martinDe,
			contactDe,
		],
	},
	{
		id: 'creator-en',
		path: '/en/creator/',
		locale: 'en',
		title: 'Creator Services',
		description: 'YouTube support, channel analytics, monetization and creator consulting.',
		blocks: [
			{
				type: 'hero',
				title: "We'll help bring your channel to the next level",
				text: 'Creator support, analytics, monetization, consulting and practical YouTube problem solving.',
				image: assets.creator,
				imageAlt: 'Creators recording a video',
				actions: [{ label: 'Contact us', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			credentialsEn,
			{
				type: 'services',
				eyebrow: 'Our services',
				title: 'We can help with the following',
				items: [
					{ title: 'Channel analytics', text: 'The numbers matter, and we can tell you what they mean so your content can improve.' },
					{ title: 'Better monetization', text: 'We get your channel ready for more revenue and help with sponsorship deals.' },
					{ title: 'Ads', text: 'Reach new potential viewers with ads, starting at 1 euro per day.' },
					{ title: 'Consulting', text: 'Content strategy, pivoting or reviving your channel: we advise you on your next steps.' },
					{ title: 'Individual YouTube support', text: 'Direct YouTube support for questions and problems of all kinds and sizes.' },
					{ title: 'Community Guidelines and more', text: 'We might not be lawyers, but we know our way around YouTube-related rules.' },
				],
			},
			{ type: 'posts', title: 'YouTube Tips & Tricks', categoryId: 18, limit: 3, moreHref: '/en/youtube-tips/', moreLabel: 'More tips' },
			martinEn,
			creatorPricingEn,
			contactEn,
		],
	},
	{
		id: 'brands-de',
		path: '/de/b2b/',
		locale: 'de',
		title: 'YouTube für Firmen',
		description: 'YouTube Consulting, Schulungen, Werbung und Support für Firmen.',
		blocks: [
			{
				type: 'hero',
				title: 'YouTube für Firmen',
				text: 'Gemeinsam sorgen wir für den perfekten YouTube Auftritt Ihrer Firma.',
				image: assets.brand,
				imageAlt: 'Professionelle Kamera bei einer Produktion',
				actions: [{ label: 'Schreiben Sie uns an', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'services',
				eyebrow: 'Wir erreichen Ihre Ziele',
				title: 'Gemeinsam für Ihren Auftritt',
				items: [
					{ title: 'Kanalanalysen', text: 'Wir schaffen aus YouTube-Daten sinnvolle und leicht verständliche Analysen.' },
					{ title: 'Schulungen', text: 'Schulungen für Ihr Social Media Team für effiziente und zielgerichtete YouTube Strategien.' },
					{ title: 'Werbung', text: 'Neue Zuschauer, Kunden und Fans gewinnen: wir konzipieren, produzieren und distributieren.' },
					{ title: 'Beratung', text: 'Egal, was Ihre Ziele sind: Wir stehen Ihnen strategisch zur Seite.' },
					{ title: 'Individueller YouTube-Support', text: 'Fragen, Probleme oder Feedback? Mit unserem zeitnahen Service bekommen Sie schnell eine Antwort.' },
					{ title: 'Rechtliche Stolperfallen', text: 'Wir kennen uns im Gestrüpp diverser YouTube-relevanter Regeln gut aus.' },
				],
			},
			{
				type: 'faq',
				title: 'Häufige Fragen',
				items: [
					{ question: 'Welche Vorteile hat YouTube für Firmen?', answer: ['Mit YouTube erreichen Sie Ihre Zielgruppe dort, wo sie sich im Alltag viel aufhält. Videos, Kommentare, Links und Werbung greifen hier sinnvoll ineinander.'] },
					{ question: 'Was kostet YouTube für Unternehmen?', answer: ['Ein YouTube Account und das Hochladen von Videos sind grundsätzlich kostenlos. Kosten entstehen vor allem bei Strategie, Produktion und Werbung.'] },
					{ question: 'Wie beginnt man am besten mit YouTube für Firmen?', answer: ['Erstmal machen und Erfahrungen sammeln. Wenn Sie zielgerichteter starten wollen, helfen wir mit Ihrer Erfolgsstrategie.'] },
					{ question: 'Welches Equipment brauchen wir für unseren Kanal?', answer: ['Das hängt vom Projekt ab. Für manches reicht ein Smartphone, für anderes sind professionelle Kameras sinnvoll. Ein externes Mikrofon und Schnittprogramm helfen fast immer.'] },
				],
			},
			martinDe,
			contactDe,
		],
	},
	{
		id: 'brands-en',
		path: '/en/b2b/',
		locale: 'en',
		title: 'YouTube Consulting for Brands',
		description: 'YouTube consulting, training, ads and support for brands.',
		blocks: [
			{
				type: 'hero',
				title: 'We help brands reach the next level with their channels',
				text: 'Strategy, support, training and production for companies working with YouTube.',
				image: assets.brand,
				imageAlt: 'Professional camera lens',
				actions: [{ label: 'Contact us', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			credentialsEn,
			{
				type: 'services',
				eyebrow: 'Our services',
				title: 'We can offer',
				items: [
					{ title: 'Channel check-ups', text: 'From the data YouTube provides, we filter and prepare easy to understand analyses.' },
					{ title: 'Training', text: 'We teach social media teams the ins and outs of YouTube, so they can be more effective.' },
					{ title: 'Ads', text: 'Gain potential viewers, customers and fans with ads we plan, produce and distribute.' },
					{ title: 'Consulting', text: 'Content strategy, channel revival or influencer marketing: we find fitting next steps.' },
					{ title: 'Individual YouTube support', text: 'Direct YouTube support for questions and problems.' },
					{ title: 'Avoiding legal issues', text: 'Although we are no lawyers, we know our way around rules and laws that apply to YouTube.' },
				],
			},
			aboutEn,
			{
				type: 'pricing',
				title: 'Pricing',
				note: 'Excluding VAT.',
				items: [
					{ name: 'Free resources', summary: 'Updates and guides', price: 'Free', features: ['YouTube updates on our channel', 'Creator guides'], action: { label: 'Read tips', href: '/en/youtube-tips/' } },
					{ name: 'Support', summary: 'For support or consultation', price: '90 €', period: 'per hour', features: ['Direct help', 'Consulting sessions'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
					{ name: 'Individual', summary: 'Custom offer', price: 'Individual', features: ['Support', 'Consultation', 'Other kw.media services'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
				],
			},
			contactEn,
		],
	},
	{
		id: 'live-de',
		path: '/de/live/',
		locale: 'de',
		title: 'Live',
		description: 'Professionelle Livestreams und Eventvideos.',
		blocks: [
			{
				type: 'hero',
				title: 'Professionelle Livestreams und Eventvideos',
				text: 'Online und vor Ort: Wir helfen Ihnen so, wie Sie es brauchen.',
				image: assets.live,
				imageAlt: 'Videokamera bei einem Konzert',
				actions: [{ label: 'Schreiben Sie uns', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'services',
				eyebrow: 'Wir holen das Beste aus Ihrem Event',
				title: 'Liveproduktion für Ihr Format',
				items: [
					{ title: 'Teamwork', text: 'Durch unsere Erfahrung und unser Teamwork holen wir das Beste aus Ihrem Event.' },
					{ title: 'Ortsunabhängig', text: 'Bei großem Publikum, im kleinen Studio oder remote: Wir arrangieren Ihr Event da, wo Sie sind.' },
					{ title: 'Community Interaktion', text: 'Professionelle Livechat-Moderation, Social Media-Einblendungen und mehr.' },
					{ title: 'Technik', text: 'Wir adaptieren uns in bestehende Konferenztechnik und Tonanlagen oder bringen unsere eigene mit.' },
					{ title: 'Support und Beratung', text: 'Wir beraten Sie bei ausfallender Technik oder konzipieren Ihren Livestream.' },
					{ title: 'Und mehr', text: 'Wir kümmern uns um Ihre Bedürfnisse und sorgen für Ihr perfektes Liveevent.' },
				],
			},
			contactDe,
		],
	},
	{
		id: 'live-en',
		path: '/en/live/',
		locale: 'en',
		title: 'Live',
		description: 'Professional livestreams and event recordings.',
		blocks: [
			{
				type: 'hero',
				title: 'Professional livestreams and event recordings',
				text: 'Big stadium, small studio or completely remote: we can produce what your event needs.',
				image: assets.live,
				imageAlt: 'Video camera filming a concert',
				actions: [{ label: 'Contact us', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			credentialsEn,
			{
				type: 'services',
				eyebrow: 'Our services',
				title: 'We can help you with',
				items: [
					{ title: 'Teamwork', text: 'As a communicating team, cameras and mixing stay where they should be.' },
					{ title: 'Remote', text: 'Big stadium, small studio or completely remote: we can produce everything.' },
					{ title: 'Interaction', text: 'Livechat moderation, social media embeddings and more.' },
					{ title: 'Integration into your equipment', text: 'We integrate into existing conference and audio equipment or set up independently.' },
					{ title: 'Support and consultation', text: 'Need redundancy or help planning your next live event? We help all the way.' },
					{ title: 'And more', text: 'YouTube Live, Vimeo Live, DVDs, RTMPS, multistreams and individual workflows.' },
				],
			},
			{
				type: 'pricing',
				title: 'Pricing',
				note: 'Excluding VAT plus call-out charge.',
				items: [
					{ name: 'Small events', summary: 'Single camera', price: '120 €', period: 'per hour', features: ['Conferences', 'Recording and streaming'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
					{ name: 'Larger events', summary: 'Up to 4 cameras', price: '300 €', period: 'per hour', features: ['Live image mixing', 'Concert recording'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
					{ name: 'Individual', summary: 'Custom production', price: 'Individual', features: ['Nearly unlimited possibilities', 'Integration with other services'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
				],
			},
			contactEn,
		],
	},
	{
		id: 'ads-de',
		path: '/de/werbung/',
		locale: 'de',
		title: 'Werbung',
		description: 'Online-Werbung für YouTuber, KMU und mehr.',
		blocks: [
			{
				type: 'hero',
				title: 'Online-Werbung für YouTuber, KMU und mehr',
				text: 'Wir übernehmen Ihre Werbung, damit Ihr Budget gezielt arbeitet.',
				image: assets.ads,
				imageAlt: 'Online-Werbung auf einem Smartphone',
				actions: [{ label: 'Jetzt richtig werben', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			credentialsDe,
			{
				type: 'services',
				eyebrow: 'Mit Werbung trifft es immer die Richtigen',
				title: 'Keine Budgetverschwendung mehr',
				items: [
					{ title: 'Konzeption', text: 'Wir entwerfen Ihre Kampagne, von Brand-Awareness-Bumpern bis zu größeren Werbungen.' },
					{ title: 'Produktion', text: 'Wir erstellen Creatives nach Ihren Wünschen und passend für Ihre Zielgruppe.' },
					{ title: 'Google Ads', text: 'Wir erstellen maßgeschneiderte Google Ads Kampagnen für Ihr Ziel.' },
					{ title: 'Alle relevanten Plattformen', text: 'Wir erstellen Kampagnen für Plattformen von Google bis Social Media.' },
					{ title: 'Individuelles Targeting', text: 'Durch das richtige Targeting holen wir das Beste aus Ihrem Budget heraus.' },
					{ title: 'Beratung und Support', text: 'Wir sind bei Problemen schnellstmöglich für Sie da.' },
				],
			},
			martinDe,
			contactDe,
		],
	},
	{
		id: 'ads-en',
		path: '/en/ads/',
		locale: 'en',
		title: 'Ads',
		description: 'Easy online ads for YouTubers, SMBs and more.',
		blocks: [
			{
				type: 'hero',
				title: 'Easy online ads for YouTubers, SMBs and more',
				text: 'Advertising concepts, production, delivery, targeting and support from one team.',
				image: assets.ads,
				imageAlt: 'Online ads on a smartphone',
				actions: [{ label: 'Contact us', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			credentialsEn,
			{
				type: 'services',
				eyebrow: 'Our services',
				title: 'We are offering',
				items: [
					{ title: 'Concepts', text: 'Advertising, but what? We find ideas from simple awareness bumpers to larger creatives.' },
					{ title: 'Production', text: 'Filmed or animated, green screen or nature, banner or video ad: we can produce it.' },
					{ title: 'Delivery', text: 'Google Ads is complex. We take care of setup and delivery.' },
					{ title: 'All relevant platforms', text: 'Google, LinkedIn, Reddit, Instagram and more.' },
					{ title: 'Individual targeting', text: 'We minimize coverage waste with precise targeting.' },
					{ title: 'Consulting and support', text: 'As a second pair of eyes for problems, we are available quickly.' },
				],
			},
			{
				type: 'pricing',
				title: 'Our prices',
				note: 'Prices excluding advertising budget and VAT.',
				items: [
					{ name: 'Supported channels', summary: 'Ads for channels supported by us', price: 'Free', features: ['Starting at 1 euro per day ad budget'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
					{ name: 'Campaign delivery', summary: 'Existing creatives', price: '200 €', period: 'per campaign', features: ['Delivery', 'Targeting'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
					{ name: 'Production', summary: 'From scratch or assets', price: '90 €', period: 'per hour', features: ['Concept', 'Production'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
					{ name: 'Individual', summary: 'Custom offers', price: 'Individual', features: ['Other kw.media services available'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
				],
			},
			contactEn,
		],
	},
	{
		id: 'vtuber-de',
		path: '/de/vtuber/',
		locale: 'de',
		title: 'VTuber',
		description: 'VTuber-Modelle, Rigging und Creator-Support.',
		blocks: [
			{
				type: 'hero',
				title: 'Deine nächste VTuber-Identität',
				text: 'Werde ein einzigartiger VTuber und starte mit kw.media professionell durch.',
				image: assets.vtuber,
				imageAlt: 'VTuber-Charakter von kw.media',
				actions: [{ label: 'Lass uns starten', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'faq',
				title: 'Häufige Fragen',
				items: [
					{ question: 'Seid ihr eine Agentur?', answer: ['Wir sind keine Agentur wie Hololive oder Nijisanji. Wir glauben, dass die freie Gestaltung der eigenen Ausstrahlung einer der besten Aspekte an YouTube ist.'] },
					{ question: 'Welche Software eignet sich für VTubing?', answer: ['Wir empfehlen VSeeFace für virtuelle Webcam-Nutzung und VRChat für Content und Interaktion in virtuellen Welten.'] },
					{ question: 'Könnt ihr ein bestehendes Modell erweitern?', answer: ['Ja. Haare und Kleidung wechseln oder zusätzliche Augenformen und Gesichtsausdrücke ergänzen gehört zu den Dingen, bei denen wir helfen können.'] },
					{ question: 'Ist es zu spät, VTuber zu werden?', answer: ['Definitiv nicht. Ein gutes Konzept, starke Ausdrucksmöglichkeiten und passendes Marketing können dich weiterhin nach vorn bringen.'] },
				],
			},
			{
				type: 'pricing',
				title: 'Modellierungsservices',
				note: 'Inklusive einem kostenlosen Monat kw.media basic pro Bestellung. Preise ohne MwSt.',
				items: [
					{ name: 'VRChat-Modell', summary: 'Ein guter virtueller Körper für VRChat', price: '399,99 €', features: ['Basismodell, Haare und Kleidung', 'Einfaches Rigging', 'FBX', '3 Emotionen, 1 Augenform'], action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' } },
					{ name: '3D-VTuber-Modell', summary: 'Ein vielseitiges Paket für viele Einsatzzwecke', price: '600 €', highlight: 'Beliebt', features: ['Basismodell, Haare und Kleidung', 'Fortgeschrittenes Rigging', 'FBX, VRM', 'Viseme', 'ARKit', '5 Emotionen, 2 Augenformen'], action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' } },
					{ name: 'Voll ausgestattetes VTuber-Modell', summary: 'Mehr Details und Optionen', price: '1200 €', features: ['Alles aus dem VTuber-Paket', 'Mehrere Haar- und Kleidungsoptionen', 'Mehr Emotionen und Augenformen', 'Höherer Detailgrad'], action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' } },
				],
			},
			{
				type: 'services',
				eyebrow: 'Erreiche dein Next Level',
				title: 'kw.media hilft dir, deinen Kanal wachsen zu lassen',
				items: [
					{ title: 'Analyse und Beratung', text: 'Contentstrategie, Wachstumsideen, Kanalanalyse und mehr: Du musst nicht im Blindflug unterwegs sein.' },
					{ title: 'Technik-Support', text: 'YouTube, OBS oder Tracking machen Probleme? Wir helfen beim Lösen.' },
					{ title: 'Bessere Monetarisierung', text: 'Wir optimieren deinen Kanal und helfen dir, mehr aus Sponsorships herauszuholen.' },
				],
			},
			{ type: 'posts', title: 'YouTube Tipps & Tricks', categoryId: 17, limit: 3, moreHref: '/de/youtube-tipps/', moreLabel: 'Mehr Tipps' },
			{
				type: 'person',
				eyebrow: 'Dein persönlicher Kontakt',
				title: 'VTuber-Spezialist',
				name: 'Leo Wattenberg',
				role: 'Creative Director',
				image: assets.leo,
				imageAlt: 'Leo Wattenberg',
				credentials: ['YouTube Certified', 'VTuber Specialist', 'YouTube Product Expert'],
				body: ['Leo arbeitet in Multimedia-Produktion, Film, Webdesign und VR und beschäftigt sich seit Anfang 2020 intensiv mit VTubern.'],
				email: 'team@kw.media',
			},
			contactDe,
		],
	},
	{
		id: 'vtuber-en',
		path: '/en/vtuber/',
		locale: 'en',
		title: 'VTubers',
		description: 'VTuber model creation, rigging and creator support.',
		blocks: [
			{
				type: 'hero',
				title: 'Your next VTuber identity',
				text: 'Become a unique VTuber and get set up for success, with kw.media.',
				image: assets.vtuber,
				imageAlt: 'VTuber style character by kw.media',
				actions: [{ label: "Let's start", href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'faq',
				title: 'FAQ',
				items: [
					{ question: 'Are you an agency?', answer: ['We are not an agency like Hololive or Nijisanji. We believe broadcasting yourself freely is one of the best things about YouTube.'] },
					{ question: 'What software to use for VTubing?', answer: ['We recommend VSeeFace for virtual webcam use and VRChat for virtual-world content and interaction.'] },
					{ question: 'Can I upgrade an existing model?', answer: ['Definitely. Switching hair and clothing or adding eye shapes and facial expressions is something we can do.'] },
					{ question: 'Is it too late to become a VTuber?', answer: ['Definitely not. A good concept, expression and marketing can still put you ahead of many channels.'] },
				],
			},
			{
				type: 'pricing',
				title: 'Modelling services',
				note: 'Includes one free month of kw.media basic per order. Prices without VAT.',
				items: [
					{ name: 'VRChat model', summary: "A good lookin' virtual body for VRChat", price: '399.99 €', features: ['Base model, hair and clothing', 'Basic rigging', 'FBX', '3 emotions, 1 eye shape'], action: { label: 'Order now', href: 'mailto:team@kw.media' } },
					{ name: '3D VTuber Model', summary: 'A versatile pack for a wide range of uses', price: '600 €', highlight: 'Popular', features: ['Base model, hair and clothing', 'Advanced rigging', 'FBX, VRM', 'Visemes', 'ARKit', '5 emotions, 2 eye shapes'], action: { label: 'Order now', href: 'mailto:team@kw.media' } },
					{ name: 'Fully Featured VTuber Model', summary: 'Caught in 4K', price: '1200 €', features: ['Everything from the VTuber pack', 'Multiple hair and clothing options', 'More emotions and eye shapes', 'Increased detail'], action: { label: 'Order now', href: 'mailto:team@kw.media' } },
				],
			},
			{
				type: 'services',
				eyebrow: 'Reach your next level',
				title: 'kw.media helps you grow your channel',
				items: [
					{ title: 'Analysis and consulting', text: "Content strategy, growth tricks, channel analysis and more: you'll never fly blind." },
					{ title: 'Tech support', text: "Got stuck with YouTube, OBS or your tracking? We'll help fix things." },
					{ title: 'Better monetization', text: 'We optimize your channel and help you get the most out of sponsorships.' },
				],
			},
			{ type: 'posts', title: 'YouTube Tips & Tricks', categoryId: 18, limit: 3, moreHref: '/en/youtube-tips/', moreLabel: 'More tips' },
			{
				type: 'person',
				eyebrow: 'Your personal contact',
				title: 'VTuber specialist',
				name: 'Leo Wattenberg',
				role: 'Creative Director',
				image: assets.leo,
				imageAlt: 'Leo Wattenberg',
				credentials: ['YouTube Certified', 'VTuber Specialist', 'YouTube Product Expert'],
				body: ['Leo works across multimedia production, film making, web design and VR, and has researched VTubers in depth since early 2020.'],
				email: 'team@kw.media',
			},
			contactEn,
		],
	},
	{
		id: 'imprint-service-de',
		path: '/impressumsservice/',
		locale: 'de',
		title: 'Impressumsservice',
		description: 'Impressum ohne Privatadresse: sicher, legal und privat.',
		blocks: [
			{
				type: 'hero',
				title: 'Impressum ohne Privatadresse',
				text: 'Sicher, legal und privat: Impressumsservice für YouTuber, Creator und alle anderen, die in die Öffentlichkeit wollen.',
				image: assets.about,
				imageAlt: 'kw.media Büro',
				actions: [{ label: 'Jetzt anfragen', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'faq',
				title: 'Häufige Fragen',
				items: [
					{ question: 'Warum brauche ich ein Impressum?', answer: ['Für Creator existiert eine Informationspflicht für Name und ladungsfähige Adresse. Mit unserem Impressumsservice schützt du deine Privatsphäre und kommst deinen Pflichten nach.'] },
					{ question: 'Was ist die Rechtsgrundlage dieses Services?', answer: ['kw.media bekommt eine Generalvollmacht, um Briefe annehmen zu dürfen. Unser Büro ist eine ladungsfähige Adresse und fast ständig besetzt.'] },
					{ question: 'Ist Anbieterkennzeichnung ein Impressum?', answer: ['Anbieterkennzeichnung ist technisch gesehen der korrektere Begriff. In der Praxis verwenden die meisten das Wort Impressum.'] },
					{ question: 'Was passiert, wenn ich kein Impressum habe?', answer: ['Wer erwischt wird, riskiert hohe Strafen. Die Impressumspflicht gilt nicht für rein private Kanäle, aber bei Gewinnabsicht bist du sehr wahrscheinlich geschäftsmäßig unterwegs.'] },
				],
			},
			{
				type: 'pricing',
				title: 'Unsere Preise',
				note: 'Ein Monat kostenlos bei Buchung für ein ganzes Jahr. Preise inkl. MwSt.',
				items: [
					{ name: 'Impressumsservice Lite', summary: 'Nur das Nötigste', price: '12 €', period: 'monatlich', features: ['Rechtliche Sicherheit mit unserem Impressum', 'Scans von deiner Post', 'Keine Einrichtungsgebühr'], action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' } },
					{ name: 'Impressumsservice Standard', summary: 'Erweiterter Privatsphärenschutz', price: '20 €', period: 'monatlich', highlight: 'Beliebt', features: ['Rechtliche Sicherheit mit unserem Impressum', 'Scans von deiner Post', 'Physische Weiterleitung inklusive', 'Prüfung auf AirTags/GPS-Tracker', 'Keine Einrichtungsgebühr'], action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' } },
					{ name: 'Impressum + Beratung', summary: 'Das Rundum-sorglos-Paket', price: '60 €', period: 'monatlich', features: ['Alles aus Standard', 'Beratung für YouTuber', 'Backups von wichtigen Dateien', 'Keine Einrichtungsgebühr'], action: { label: 'Jetzt anfragen', href: 'mailto:team@kw.media' } },
				],
			},
			{
				type: 'cta',
				title: 'Anmeldung zum Impressumsservice',
				text: 'Schick uns eine Email mit den folgenden Infos:',
				email: 'team@kw.media',
				items: ['Dein voller Name und Adresse', 'Deine Präsenzen, auf denen du das Impressum verwenden möchtest', 'Welches Paket du abonnieren willst', 'Gegebenenfalls Sonderwünsche'],
			},
		],
	},
	{
		id: 'imprint-service-en',
		path: '/en/imprint-service/',
		locale: 'en',
		title: 'Imprint service',
		description: 'Use an imprint without exposing your private address.',
		blocks: [
			{
				type: 'hero',
				title: 'An imprint without your private address',
				text: 'Safe, legal and private: an imprint service for YouTubers, creators and anyone else publishing online.',
				image: assets.about,
				imageAlt: 'kw.media office',
				actions: [{ label: 'Contact us', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'faq',
				title: 'FAQ',
				items: [
					{ question: 'Why do I need an imprint?', answer: ['Creators in Germany and similar jurisdictions may need to provide a real name and serviceable address. Our imprint service helps protect your privacy while meeting those obligations.'] },
					{ question: 'What is the legal basis for this service?', answer: ['kw.media receives authorization to accept mail on your behalf. Our office is a serviceable address and is staffed regularly.'] },
					{ question: 'Is provider identification the same as an imprint?', answer: ['Provider identification is the more precise term. In practice, most people refer to it as an imprint.'] },
					{ question: 'What happens if I do not have an imprint?', answer: ['Missing required provider information can lead to penalties. The rules usually do not apply to purely private channels, but monetized or public-facing creator work is often treated differently.'] },
				],
			},
			{
				type: 'pricing',
				title: 'Pricing',
				note: 'One free month when booking for an entire year. Prices include VAT.',
				items: [
					{ name: 'Imprint service Lite', summary: 'Just the essentials', price: '12 €', period: 'per month', features: ['Legal coverage with our imprint', 'Scans of your mail', 'No setup fee'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
					{ name: 'Imprint service Standard', summary: 'Extended privacy protection', price: '20 €', period: 'per month', highlight: 'Popular', features: ['Legal coverage with our imprint', 'Scans of your mail', 'Physical forwarding included', 'AirTag/GPS tracker check', 'No setup fee'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
					{ name: 'Imprint + consulting', summary: 'The complete package', price: '60 €', period: 'per month', features: ['Everything from Standard', 'Consulting for YouTubers', 'Backups of important files', 'No setup fee'], action: { label: 'Contact us', href: 'mailto:team@kw.media' } },
				],
			},
			{
				type: 'cta',
				title: 'Sign up for the imprint service',
				text: 'Send us an email with the following information:',
				email: 'team@kw.media',
				items: ['Your full name and address', 'The channels or sites where you want to use the imprint', 'The package you want to subscribe to', 'Any special requests'],
			},
		],
	},
	{
		id: 'tips-de',
		path: '/de/youtube-tipps/',
		locale: 'de',
		title: 'YouTube Tipps & Tricks auf Deutsch',
		description: 'Deutschsprachige YouTube Tipps und Tutorials von kw.media.',
		blocks: [{ type: 'posts', title: 'YouTube Tipps & Tricks auf Deutsch', categoryId: 17 }],
	},
	{
		id: 'tips-en',
		path: '/en/youtube-tips/',
		locale: 'en',
		title: 'YouTube Tips & Tricks in English',
		description: 'English YouTube tips and tutorials by kw.media.',
		blocks: [{ type: 'posts', title: 'YouTube Tips & Tricks in English', categoryId: 18 }],
	},
	{
		id: 'legal',
		path: '/impressum/',
		locale: 'de',
		title: 'Impressum und Datenschutzerklärung',
		description: 'Impressum und Datenschutzerklärung der Koytek Wattenberg Media UG.',
		blocks: [{ type: 'rawPage', sourceId: 3 }],
	},
];

export function findSitePage(pathname: string): SitePage | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return sitePages.find((page) => page.path === normalizedPath);
}
