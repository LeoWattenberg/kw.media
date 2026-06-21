import type { Locale } from '../i18n';

export interface AuthorProfile {
	id: 'leo-wattenberg' | 'martin-koytek';
	name: string;
	role: string;
	image: string;
	imageAlt: string;
	email: string;
	credentials: string[];
	paths: Record<Locale, string>;
	description: Record<Locale, string>;
	bio: Record<Locale, string[]>;
}

export const authorProfiles = [
	{
		id: 'leo-wattenberg',
		name: 'Leo Wattenberg',
		role: 'Creative Director',
		image: '/assets/Leo_mit_angel.png',
		imageAlt: 'Leo Wattenberg',
		email: 'team@kw.media',
		credentials: ['YouTube Certified', 'YouTube Product Expert', 'VTuber Specialist'],
		paths: {
			de: '/de/autor/leo-wattenberg/',
			en: '/en/author/leo-wattenberg/',
		},
		description: {
			de: 'Autor der kw.media Blogbeiträge zu YouTube, Creator-Strategie, VTubing und Plattformfragen.',
			en: 'Author of kw.media blog posts about YouTube, creator strategy, VTubing and platform questions.',
		},
		bio: {
			de: [
				'Leo Wattenberg schreibt die Blogbeiträge von kw.media. Seine Themen reichen von YouTube-Strategie und Urheberrecht bis zu VTubing, Plattformpolitik und Creator-Modellen.',
				'Er arbeitet in Multimedia-Produktion, Film, Webdesign und VR und verbindet technische YouTube-Erfahrung mit einem klaren Blick auf die Realität von Creatorn.',
			],
			en: [
				'Leo Wattenberg writes the blog posts for kw.media. His topics range from YouTube strategy and copyright to VTubing, platform policy and creator models.',
				'He works across multimedia production, film, web design and VR, combining practical YouTube experience with a clear view of creator realities.',
			],
		},
	},
	{
		id: 'martin-koytek',
		name: 'Martin Koytek',
		role: 'Managing Director',
		image: '/assets/martinkoytek.jpg',
		imageAlt: 'Martin Koytek',
		email: 'team@kw.media',
		credentials: ['YouTube Certified', 'Google Ads Partner', 'YouTube Product Expert'],
		paths: {
			de: '/de/autor/martin-koytek/',
			en: '/en/author/martin-koytek/',
		},
		description: {
			de: 'Produzent der kw.media YouTube-Tutorials und Ansprechpartner für YouTube-Beratung, Kurse und Creator-Support.',
			en: 'Producer of the kw.media YouTube tutorials and point of contact for YouTube consulting, courses and creator support.',
		},
		bio: {
			de: [
				'Martin Koytek produziert die Video-Tutorials von kw.media. Er erklärt YouTube-Funktionen, Creator-Workflows und Plattformänderungen kompakt und praxisnah.',
				'Als Geschäftsführer von kw.media berät er Creator, Unternehmen und Bildungseinrichtungen zu YouTube, Online-Marketing, Kursen und digitalen Plattformen.',
			],
			en: [
				'Martin Koytek produces the video tutorials for kw.media. He explains YouTube features, creator workflows and platform changes in a compact, practical way.',
				'As managing director of kw.media, he advises creators, companies and educational institutions on YouTube, online marketing, courses and digital platforms.',
			],
		},
	},
] satisfies AuthorProfile[];

export function getAuthorByName(name: string): AuthorProfile | undefined {
	return authorProfiles.find((author) => author.name === name);
}

export function getAuthorPath(name: string, locale: Locale): string | undefined {
	return getAuthorByName(name)?.paths[locale];
}
