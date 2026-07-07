import type { Locale } from '../i18n';
import type { GamePage, GamePageModule } from '../lib/game-page-module';

export type { GamePage, GamePageModule } from '../lib/game-page-module';

interface GamePageAstroModule {
	default: unknown;
	gameModule: GamePageModule;
}

const gameAstroModules = import.meta.glob<GamePageAstroModule>('./games/**/*.astro', {
	eager: true,
});

const gameModules = Object.values(gameAstroModules);

export const gamePages: GamePage[] = gameModules.flatMap((module) => module.gameModule.pages);

export function findGamePage(pathname: string): GamePage | undefined {
	const normalizedPath = pathname.endsWith('/') ? pathname : `${pathname}/`;
	return gamePages.find((page) => page.path === normalizedPath);
}

export function getGamePageComponent(page: GamePage): unknown {
	const module = gameModules.find((candidate) => candidate.gameModule.pages.some((candidatePage) => candidatePage.id === page.id));

	if (!module) {
		throw new Error(`Missing game component for ${page.id}`);
	}

	return module.default;
}

export function gameGroup(id: string) {
	return id.replace(/-(de|en)$/, '');
}

export function getGamePageAlternatePaths(page: GamePage): Partial<Record<Locale, string>> {
	const group = gameGroup(page.id);
	const alternates = gamePages.filter((candidate) => gameGroup(candidate.id) === group);

	return Object.fromEntries(alternates.map((alternate) => [alternate.locale, alternate.path])) as Partial<Record<Locale, string>>;
}
