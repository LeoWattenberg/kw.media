# Stream tools

Self-contained HTML apps for streamers (tier list, bingo, chat hotwords, spin wheel, tournament bracket, scene screens, death counter). Each one is a single file that runs entirely in the browser: embedded on its tool page, opened directly, downloaded for offline use, or added to OBS as a window capture or browser source. Twitch chat is read anonymously over the public IRC WebSocket; nothing is uploaded.

## Layout

- `kit/` – shared core for the newer tools: layout, stage scaling, DE/EN strings, Twitch chat, stream window sync, branding.
- `tools/<id>/` – the parts of one kit tool: `tool.json` (name, formats, chat, cams, exports), `config.js` (settings and strings), `logic.js`, `tool.css`, and the HTML snippets `left.html`, `side.html`, `help.html`, plus optional `dialogs.html`, `chat_extra.html`, `layout_extra.html`, `actions.html`.
- `standalone/` – the tier list and bingo, which predate the kit and are complete pages.
- `brand.json` – kw.media logos as data URIs; `%%LOGO_LIGHT%%`, `%%LOGO_DARK%%`, `%%ICON%%`, and `%%LOGO_AR%%` are filled in at build time.

## Building

```sh
npm run build:stream-tools
```

writes `public/stream-tools/<id>.html`. The generated files are committed so the site build does not depend on this step; `tests/stream-tools.test.js` fails when they are out of date.

## Embedding

The tool pages (`src/data/tools/<id>.astro` with `src/components/tools/StreamToolEmbed.astro`) load `/stream-tools/<id>.html?lang=de|en&embed=1`. `lang` fixes the language, `embed=1` hides the tool's own logo and language switch because the site provides both. Without parameters the files pick the language from the path, the saved setting, or the browser.

URL hashes used by the tools: `#stream` opens the stream view (also used by the stream window), and the scene screens accept `#stream-start`, `#stream-brb`, and `#stream-end` for fixed OBS sources.
