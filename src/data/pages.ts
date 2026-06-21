import type { Locale } from '../i18n';
import { authorProfiles } from './authors';

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

const assets = {
	about: '/assets/about.jpg',
	home: '/assets/kwmedia couch.avif',
	creator: '/assets/creator-video-production.jpg',
	live: '/assets/live-camera-concert.jpg',
	ads: '/assets/smartphone-video.jpg',
	dubbing: '/assets/wp-content/uploads/2021/06/AM_STREAMMIC.jpg',
	brand: '/assets/camera-lens.jpg',
	vtuber: '/assets/g1-kwm.jpg',
	martin: '/assets/martinkoytek.jpg',
	leo: '/assets/Leo_mit_angel.png',
};

const leoAuthor = authorProfiles.find((author) => author.id === 'leo-wattenberg')!;
const martinAuthor = authorProfiles.find((author) => author.id === 'martin-koytek')!;

const legalHtml = `
	<h1>Impressum und Datenschutzerklärung</h1>

	<h2>Impressum</h2>
	<p>Angaben gemäß § 5 DDG:</p>
	<p>
		Koytek Wattenberg Media UG (haftungsbeschränkt)<br />
		Spiekerskamp 26<br />
		45772 Marl<br />
		Deutschland
	</p>
	<p>
		E-Mail: <a href="mailto:martin@kw.media">martin@kw.media</a><br />
		Website: <a href="https://kw.media">kw.media</a><br />
		USt-IdNr.: DE34 2553 512<br />
		Amtsgericht Gelsenkirchen, HRB 18975
	</p>
	<p>Inhaltlich verantwortlich gemäß § 18 Abs. 2 MStV: Martin Koytek, Anschrift wie oben.</p>

	<h2>Datenschutzerklärung</h2>
	<p>Wir freuen uns über Ihr Interesse an kw.media. Der Schutz personenbezogener Daten ist uns wichtig. Diese Datenschutzerklärung informiert darüber, welche Daten beim Besuch dieser Website und bei der Kontaktaufnahme verarbeitet werden.</p>

	<h3>Verantwortlicher</h3>
	<p>Verantwortlich für die Datenverarbeitung auf dieser Website ist die Koytek Wattenberg Media UG (haftungsbeschränkt), Spiekerskamp 26, 45772 Marl, Deutschland. Sie erreichen uns per E-Mail unter <a href="mailto:martin@kw.media">martin@kw.media</a>.</p>

	<h3>Server-Logfiles</h3>
	<p>Beim Aufruf dieser Website werden technisch notwendige Zugriffsdaten verarbeitet. Dazu können IP-Adresse, Datum und Uhrzeit des Zugriffs, angefragte URL, Referrer, Browsertyp, Betriebssystem und vergleichbare technische Informationen gehören. Diese Daten dienen der sicheren und stabilen Bereitstellung der Website und werden nicht zur persönlichen Profilbildung genutzt.</p>

	<h3>Kontakt per E-Mail</h3>
	<p>Wenn Sie uns per E-Mail kontaktieren, verarbeiten wir die von Ihnen übermittelten Daten, um Ihre Anfrage zu bearbeiten und mögliche Anschlussfragen zu beantworten. Die Daten werden gelöscht, sobald sie für die Bearbeitung nicht mehr erforderlich sind und keine gesetzlichen Aufbewahrungspflichten entgegenstehen.</p>

	<h3>Cookies und Einwilligung</h3>
	<p>Diese Website kann technisch notwendige Cookies verwenden. Für optionale Analysefunktionen wird eine Einwilligung über den Cookie-Hinweis eingeholt. Sie können eine erteilte Einwilligung jederzeit widerrufen, indem Sie die entsprechenden Cookies in Ihrem Browser löschen und die Website erneut aufrufen.</p>

	<h3>Google Analytics</h3>
	<p>Sofern Sie über den Cookie-Hinweis einwilligen und eine Google-Analytics-Mess-ID für diese Website konfiguriert ist, verwenden wir Google Analytics, einen Webanalysedienst von Google. Google Analytics hilft uns zu verstehen, wie Besucherinnen und Besucher unsere Website nutzen. Das Google-Analytics-Skript wird erst nach Ihrer Zustimmung geladen.</p>
	<p>Anbieter ist Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland. Im Rahmen der Nutzung können Daten an Google-Server übertragen werden. Wir verwenden Google Analytics mit IP-Anonymisierung, soweit dies technisch durch die eingesetzte Konfiguration unterstützt wird.</p>
	<p>Rechtsgrundlage ist Ihre Einwilligung. Sie können die Einwilligung für zukünftige Besuche widerrufen, indem Sie den Consent-Cookie in Ihrem Browser löschen.</p>

	<h3>YouTube-Einbettungen</h3>
	<p>Diese Website kann YouTube-Videos oder Playlists einbetten. Anbieter ist Google Ireland Limited. Wenn Sie eine Seite mit eingebettetem YouTube-Inhalt aufrufen, kann Ihr Browser Verbindungen zu YouTube beziehungsweise Google herstellen. Dabei können personenbezogene Daten, insbesondere technische Zugriffsdaten, verarbeitet werden.</p>

	<h3>Ihre Rechte</h3>
	<p>Sie haben im Rahmen der gesetzlichen Voraussetzungen das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit sowie Widerspruch gegen bestimmte Verarbeitungen. Soweit eine Verarbeitung auf Ihrer Einwilligung beruht, können Sie diese Einwilligung jederzeit mit Wirkung für die Zukunft widerrufen.</p>

	<h3>Beschwerderecht</h3>
	<p>Sie haben das Recht, sich bei einer zuständigen Datenschutzaufsichtsbehörde zu beschweren, wenn Sie der Ansicht sind, dass die Verarbeitung Ihrer personenbezogenen Daten gegen Datenschutzrecht verstößt.</p>

	<h3>Speicherdauer</h3>
	<p>Personenbezogene Daten werden nur so lange gespeichert, wie dies für den jeweiligen Zweck erforderlich ist oder gesetzliche Aufbewahrungspflichten bestehen.</p>

	<h3>Änderungen dieser Datenschutzerklärung</h3>
	<p>Wir passen diese Datenschutzerklärung an, wenn sich die Website, eingesetzte Dienste oder rechtliche Anforderungen ändern.</p>
`;

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
	credentials: ['YouTube Certified', 'Google Ads Partner', 'YouTube-Produktexperte'],
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

const schoolCourseItemsDe: ServicesBlock['items'] = [
	{
		title: 'Fakt oder Fake? - Wahrheit im digitalen Zeitalter',
		text: 'Workshop für Schüler*innen ab Klasse 9. In 4-6 UE lernen Gruppen, Fake News, Deepfakes und Desinformation zu erkennen und Quellen praktisch zu prüfen.',
	},
	{
		title: 'KI verstehen - ganz ohne Informatik-Studium',
		text: 'Vortrag oder Workshop ab 6 UE. Verständlicher Einstieg in ChatGPT, Bild-KI, Chancen, Grenzen, Halluzinationen und verantwortungsvolle Nutzung.',
	},
	{
		title: 'Grill dich schlau: Der Creator-Snack',
		text: 'Kompakter Impuls-Workshop für Jugendliche von 13-18 Jahren. In 2-3 UE geht es um Thumbnails, Hooks und den ersten Eindruck von Videos.',
	},
	{
		title: 'Traumberuf YouTuber? - Blick hinter die Kulissen',
		text: 'Vortrag für Jugendliche von 13-18 Jahren. In 4-6 UE sprechen wir über Technik, Algorithmus, Aufwand, Geld, Pflichten und Realitäten des Creator-Alltags.',
	},
	{
		title: 'Traumberuf YouTuber? - Das Praxis-Camp',
		text: 'Tageskurs mit 10 UE. Schüler*innen planen, drehen und schneiden ein eigenes vertikales Kurzvideo direkt mit dem Smartphone.',
	},
	{
		title: 'Creator Camp: Dein Start auf YouTube & Co.',
		text: 'Ferienkurs oder Projektwoche über 3-5 Tage. Von Idee, Storyboard, Dreh und Ton bis Schnitt, Export, Medienrecht und Abschlusspräsentation.',
	},
	{
		title: 'Storytelling für Creator',
		text: 'Online-Workshop mit 4-6 UE. Dramaturgie, Zuschauerbindung und Skriptstruktur für Videos, Präsentationen und Social-Media-Formate.',
	},
	{
		title: 'Content Creation - The Professional Way',
		text: 'Praxis-Workshop mit 4-6 UE zu Kamera, Belichtung, Lichtsetzung und Ton. Ideal für Medien-AGs, Projektkurse und Berufskollegs.',
	},
	{
		title: 'Hollywood für zu Hause',
		text: 'EDV-Workshop mit 6-8 UE. Kostenlos nutzbare Profi-Tools wie OBS Studio, GIMP und DaVinci Resolve im kompletten Produktionsworkflow.',
	},
	{
		title: 'KI-Power für den Job',
		text: 'Kompaktseminar mit 6-8 UE für Berufskollegs, Lehrkräfte oder Oberstufe. ChatGPT, Copilot und Gemini für Text, Recherche und Organisation.',
	},
	{
		title: 'Was treiben meine Enkel im Internet?',
		text: 'Eltern- oder Großelternabend mit 6 UE. Ein verständlicher Blick auf Online-Games, Influencer, Kostenfallen, Cybermobbing und Generationendialog.',
	},
];

const schoolCourseItemsEn: ServicesBlock['items'] = [
	{
		title: 'Fact or Fake? Truth in the Digital Age',
		text: 'Workshop for students from grade 9. In 4-6 teaching units, groups learn how misinformation, deepfakes and source verification work.',
	},
	{
		title: 'Understanding AI without a Computer Science Degree',
		text: 'Lecture or workshop from 6 teaching units. A clear introduction to ChatGPT, image AI, opportunities, limits, hallucinations and responsible use.',
	},
	{
		title: 'Creator Snack: Hooks, Thumbnails and Attention',
		text: 'Compact impulse workshop for ages 13-18. In 2-3 teaching units, students learn why videos get clicked or skipped.',
	},
	{
		title: 'Dream Job YouTuber? Behind the Scenes',
		text: 'Lecture for ages 13-18. In 4-6 teaching units, Martin explains technology, algorithms, effort, money, obligations and creator reality.',
	},
	{
		title: 'Mobile Creator Practice Camp',
		text: 'One-day course with 10 teaching units. Students plan, shoot and edit their own vertical short video with a smartphone.',
	},
	{
		title: 'Creator Camp: Start on YouTube & Co.',
		text: 'Holiday course or project week over 3-5 days. From idea, storyboard, camera and sound to editing, export, media law and final screening.',
	},
	{
		title: 'Storytelling for Creators',
		text: 'Online workshop with 4-6 teaching units. Dramaturgy, audience retention and script structure for video, presentation and social formats.',
	},
	{
		title: 'Content Creation - The Professional Way',
		text: 'Hands-on workshop with 4-6 teaching units covering cameras, exposure, lighting and audio for media classes and project groups.',
	},
	{
		title: 'Hollywood at Home',
		text: 'Computer lab workshop with 6-8 teaching units. Free professional tools such as OBS Studio, GIMP and DaVinci Resolve in one workflow.',
	},
	{
		title: 'AI Power for Work',
		text: 'Compact seminar with 6-8 teaching units for vocational schools, teachers or older students using ChatGPT, Copilot and Gemini productively.',
	},
	{
		title: 'What Are My Grandchildren Doing Online?',
		text: 'Parent or grandparent evening with 6 teaching units about online games, influencers, cost traps, cyberbullying and intergenerational dialogue.',
	},
];

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
					{ title: 'Video-Synchronisation', text: 'Mehrsprachige Fassungen für Videos, Kurse und Social Content.', href: '/de/video-synchronisation/' },
				],
			},
			{
				type: 'youtubePlaylist',
				title: 'Creator News',
				eyebrow: 'Wöchentliche YouTube-Updates für Creator.',
				playlistId: 'PLpM9DoCHlaQGBxm1J6FUwkB0N3ITDIzey',
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
					{ title: 'Video dubbing', text: 'Multilingual versions for videos, courses and social content.', href: '/en/video-dubbing/' },
				],
			},
			{
				type: 'youtubePlaylist',
				title: 'Creator News',
				eyebrow: 'Weekly YouTube updates for creators.',
				playlistId: 'PLpM9DoCHlaQGBxm1J6FUwkB0N3ITDIzey',
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
		id: 'courses-de',
		path: '/de/kurse/',
		locale: 'de',
		title: 'Vorträge und Kurse für Schulen',
		description: 'Medienkompetenz, KI, Fake News und Content Creation als Vorträge, Workshops und Projektkurse für Schulen.',
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Medienkompetenz, KI und Content Creation',
				title: 'Vorträge und Kurse für Schulen',
				text: 'Wir unterrichten online oder vor Ort: praxisnah, verständlich und passend für Schüler*innen, Lehrkräfte, Elternabende und Projektwochen.',
				image: assets.creator,
				imageAlt: 'Creator bei der Videoproduktion',
				actions: [{ label: 'Kurs anfragen', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'text',
				eyebrow: 'Buchbar für Schulen und Bildungsträger',
				title: 'Unterricht, der digitale Lebenswelten ernst nimmt',
				body: [
					'Unsere Kurse verbinden Medienkompetenz mit echter Plattformpraxis: YouTube, KI, Fake News, Social Media, Video-Produktion und digitale Berufskompetenzen.',
					'Eine UE ist eine Übungseinheit von 45 Minuten. Viele Formate lassen sich als Einzelvortrag, Workshop, Projekttag, Online-Einheit oder Ferienkurs anpassen.',
				],
				checks: [
					'Online oder offline buchbar',
					'Für Klassen, Kurse, Medien-AGs, Projektwochen und Elternabende',
					'Praxisnah mit Live-Demos, Übungen und echten Beispielen',
					'Dozent: Martin Koytek',
				],
				image: assets.martin,
				imageAlt: 'Martin Koytek',
			},
			{
				type: 'services',
				eyebrow: 'Kurskatalog',
				title: 'Beispiele aus unserem Programm',
				intro: 'Die Formate werden an Alter, Vorwissen, technische Ausstattung und Zeitrahmen Ihrer Schule angepasst.',
				items: schoolCourseItemsDe,
			},
			{
				type: 'pricing',
				eyebrow: 'Buchungsformate',
				title: 'Vom Impuls bis zur Projektwoche',
				note: 'Preise und konkrete Abläufe stimmen wir nach Format, Gruppengröße, Ort, Technikbedarf und Vorbereitungsaufwand ab.',
				items: [
					{
						name: 'Impuls oder Vortrag',
						summary: 'Für Einstieg, Elternabend oder Pädagogischen Tag',
						price: 'Auf Anfrage',
						period: '2-6 UE',
						features: ['Klare Einführung ins Thema', 'Live-Demos und Q&A', 'Online oder vor Ort'],
						action: { label: 'Anfragen', href: 'mailto:team@kw.media' },
					},
					{
						name: 'Workshop oder Projekttag',
						summary: 'Für Klassen, Kurse und Medien-AGs',
						price: 'Auf Anfrage',
						period: '4-10 UE',
						highlight: 'Beliebt',
						features: ['Interaktive Übungen', 'Material- und Technikabstimmung', 'Praxisnahes Arbeiten in Gruppen'],
						action: { label: 'Anfragen', href: 'mailto:team@kw.media' },
					},
					{
						name: 'Projektwoche oder Ferienkurs',
						summary: 'Für intensive Medienprojekte',
						price: 'Auf Anfrage',
						period: '3-5 Tage',
						features: ['Konzept, Produktion und Abschlusspräsentation', 'Begleitete Kreativarbeit', 'Individuell planbarer Ablauf'],
						action: { label: 'Anfragen', href: 'mailto:team@kw.media' },
					},
				],
			},
			{
				type: 'faq',
				title: 'Häufige Fragen',
				items: [
					{ question: 'Für welche Klassenstufen sind die Kurse geeignet?', answer: ['Viele Formate sind für Jugendliche ab 13 Jahren oder ab Klasse 9 konzipiert. Für Oberstufe, Berufskollegs, Lehrkräfte und Elternabende passen wir Inhalte und Sprache entsprechend an.'] },
					{ question: 'Kann der Kurs online stattfinden?', answer: ['Ja. Viele Themen funktionieren als Online-Workshop oder Webinar. Praxisformate mit Dreh, Schnitt oder Technik profitieren oft von einem Termin vor Ort.'] },
					{ question: 'Was muss die Schule vorbereiten?', answer: ['Das hängt vom Format ab. Für Vorträge reichen meist Beamer, Ton und Internet. Für Praxisformate stimmen wir Geräte, Software, Räume und Gruppengrößen vorab ab.'] },
					{ question: 'Wer unterrichtet die Kurse?', answer: ['Dozent ist Martin Koytek. Er verbindet langjährige YouTube-, Medien- und Online-Marketing-Erfahrung mit verständlicher Vermittlung für unterschiedliche Zielgruppen.'] },
				],
			},
			{
				type: 'person',
				eyebrow: 'Dozent',
				title: 'Unterricht mit Plattformpraxis',
				name: 'Martin Koytek',
				role: 'Dozent für Medienkompetenz, KI und Content Creation',
				image: assets.martin,
				imageAlt: 'Martin Koytek',
				credentials: ['YouTube Certified', 'Google Ads Partner', 'YouTube-Produktexperte'],
				body: ['Martin Koytek erklärt digitale Plattformen, KI und Content Creation aus der Praxis heraus: verständlich, ehrlich und mit Blick auf das, was Schüler*innen wirklich online erleben.'],
				email: 'team@kw.media',
			},
			{
				type: 'cta',
				title: 'Kurs anfragen',
				text: 'Schicken Sie uns kurz Thema, Zielgruppe, gewünschtes Format, Ort und möglichen Zeitraum. Wir melden uns mit einem passenden Vorschlag.',
				email: 'team@kw.media',
				items: ['Schule oder Bildungsträger', 'Klassenstufe und Gruppengröße', 'Online oder vor Ort', 'Gewünschter Umfang in UE oder Tagen'],
			},
		],
	},
	{
		id: 'courses-en',
		path: '/en/lectures-courses/',
		locale: 'en',
		title: 'Lectures and Courses for Schools',
		description: 'Media literacy, AI, fake news and content creation as lectures, workshops and project courses for schools.',
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Media literacy, AI and content creation',
				title: 'Lectures and courses for schools',
				text: 'We teach online or on site: practical, understandable and tailored to students, teachers, parent evenings and project weeks.',
				image: assets.creator,
				imageAlt: 'Creators recording a video',
				actions: [{ label: 'Request a course', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			{
				type: 'text',
				eyebrow: 'For schools and education providers',
				title: 'Teaching digital life as it actually happens',
				body: [
					'Our courses connect media literacy with real platform experience: YouTube, AI, misinformation, social media, video production and digital work skills.',
					'One teaching unit is 45 minutes. Most formats can be adapted as a lecture, workshop, project day, online session or holiday course.',
				],
				checks: [
					'Available online or on site',
					'For classes, media clubs, project weeks and parent evenings',
					'Practical teaching with live demos, exercises and real examples',
					'Teacher: Martin Koytek',
				],
				image: assets.martin,
				imageAlt: 'Martin Koytek',
			},
			{
				type: 'services',
				eyebrow: 'Course catalogue',
				title: 'Examples from the programme',
				intro: 'Formats are adapted to age, prior knowledge, technical setup and the school schedule.',
				items: schoolCourseItemsEn,
			},
			{
				type: 'pricing',
				eyebrow: 'Booking formats',
				title: 'From short impulse to project week',
				note: 'Pricing and structure depend on format, group size, location, technical setup and preparation needs.',
				items: [
					{
						name: 'Impulse or lecture',
						summary: 'For introductions, parent evenings or teacher training days',
						price: 'On request',
						period: '2-6 units',
						features: ['Clear topic introduction', 'Live demos and Q&A', 'Online or on site'],
						action: { label: 'Request', href: 'mailto:team@kw.media' },
					},
					{
						name: 'Workshop or project day',
						summary: 'For classes, courses and media clubs',
						price: 'On request',
						period: '4-10 units',
						highlight: 'Popular',
						features: ['Interactive exercises', 'Material and tech planning', 'Practical group work'],
						action: { label: 'Request', href: 'mailto:team@kw.media' },
					},
					{
						name: 'Project week or holiday course',
						summary: 'For intensive media projects',
						price: 'On request',
						period: '3-5 days',
						features: ['Concept, production and final screening', 'Guided creative work', 'Individually planned schedule'],
						action: { label: 'Request', href: 'mailto:team@kw.media' },
					},
				],
			},
			{
				type: 'faq',
				title: 'FAQ',
				items: [
					{ question: 'Which age groups are the courses for?', answer: ['Many formats are designed for students from age 13 or grade 9. We adapt the content and language for older students, vocational schools, teachers and parent evenings.'] },
					{ question: 'Can the course happen online?', answer: ['Yes. Many topics work well as an online workshop or webinar. Practical formats with filming, editing or hardware usually benefit from an on-site session.'] },
					{ question: 'What does the school need to prepare?', answer: ['It depends on the format. Lectures usually need a projector, audio and internet. For practical courses, we agree devices, software, rooms and group sizes in advance.'] },
					{ question: 'Who teaches the courses?', answer: ['The teacher is Martin Koytek. He combines many years of YouTube, media and online marketing experience with clear explanations for different audiences.'] },
				],
			},
			{
				type: 'person',
				eyebrow: 'Teacher',
				title: 'Platform practice in the classroom',
				name: 'Martin Koytek',
				role: 'Teacher for media literacy, AI and content creation',
				image: assets.martin,
				imageAlt: 'Martin Koytek',
				credentials: ['YouTube Certified', 'Google Ads Partner', 'YouTube Product Expert'],
				body: ['Martin Koytek explains digital platforms, AI and content creation from real practice: clearly, honestly and with attention to what students actually experience online.'],
				email: 'team@kw.media',
			},
			{
				type: 'cta',
				title: 'Request a course',
				text: 'Send us the topic, audience, preferred format, location and possible time frame. We will reply with a fitting proposal.',
				email: 'team@kw.media',
				items: ['School or education provider', 'Grade level and group size', 'Online or on site', 'Preferred length in teaching units or days'],
			},
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
		id: 'dubbing-de',
		path: '/de/video-synchronisation/',
		locale: 'de',
		title: 'Video-Synchronisation und Dubbing',
		description: 'Video-Synchronisation, Voiceover und Untertitel für YouTube, Kurse, Social Media und Unternehmensvideos.',
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Mehrsprachige Videofassungen',
				title: 'Video-Dubbing für Content, Kurse und Marken',
				text: 'Wir machen Ihre Videos für neue Märkte verständlich: mit Übersetzung, Voiceover, Untertiteln und sauberer Tonmischung.',
				image: assets.dubbing,
				imageAlt: 'Mikrofon für professionelle Sprachaufnahmen',
				actions: [{ label: 'Projekt anfragen', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			credentialsDe,
			{
				type: 'services',
				eyebrow: 'Von der Übersetzung bis zum fertigen Export',
				title: 'Dubbing, das zum Video passt',
				intro: 'Ob YouTube-Serie, Onlinekurs, Erklärvideo oder Kampagne: Wir erstellen lokalisierte Fassungen, die inhaltlich stimmen und technisch sauber funktionieren.',
				items: [
					{ title: 'Übersetzung und Adaption', text: 'Wir übertragen Skripte, Timings und Formulierungen so, dass die neue Sprachfassung natürlich wirkt.' },
					{ title: 'Voiceover und Sprecherkoordination', text: 'Auf Wunsch koordinieren wir passende Stimmen und produzieren verständliche, konsistente Sprachaufnahmen.' },
					{ title: 'Untertitel und Captions', text: 'Wir erstellen Untertitel, SRT-Dateien und plattformgerechte Captions für YouTube, Kurse und Social Media.' },
					{ title: 'Audio-Postproduktion', text: 'Lautstärke, Rauschminderung, Musikbett und Mischung werden auf Webvideo und Plattformstandards abgestimmt.' },
					{ title: 'Video-Export und Upload-Vorbereitung', text: 'Wir liefern fertige Sprachversionen, separate Tonspuren oder Upload-Dateien für Ihre bestehende Distribution.' },
					{ title: 'Beratung für internationale Kanäle', text: 'Wir helfen bei Sprachstrategie, Kanalstruktur, Metadaten und Workflows für mehrsprachige Inhalte.' },
				],
			},
			{
				type: 'text',
				eyebrow: 'Für Webvideo gedacht',
				title: 'Lokalisierung ohne unnötige Reibung',
				body: [
					'Gutes Dubbing ist mehr als eine übersetzte Tonspur. Timing, Zielgruppe, Plattform und Tonmischung müssen zusammenpassen, damit die neue Fassung nicht wie ein Fremdkörper wirkt.',
					'Wir kommen aus der Webvideo-Praxis und denken deshalb immer auch an YouTube-SEO, Zuschauerbindung, Kapitel, Untertitel, Shorts-Ableger und wiederholbare Produktionsprozesse.',
				],
				checks: [
					'Deutsch- und englischsprachige Videofassungen',
					'Voiceover, Untertitel oder kombinierte Workflows',
					'Lieferung als fertiges Video, Tonspur oder SRT-Datei',
					'Praktische Beratung für YouTube und Kursplattformen',
				],
				image: assets.about,
				imageAlt: 'Arbeitsplatz für Videoproduktion bei kw.media',
			},
			{
				type: 'pricing',
				title: 'Video-Dubbing Preise',
				note: 'Preise zzgl. MwSt. Der Aufwand hängt von Videolänge, Sprache, Skriptlage und gewünschter Sprecherbesetzung ab.',
				items: [
					{ name: 'Untertitel', summary: 'Transkription, Übersetzung und SRT', price: 'Individuell', features: ['Timed captions', 'YouTube-geeignete Dateien'], action: { label: 'Anfragen', href: 'mailto:team@kw.media' } },
					{ name: 'Voiceover', summary: 'Sprachfassung mit Mischung', price: 'Individuell', highlight: 'Beliebt', features: ['Skriptadaption', 'Aufnahmekoordination', 'Audio-Mix'], action: { label: 'Anfragen', href: 'mailto:team@kw.media' } },
					{ name: 'Kanal-Lokalisierung', summary: 'Workflow für Serien und Kurse', price: 'Individuell', features: ['Mehrere Videos', 'Metadaten-Beratung', 'Wiederholbarer Prozess'], action: { label: 'Anfragen', href: 'mailto:team@kw.media' } },
				],
			},
			martinDe,
			contactDe,
		],
	},
	{
		id: 'dubbing-en',
		path: '/en/video-dubbing/',
		locale: 'en',
		title: 'Video Dubbing Services',
		description: 'Video dubbing, voiceover and subtitles for YouTube, courses, social media and brand videos.',
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Multilingual video versions',
				title: 'Video dubbing for content, courses and brands',
				text: 'We prepare your videos for new audiences with translation, voiceover, subtitles and clean audio post-production.',
				image: assets.dubbing,
				imageAlt: 'Microphone for professional voice recording',
				actions: [{ label: 'Request a project', href: 'mailto:team@kw.media', variant: 'primary' }],
			},
			credentialsEn,
			{
				type: 'services',
				eyebrow: 'From translation to final export',
				title: 'Dubbing that fits the video',
				intro: 'For YouTube series, online courses, explainers and campaigns, we create localized versions that sound natural and work technically.',
				items: [
					{ title: 'Translation and adaptation', text: 'We adapt scripts, timing and wording so the new language version feels natural.' },
					{ title: 'Voiceover coordination', text: 'When needed, we coordinate fitting voices and produce clear, consistent recordings.' },
					{ title: 'Subtitles and captions', text: 'We create subtitles, SRT files and platform-ready captions for YouTube, courses and social media.' },
					{ title: 'Audio post-production', text: 'Loudness, noise reduction, music beds and mix are prepared for web video and platform standards.' },
					{ title: 'Export and upload preparation', text: 'We deliver finished language versions, separate audio tracks or upload-ready files for your workflow.' },
					{ title: 'International channel consulting', text: 'We help with language strategy, channel structure, metadata and repeatable multilingual workflows.' },
				],
			},
			{
				type: 'text',
				eyebrow: 'Built for web video',
				title: 'Localization without extra friction',
				body: [
					'Good dubbing is more than a translated audio track. Timing, audience, platform and mix need to work together so the localized version feels intentional.',
					'Our background is web video, so we also think about YouTube SEO, retention, chapters, subtitles, Shorts derivatives and repeatable production workflows.',
				],
				checks: [
					'German and English video versions',
					'Voiceover, subtitles or combined workflows',
					'Delivery as final video, audio track or SRT file',
					'Practical consulting for YouTube and course platforms',
				],
				image: assets.about,
				imageAlt: 'kw.media video production workspace',
			},
			{
				type: 'pricing',
				title: 'Video dubbing pricing',
				note: 'Prices excluding VAT. Scope depends on video length, target language, script state and voice requirements.',
				items: [
					{ name: 'Subtitles', summary: 'Transcription, translation and SRT', price: 'Individual', features: ['Timed captions', 'YouTube-ready files'], action: { label: 'Request quote', href: 'mailto:team@kw.media' } },
					{ name: 'Voiceover', summary: 'Spoken version with mix', price: 'Individual', highlight: 'Popular', features: ['Script adaptation', 'Recording coordination', 'Audio mix'], action: { label: 'Request quote', href: 'mailto:team@kw.media' } },
					{ name: 'Channel localization', summary: 'Workflow for series and courses', price: 'Individual', features: ['Multiple videos', 'Metadata consulting', 'Repeatable process'], action: { label: 'Request quote', href: 'mailto:team@kw.media' } },
				],
			},
			martinEn,
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
		id: 'author-leo-de',
		path: leoAuthor.paths.de,
		locale: 'de',
		title: leoAuthor.name,
		description: leoAuthor.description.de,
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Autor',
				title: leoAuthor.name,
				text: leoAuthor.description.de,
				image: leoAuthor.image,
				imageAlt: leoAuthor.imageAlt,
				actions: [{ label: 'Kontakt aufnehmen', href: `mailto:${leoAuthor.email}`, variant: 'primary' }],
			},
			{
				type: 'person',
				title: 'Über Leo',
				name: leoAuthor.name,
				role: leoAuthor.role,
				image: leoAuthor.image,
				imageAlt: leoAuthor.imageAlt,
				credentials: leoAuthor.credentials,
				body: leoAuthor.bio.de,
				email: leoAuthor.email,
			},
			{ type: 'posts', title: 'Blogbeiträge von Leo Wattenberg', authorName: leoAuthor.name },
		],
	},
	{
		id: 'author-leo-en',
		path: leoAuthor.paths.en,
		locale: 'en',
		title: leoAuthor.name,
		description: leoAuthor.description.en,
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Author',
				title: leoAuthor.name,
				text: leoAuthor.description.en,
				image: leoAuthor.image,
				imageAlt: leoAuthor.imageAlt,
				actions: [{ label: 'Get in touch', href: `mailto:${leoAuthor.email}`, variant: 'primary' }],
			},
			{
				type: 'person',
				title: 'About Leo',
				name: leoAuthor.name,
				role: leoAuthor.role,
				image: leoAuthor.image,
				imageAlt: leoAuthor.imageAlt,
				credentials: leoAuthor.credentials,
				body: leoAuthor.bio.en,
				email: leoAuthor.email,
			},
			{ type: 'posts', title: 'Blog posts by Leo Wattenberg', authorName: leoAuthor.name },
		],
	},
	{
		id: 'author-martin-de',
		path: martinAuthor.paths.de,
		locale: 'de',
		title: martinAuthor.name,
		description: martinAuthor.description.de,
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Autor',
				title: martinAuthor.name,
				text: martinAuthor.description.de,
				image: martinAuthor.image,
				imageAlt: martinAuthor.imageAlt,
				actions: [{ label: 'Kontakt aufnehmen', href: `mailto:${martinAuthor.email}`, variant: 'primary' }],
			},
			{
				type: 'person',
				title: 'Über Martin',
				name: martinAuthor.name,
				role: martinAuthor.role,
				image: martinAuthor.image,
				imageAlt: martinAuthor.imageAlt,
				credentials: martinAuthor.credentials,
				body: martinAuthor.bio.de,
				email: martinAuthor.email,
			},
			{ type: 'posts', title: 'Videos von Martin Koytek', authorName: martinAuthor.name },
		],
	},
	{
		id: 'author-martin-en',
		path: martinAuthor.paths.en,
		locale: 'en',
		title: martinAuthor.name,
		description: martinAuthor.description.en,
		blocks: [
			{
				type: 'hero',
				eyebrow: 'Author',
				title: martinAuthor.name,
				text: martinAuthor.description.en,
				image: martinAuthor.image,
				imageAlt: martinAuthor.imageAlt,
				actions: [{ label: 'Get in touch', href: `mailto:${martinAuthor.email}`, variant: 'primary' }],
			},
			{
				type: 'person',
				title: 'About Martin',
				name: martinAuthor.name,
				role: martinAuthor.role,
				image: martinAuthor.image,
				imageAlt: martinAuthor.imageAlt,
				credentials: martinAuthor.credentials,
				body: martinAuthor.bio.en,
				email: martinAuthor.email,
			},
			{ type: 'posts', title: 'Videos by Martin Koytek', authorName: martinAuthor.name },
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
		blocks: [{ type: 'html', html: legalHtml }],
	},
];

export function findSitePage(pathname: string): SitePage | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return sitePages.find((page) => page.path === normalizedPath);
}

function pageGroup(id: string) {
	return id.replace(/-(de|en)$/, '');
}

export function getSitePageAlternatePaths(page: SitePage): Partial<Record<Locale, string>> {
	const group = pageGroup(page.id);
	const alternates = sitePages.filter((candidate) => pageGroup(candidate.id) === group);

	return Object.fromEntries(alternates.map((alternate) => [alternate.locale, alternate.path])) as Partial<Record<Locale, string>>;
}

export function getSitePageFaqItems(page: SitePage): FaqBlock['items'] {
	return page.blocks.flatMap((block) => (block.type === 'faq' ? block.items : []));
}
