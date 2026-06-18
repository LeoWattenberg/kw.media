# Source Site Snapshot

Fetched from `https://kw.media` on 2026-06-18 for the Astro migration.

## Files

- `pages.json`: all WordPress pages exposed by the REST API.
- `posts.json`: all WordPress posts exposed by the REST API.
- `categories.json`: category metadata for blog/archive planning.
- `media.json`: media metadata and source URLs for later asset selection.

## Current Inventory

Pages:

- `/`
- `/en/`
- `/de/b2b/`
- `/de/creator/`
- `/de/live/`
- `/de/werbung/`
- `/en/b2b/`
- `/en/creator/`
- `/en/live/`
- `/en/ads/`
- `/en/vtuber/`
- `/blog/`
- `/impressumsservice/`
- `/impressum/`

Posts:

- 28 posts total.
- German archive: `/category/youtube-tipps-de/`
- English archive: `/category/youtube-tips-en/`

Notes:

- The migration should treat these snapshots as reference material, not as runtime content.
- Final Astro page content should live in `src/data/pages.ts` or a later content collection.
- Reused UI strings should live in `src/i18n/ui.ts`, separate from page body content.
