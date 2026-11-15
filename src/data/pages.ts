import type { SitePage } from '../lib/page-types';
import type { SitePageModule } from '../lib/site-page-module';

export type {
	Action,
	CredentialsBlock,
	CtaBlock,
	FaqBlock,
	HeroBlock,
	HtmlBlock,
	PageBlock,
	PersonBlock,
	PortfolioBlock,
	PostListBlock,
	PricingBlock,
	RequestFormBlock,
	RequestFormField,
	ServicesBlock,
	SitePage,
	StatsBlock,
	TestimonialsBlock,
	TextBlock,
	YouTubePlaylistBlock,
	YouTubeVideoBlock,
} from '../lib/page-types';

interface SitePageAstroModule {
	default: unknown;
	pageModule: SitePageModule;
}

const pageAstroModules = import.meta.glob<SitePageAstroModule>('./pages/*.astro', {
	eager: true,
});

const pageModules = Object.values(pageAstroModules);

export const sitePages: SitePage[] = pageModules.flatMap((module) => module.pageModule.pages);

export function findSitePage(pathname: string): SitePage | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return sitePages.find((page) => page.path === normalizedPath);
}

export function getSitePageComponent(page: SitePage): unknown {
	const module = pageModules.find((candidate) => candidate.pageModule.pages.some((candidatePage) => candidatePage.id === page.id));

	if (!module) {
		throw new Error(`Missing page component for ${page.id}`);
	}

	return module.default;
}

export function pageGroup(id: string) {
	return id.replace(/-(de|en)$/, '');
}

export function getSitePageAlternatePaths(page: SitePage): Partial<Record<string, string>> {
	const module = pageModules.find(candidate => candidate.pageModule.pages.some(candidatePage => candidatePage.id === page.id));
	const alternates = module?.pageModule.pages ?? [page];

	return Object.fromEntries(alternates.map((alternate) => [alternate.language ?? alternate.locale, alternate.path]));
}
