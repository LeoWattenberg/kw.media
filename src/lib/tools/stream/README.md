# Stream tools

Browser apps for streamers: tier list, bingo, chat hotwords, spin wheel, tournament bracket, scene screens, and death counter. Twitch chat is read anonymously over the public IRC WebSocket; nothing is uploaded.

## How the pages are built

`src/pages/stream-tools/[tool].astro` renders one standalone document per tool at `/stream-tools/<id>/`. The tool pages (`src/data/tools/<id>.astro` with `src/components/tools/stream/StreamToolEmbed.astro`) embed that document in an iframe, and the same URL is what the stream window, OBS browser sources, and the download link use. That is why these documents carry no site chrome and inline their CSS, JavaScript, and logos: a downloaded copy has to work offline as a single file.

- `src/components/tools/stream/StreamToolHtml.astro` – the document shell (head, inline style and script, `noindex`).
- `src/components/tools/stream/KitToolApp.astro` – the shared app frame of the kit tools (top bar, stage, side panel, dialogs); `ChatCard.astro` and `LayoutCard.astro` are the shared side-panel cards.
- `src/components/tools/stream/<Tool>.astro` – the markup of one tool.
- `src/lib/tools/stream/brand.ts` – the logos and favicon from `public/` as data URIs.

## Sources in this folder

- `kit/` – the shared runtime of the kit tools: layout, stage scaling, DE/EN strings, Twitch chat, stream window sync, branding.
- `<id>/config.js`, `logic.js`, `tool.css` – one kit tool. The scripts are not modules: `KitToolApp.astro` concatenates `config.js`, `kit/core.js`, and `logic.js` into one inline script after defining `KWM_BRAND`.
- `tier-list/` and `stream-bingo/` – the two older tools with their own complete runtime.

## Parameters

`?lang=de|en` fixes the language, and `?embed=1` hides the tool's own logo and language switch because the site provides both. Without parameters the apps pick the language from the saved setting or the browser.

`#stream` opens the stream view (also used by the stream window), and the scene screens accept `#stream-start`, `#stream-brb`, and `#stream-end` for fixed OBS sources.
