export type BlockKind =
	| 'hero'
	| 'trustLogos'
	| 'serviceGrid'
	| 'stats'
	| 'splitContent'
	| 'testimonials'
	| 'faq'
	| 'pricing'
	| 'postList'
	| 'contact'
	| 'cta'
	| 'legal';

export interface PlannedBlock {
	kind: BlockKind;
	name: string;
	note?: string;
}

export const blockLabels: Record<BlockKind, string> = {
	hero: 'Hero',
	trustLogos: 'Trust logos',
	serviceGrid: 'Service grid',
	stats: 'Stats',
	splitContent: 'Split content',
	testimonials: 'Testimonials',
	faq: 'FAQ',
	pricing: 'Pricing',
	postList: 'Post list',
	contact: 'Contact',
	cta: 'Call to action',
	legal: 'Legal text',
};
