# kw.media

Astro site for kw.media pages and post content.

## Commands

Run commands from the project root:

| Command | Action |
| :-- | :-- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the local dev server at `localhost:4321` |
| `npm run build` | Build the production site to `./dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run import:youtube` | Import new YouTube posts, clean transcripts, create translations, refresh related posts, and add inline links |
| `IMPORT_AI=0 npm run import:youtube` | Import new YouTube posts without Ollama cleanup, translation, related posts, or inline links |
| `npm run import:missing-sources -- --dry` | Preview source-link imports for current video posts that do not have `sources` frontmatter |
| `npm run cleanup:post -- src/data/posts/.../post.md` | Clean one or more existing posts |
| `npm run cleanup:last-commit` | Clean markdown posts touched by the latest commit |
| `npm run audit:posts` | Audit post metadata, language, links, and generated related-post data |
| `npm run audit:posts -- --ai` | Add local Ollama metadata suggestions for flagged posts |
| `npm run fix:posts -- --common --dry` | Preview common fixes for flagged posts |
| `npm run fix:posts -- --common` | Apply deterministic fixes, excerpt regeneration, and wrong-language retranslation |
| `npm run fix:posts -- --all-fixes` | Also apply local-AI title/excerpt metadata suggestions |
| `npm run metadata:posts -- --weak --output=.cache/post-metadata-suggestions.json` | Generate local-AI metadata suggestions for weak posts |
| `npm run cta:posts -- --missing --dry` | Preview local-AI post CTAs with relevant site-page links |
| `npm run tags:posts -- --missing --dry` | Preview local-AI post tags (3-10 per post) and the global tag list |
| `npm run excerpt:posts -- --weak --dry` | Preview local-AI excerpt repairs for weak posts |
| `npm run links:posts -- --limit=20 --link-density=2 --dry` | Preview local-AI inline links from post bodies to related same-language posts |
| `npm run links:posts -- src/data/posts/.../post.md` | Apply inline post links, then review the Markdown changes in git |
| `npm run translate:post -- src/data/posts/.../post.md` | Translate one or more posts into the other locale |
| `npm run translate:all-missing` | Create missing translations for all posts |
| `npm run astro -- --help` | Show Astro CLI help |
| `npx @astrojs/upgrade` | Update Astro (fixes security issues but may break the site)|
| `npm audit fix` | Fixes security updates without updating Astro|

## AI Cleanup And Translation

The import and one-off scripts use Ollama by default:

```sh
OLLAMA_URL=http://172.20.208.1:11434
OLLAMA_CLEANUP_FAST_MODEL=aya-expanse:32b
OLLAMA_CLEANUP_DEEP_MODEL=gemma4:31b
OLLAMA_TRANSLATE_MODEL=aya-expanse:32b
OLLAMA_METADATA_MODEL=aya-expanse:32b
OLLAMA_POST_CTA_MODEL=aya-expanse:32b
OLLAMA_POST_TAG_MODEL=aya-expanse:32b
OLLAMA_INLINE_LINK_MODEL=gemma4:31b
```

Cleanup model selection:

- `short-tutorial` and `news-video` use `OLLAMA_CLEANUP_FAST_MODEL`.
- `blog` and `video-tutorial` use `OLLAMA_CLEANUP_DEEP_MODEL`.
- Translation uses `OLLAMA_TRANSLATE_MODEL`.
- Metadata suggestions and excerpt generation use `OLLAMA_METADATA_MODEL`, falling back to `OLLAMA_EXCERPT_MODEL` and then `OLLAMA_TRANSLATE_MODEL`.
- Post CTA generation uses `OLLAMA_POST_CTA_MODEL`, falling back to `OLLAMA_METADATA_MODEL`.
- Post tagging uses `OLLAMA_POST_TAG_MODEL`, falling back to `OLLAMA_METADATA_MODEL`.
- Inline post linking uses `OLLAMA_INLINE_LINK_MODEL`, defaulting to `gemma4:31b` for higher-quality anchor selection. Use `aya-expanse:32b` if speed matters more than precision.

Generated translation pairs are connected with `translationKey` frontmatter, and video translations can also be inferred from shared `youtubeId`. The YouTube importer extracts external links from each video description into `sources` frontmatter; use `npm run import:missing-sources` to backfill existing video posts.

`fix:posts`, `excerpt:posts`, `cta:posts`, `links:posts`, and `related:posts` write changes by default. Add `--dry` to preview changes, then review written changes in git. Use `--deterministic`, `--excerpts`, `--metadata`, or `--translations` to run individual `fix:posts` repair lanes.

The post overview search is static and runs in the browser against already-rendered post cards. It does not call a search backend or AI service at runtime, so it is compatible with GitHub Pages.

`links:posts` uses local Ollama by default to choose meaningful exact anchor phrases from the current post body. It prefers same-language pages from the sidebar, then uses `src/data/related-posts.json` as post candidate input when available, falls back to same-language posts, and validates that each anchor appears in unlinked body text before editing. Use `--link-density=N` to cap new links per 1000 body words, `--candidates=N` to control how many related posts are sent to Ollama after sidebar pages, or `--no-ai` for the deterministic fallback.

`tags:posts` uses local Ollama to assign 3 to 10 discoverability tags per post, stored in post frontmatter as `tags:`. It maintains a global tag list separately in `src/data/tags.json`. For each post it builds the same-locale tag vocabulary from existing frontmatter and the registry, asks Ollama for tags while instructing it to reuse existing ones, then collapses near-duplicates (case, plural, and fuzzy similarity) back onto the existing canonical tag before creating any new tag. Use `--all` to re-tag posts that already have tags (default is `--missing`), `--limit=N` to cap the run, or `--no-registry` to skip refreshing `src/data/tags.json`.
