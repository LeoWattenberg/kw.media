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
| `npm run expand:transcripts -- --thin --dry --limit=5` | Preview local-AI expansion of thin transcript-style posts into fuller articles |
| `npm run audit:posts` | Audit post metadata, language, links, and generated related-post data |
| `npm run audit:posts -- --ai` | Add local Ollama metadata suggestions for flagged posts |
| `npm run fix:posts -- --common --dry` | Preview common fixes for flagged posts |
| `npm run fix:posts -- --common` | Apply deterministic fixes, excerpt regeneration, and wrong-language retranslation |
| `npm run fix:posts -- --all-fixes` | Also apply local-AI title/excerpt metadata suggestions |
| `npm run metadata:posts -- --weak --output=.cache/post-metadata-suggestions.json` | Generate local-AI metadata suggestions for weak posts |
| `npm run description:tools -- --dry` | Preview local-AI SEO-description suggestions for tool pages; run without `--dry` to apply them |
| `npm run content:tools -- --dry --limit=5` | Preview local-AI multi-paragraph tool copy; run without `--dry` to store it below each tool |
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

## Audio Editor

The local-first multitrack editor is available at `/de/tools/audio-editor/` and `/en/tools/audio-editor/`. Its canonical project model, Web Audio engine, worklets, OPFS/IndexedDB storage, analysis, and export helpers live in `src/lib/tools/audio-editor/`. The existing single-file Audio Analyzer remains independent.

- Audio sources are converted to immutable 48 kHz mono/stereo PCM and stored in bounded chunks. OPFS is preferred, with IndexedDB and memory fallbacks.
- Playback, recording, effects, mixing, analysis, and WAV bounce run in the browser. Large or unsupported offline renders fall back to a bounded 1× AudioWorklet render.
- The pinned single-thread FFmpeg core is emitted as a same-origin lazy build asset and is used only for decoder fallback and MP3, FLAC, or Opus encoding.
- The direct routes remain out of category listings until the Firefox/WebKit, physical mobile-device, loudness-reference, performance, and FFmpeg release-license gates are complete.

Focused checks:

```sh
node --test tests/audio-editor-model.test.js tests/audio-editor-runtime.test.js tests/audio-editor-lock.test.js
npx playwright test tests/browser/audio-editor.spec.js --project=chromium
PLAYWRIGHT_CROSS_BROWSER=1 npx playwright test tests/browser/audio-editor.spec.js --project=mobile-chromium
AUDIO_EDITOR_FFMPEG_BROWSER=1 npx playwright test tests/browser/audio-editor.spec.js --project=chromium --grep='self-hosted FFmpeg'
```

See `THIRD_PARTY_LICENSES.md` before deploying the bundled FFmpeg core.

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
OLLAMA_TRANSCRIPT_EXPAND_MODEL=gemma4:31b
OLLAMA_TOOL_DESCRIPTION_MODEL=aya-expanse:8b
OLLAMA_TOOL_CONTENT_MODEL=aya-expanse:8b
```

Cleanup model selection:

- `short-tutorial` and `news-video` use `OLLAMA_CLEANUP_FAST_MODEL`.
- `blog` and `video-tutorial` use `OLLAMA_CLEANUP_DEEP_MODEL`.
- Translation uses `OLLAMA_TRANSLATE_MODEL`.
- Metadata suggestions and excerpt generation use `OLLAMA_METADATA_MODEL`, falling back to `OLLAMA_EXCERPT_MODEL` and then `OLLAMA_TRANSLATE_MODEL`.
- Post CTA generation uses `OLLAMA_POST_CTA_MODEL`, falling back to `OLLAMA_METADATA_MODEL`.
- Post tagging uses `OLLAMA_POST_TAG_MODEL`, falling back to `OLLAMA_METADATA_MODEL`.
- Inline post linking uses `OLLAMA_INLINE_LINK_MODEL`, defaulting to `gemma4:31b` for higher-quality anchor selection. Use `aya-expanse:32b` if speed matters more than precision.
- Transcript expansion uses `OLLAMA_TRANSCRIPT_EXPAND_MODEL`, defaulting to the deep cleanup model, to turn thin transcript-style video posts into fuller article bodies.
- Tool meta descriptions use `OLLAMA_TOOL_DESCRIPTION_MODEL`; expanded below-tool copy uses `OLLAMA_TOOL_CONTENT_MODEL` and falls back to the description model.

Generated translation pairs are connected with `translationKey` frontmatter, and video translations can also be inferred from shared `youtubeId`. The YouTube importer extracts external links from each video description into `sources` frontmatter; use `npm run import:missing-sources` to backfill existing video posts.

`fix:posts`, `excerpt:posts`, `cta:posts`, `links:posts`, and `related:posts` write changes by default. Add `--dry` to preview changes, then review written changes in git. Use `--deterministic`, `--excerpts`, `--metadata`, or `--translations` to run individual `fix:posts` repair lanes.

The post overview search is static and runs in the browser against already-rendered post cards. It does not call a search backend or AI service at runtime, so it is compatible with GitHub Pages.

`links:posts` uses local Ollama by default to choose meaningful exact anchor phrases from post bodies and the generated multi-paragraph tool descriptions. Every same-language tool is a valid target. The script also prefers same-language pages from the sidebar, then uses each post's `relatedPosts` frontmatter as candidate input, falls back to same-language posts, and validates that each anchor appears in unlinked body text before editing. Passing post filenames limits source editing to those posts and skips tool descriptions. Use `--link-density=N` to cap new links per 1000 body words, `--candidates=N` to control how many related posts are sent to Ollama after page targets, or `--no-ai` for the deterministic fallback.

`tags:posts` uses local Ollama to assign 3 to 10 discoverability tags per post, stored in post frontmatter as `tags:`. It maintains `src/data/tags.json` as a generated aggregate registry for canonical names, slugs, counts, and currently unused tags. For each post it builds the same-locale tag vocabulary from existing frontmatter and the registry, asks Ollama for tags while instructing it to reuse existing ones, then collapses near-duplicates (case, plural, and fuzzy similarity) back onto the existing canonical tag before creating any new tag. Use `--all` to re-tag posts that already have tags (default is `--missing`), `--limit=N` to cap the run, or `--no-registry` to skip refreshing `src/data/tags.json`.

`expand:transcripts` uses local Ollama to rewrite transcript-style video posts into fuller article bodies while preserving privacy and avoiding runtime AI calls. It keeps the generated article and original transcript in separate Markdown regions marked with `<!-- kwm:article:start -->` / `<!-- kwm:article:end -->` and `<!-- kwm:transcript:start -->` / `<!-- kwm:transcript:end -->`; the site renders the transcript region as an expandable "Original transcript" block. The prompt allows only the transcript, `sourceUrl`, and `sources` frontmatter as source material, and the script rejects output with prompt leakage, wrong-language text, missing headings, or new link targets. Start with `--dry --limit=N`, inspect the preview or git diff, then run without `--dry` for selected files or thin batches.
