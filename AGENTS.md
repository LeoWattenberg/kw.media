# AGENTS.md

Guidance for coding agents working in this repository. These notes describe the current structure and conventions; prefer codifying the status quo over broad refactors.

## Project Overview

- This is an Astro site for kw.media.
- Use npm. The lockfile is `package-lock.json`.
- Main dynamic route handling is in `src/pages/[...slug].astro`.
- The homepage is handled separately by `src/pages/index.astro`.
- Static assets live in `public/`; generated build output is `dist/` and should not be edited.
- Browser/runtime helper logic for tools and games lives in `src/lib/`, especially `src/lib/tools/` and `src/lib/games/`.

## Commands

Run commands from the repository root.

- `npm install` installs dependencies.
- `npm run dev` starts Astro development server at `localhost:4321`.
- `npm run build` builds the production site to `dist/`.
- `npm run preview` previews the production build.
- `npm test` runs Node tests.
- `npm run test:browser` builds first, then runs Playwright browser tests.

### Local AI tools

An Ollama server should be present, see scripts/content.ai.mjs for details. You may request different models to be installed that best suit the purpose instead of using the ones currently referenced.

Content maintenance scripts are documented in `README.md`. Many post scripts write changes by default; use documented `--dry` options where available before making broad content changes.

## Routing And Registries

- `src/pages/[...slug].astro` collects site pages, posts, tools, and games into static paths.
- Site pages are registered through `src/data/pages.ts`, which eagerly imports `src/data/pages/*.astro`.
- Tools are registered through `src/data/tools.ts`, which eagerly imports `src/data/tools/**/*.astro`.
- Games are registered through `src/data/games.ts`, which eagerly imports `src/data/games/**/*.astro`.
- Posts come from `src/data/posts/**` through helpers in `src/lib/source-content.ts`.

## Component Map

Top-level page shells and renderers:

- `src/components/layout/BaseLayout.astro` is the common document/site layout for normal pages and posts.
- `src/components/layout/ToolsLayout.astro` wraps tool pages.
- `src/components/layout/GamesLayout.astro` wraps game pages.
- `src/components/SitePageShell.astro` wraps site pages.
- `src/components/ToolPageShell.astro` wraps individual tool implementations in `ToolsLayout`.
- `src/components/PageRenderer.astro` renders structured page blocks.
- `src/components/ArticlePage.astro` renders posts.
- `src/components/TagPage.astro` renders tag archive pages.
- `src/components/Hero.astro` is the reusable hero component.
- `src/components/YouTubeConsentEmbed.astro` handles consent-aware YouTube embeds.

Layout components:

- `src/components/layout/SiteHeader.astro`, `SiteFooter.astro`, and `SiteSidebar.astro` provide shared site chrome.
- `src/components/layout/CookieConsent.astro` handles cookie/consent UI.

Structured page block components:

- `src/components/blocks/` contains blocks rendered from JSON page data and `PageRenderer.astro`.
- Current block components include CTA, HTML content, credentials, FAQ, person spotlight, post lists, pricing, service grids, stats bands, testimonials, text panels, and YouTube playlists.

Tool components:

- Individual top-level tools live in `src/components/tools/*.astro`.
- Converter-specific tools live in `src/components/tools/converter/*.astro`.
- Shared tool UI primitives live in `src/components/tools/shared/*.astro`.
- Background-remover variants live in `src/components/tools/background-remover/*.astro`.
- Tool category/index UI lives in `src/components/tools/ToolsIndex.astro`, `ToolCategoryOverview.astro`, and `src/components/tools/converter/ConverterOverview.astro`.

Game components:

- Game UI lives in `src/components/games/`.
- `src/components/games/GamesIndex.astro` renders the games overview.
- `src/components/games/Mp3Guesser.astro` renders the MP3 guesser game.

## Data And Content Layout

Site pages:

- `src/data/pages/*.json` contains structured translated content for normal site pages.
- `src/data/pages/*.astro` imports the JSON and exports a `pageModule`; the default export is the component used to render that page.
- Page data types and block shapes are defined in `src/lib/page-types.ts`.
- `src/lib/site-page-module.ts` provides the page module helper.

Tools:

- `src/data/tools/**/*.astro` files define tool page metadata and export `toolModule`.
- Tool Astro data files also provide the default rendering component for those routes.
- Tool module helpers and types live in `src/lib/tool-page-module.ts`.
- Tool-specific browser/helper logic lives in `src/lib/tools/*.js`.
- Keep tool metadata, UI component, and helper tests in sync when adding or changing a tool.

Games:

- `src/data/games/*.astro` files define game page metadata and export `gameModule`.
- Game module helpers and types live in `src/lib/game-page-module.ts`.
- Game runtime helpers live in `src/lib/games/*.js`.
- Generated game assets currently live under `public/games/`.

Posts:

- Markdown posts live under `src/data/posts/`, grouped by content family and locale.
- Post parsing, related metadata, and content helpers live in `src/lib/source-content.ts`.
- Post import, cleanup, translation, tagging, CTA, link, and metadata scripts live in `scripts/`.

Internationalization:

- Locale config and UI strings live in `src/i18n/`.
- Locale-specific static routes live under `src/pages/de/` and `src/pages/en/` where needed.
- RSS routes are in `src/pages/de/rss.xml.ts` and `src/pages/en/rss.xml.ts`.

## Adding Or Changing A Tool

Follow the current pattern:

1. Add or update the route/data module in `src/data/tools/**`.
2. Add or update the rendering component in `src/components/tools/**`.
3. Put reusable tool UI in `src/components/tools/shared/` only when more than one tool needs it.
4. Put pure helper/runtime logic in `src/lib/tools/*.js`.
5. Add or update focused tests in `tests/tools.test.js`.
6. Use category subdirectories for category landing pages, such as `src/data/tools/converter/index.astro`.

## Testing Expectations

- Run `npm test` after changes to `src/lib/tools/`, `src/lib/games/`, or other pure helper logic.
- Run `npm run build` after route, Astro component, page data, i18n, or content structure changes.
- Run `npm run test:browser` when changing interactive tools, layouts, or browser-visible workflows.
- If a command cannot be run, say so clearly in the final response.

## Style And Change Discipline

- Match existing Astro component and JS style: tabs for indentation are common in source files.
- Prefer existing components, layouts, data-module helpers, and CSS patterns.
- Keep edits narrowly scoped. Do not reorganize directories unless the user asks for that specifically.
- Do not edit `dist/`, `node_modules/`, `test-results/`, or generated public game/audio assets unless the task explicitly concerns those artifacts.
- Avoid changing generated or imported content in bulk without using the documented scripts and reviewing the diff.
- Preserve user changes in the working tree; do not revert unrelated edits.
