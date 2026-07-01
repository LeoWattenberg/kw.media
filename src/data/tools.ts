import type { Locale } from '../i18n';
import type { ToolPage, ToolPageModule } from '../lib/tool-page-module';

export type { ToolPage, ToolPageModule } from '../lib/tool-page-module';

interface ToolPageAstroModule {
	default: unknown;
	toolModule: ToolPageModule;
}

const toolAstroModules = import.meta.glob<ToolPageAstroModule>('./tools/*.astro', {
	eager: true,
});

const toolModules = Object.values(toolAstroModules);

export const toolPages: ToolPage[] = toolModules.flatMap((module) => module.toolModule.pages);

export function findToolPage(pathname: string): ToolPage | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return toolPages.find((page) => page.path === normalizedPath);
}

export function getToolPageComponent(page: ToolPage): unknown {
	const module = toolModules.find((candidate) => candidate.toolModule.pages.some((candidatePage) => candidatePage.id === page.id));

	if (!module) {
		throw new Error(`Missing tool component for ${page.id}`);
	}

	return module.default;
}

export function toolGroup(id: string) {
	return id.replace(/-(de|en)$/, '');
}

export function getToolPageAlternatePaths(page: ToolPage): Partial<Record<Locale, string>> {
	const group = toolGroup(page.id);
	const alternates = toolPages.filter((candidate) => toolGroup(candidate.id) === group);

	return Object.fromEntries(alternates.map((alternate) => [alternate.locale, alternate.path])) as Partial<Record<Locale, string>>;
}
