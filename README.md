# kw.media

Astro site for kw.media pages and post content.

## Installation

Linux (including WSL on Windows) is recommended, although native Windows also works.

### First-time setup

1. Install [Git](https://git-scm.com/downloads) and [Node.js with npm](https://nodejs.org/), and make sure both `git` and `npm` are available on your `PATH`.
2. Open a terminal in the directory where you keep your Git projects, then clone and install the project:

   ```sh
   git clone https://github.com/LeoWattenberg/kw.media.git
   cd kw.media
   npm install
   ```

3. Install [Ollama](https://ollama.com/download). If the site runs in WSL while Ollama runs on Windows, configure Ollama to listen on the network, for example by setting `OLLAMA_HOST=0.0.0.0:11434`, and restart Ollama. Only expose this port on a trusted network and restrict it with your firewall.
4. Verify the Ollama address from the environment where you will run the npm commands. WSL may need the Windows host IP instead. The following request should return Ollama's version information:

   ```sh
   curl http://127.0.0.1:11434/api/version
   ```

5. Install the Ollama models configured in [AI Cleanup And Translation](#ai-cleanup-and-translation). At minimum, the default configuration currently needs:

   ```sh
   ollama pull aya-expanse:32b
   ollama pull aya-expanse:8b
   ollama pull gemma4:31b
   ```

6. Import the latest YouTube content:

   ```sh
   npm run import:youtube
   ```

   If Ollama runs at a different address, pass the complete URL to the importer and the other AI-assisted commands:

   ```sh
   OLLAMA_URL=http://192.168.1.100:11434 npm run import:youtube
   ```

   In native Windows PowerShell, set the variable for the current terminal session first:

   ```powershell
   $env:OLLAMA_URL = "http://192.168.1.100:11434"
   npm run import:youtube
   ```

   A successful import commits the post files it changed on its own. Videos it skipped, for example because they have no transcript yet, do not prevent that commit; an import that ends with an error commits nothing and leaves everything for review. The commit covers only files under `src/data/posts/`, and only those the import itself changed: files that were already modified before the run stay out of it, as does anything the import touched elsewhere, such as `src/data/generated-tool-metadata/`. The importer lists those leftovers so they can be reviewed and committed separately. Add `IMPORT_COMMIT=0` to import without committing.

7. Review the import commit and the remaining changes, then push. Pushing to the configured branch triggers the site's deployment workflow:

   ```sh
   git show
   git status
   git push
   ```

### Later updates

The installation steps only need to be completed once. For later imports, update your local checkout before running the importer:

```sh
git pull
npm run import:youtube
git show
git status
git push
```

## Commands

Run commands from the project root:

| Command | Action |
| :-- | :-- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the local dev server at `localhost:4321` |
| `npm run build` | Build the production site to `./dist/` |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run the Node test suite |
| `npm run test:browser` | Build, then run the Playwright browser tests |
| `npm run fixtures:test` | Regenerate the binary media fixtures in `tests/fixtures/` |
| `npm run import:youtube` | Import new YouTube posts, clean transcripts, create translations, refresh related posts, add inline links, and commit the changed posts |
| `IMPORT_AI=0 npm run import:youtube` | Import new YouTube posts without Ollama cleanup, translation, related posts, or inline links |
| `IMPORT_COMMIT=0 npm run import:youtube` | Import new YouTube posts without committing the changed posts |
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
| `npm run graph:soundscaper-commits` | Refresh `public/data/soundscaper-commits.json` for the Soundscaper commit graph tool; set `GITHUB_TOKEN` to avoid the 60-requests-per-hour anonymous limit. Line counts cost one request per commit, so known ones are reused and at most `COMMIT_GRAPH_MAX_STAT_REQUESTS` (default 600) are fetched per run |
| `npm run astro -- --help` | Show Astro CLI help |
| `npx @astrojs/upgrade` | Update Astro (fixes security issues but may break the site)|
| `npm audit fix` | Fixes security updates without updating Astro|

## Audio Editor

The `/de/tools/audio-editor/` and `/en/tools/audio-editor/` pages embed the
standalone [Soundscaper](https://soundscaper.org) application. Set
`PUBLIC_SOUNDSCAPER_ORIGIN` during a build to target a preview deployment; it
defaults to `https://soundscaper.org`.

The application source, audio engine, workers, tests, WebAssembly, and complete
third-party notices are maintained in the `LeoWattenberg/Soundscaper` repository.
The existing single-file Audio Analyzer and AUP3-to-WAV converter remain part of
kw.media.

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
