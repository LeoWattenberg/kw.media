# KW Media

Astro site for KW Media pages and post content.

## Commands

Run commands from the project root:

| Command | Action |
| :-- | :-- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the local dev server at `localhost:4321` |
| `npm run build` | Build the production site to `./dist/` |
| `npm run preview` | Preview the production build locally |
| `npm run import:youtube` | Import new YouTube posts, clean transcripts, and create translations |
| `IMPORT_AI=0 npm run import:youtube` | Import new YouTube posts without Ollama cleanup/translation |
| `npm run cleanup:post -- src/data/posts/.../post.md` | Clean one or more existing posts |
| `npm run cleanup:last-commit` | Clean markdown posts touched by the latest commit |
| `npm run audit:posts` | Audit post metadata, language, links, and generated related-post data |
| `npm run audit:posts -- --ai` | Add local Ollama metadata suggestions for flagged posts |
| `npm run metadata:posts -- --weak --output=.cache/post-metadata-suggestions.json` | Generate local-AI metadata suggestions for weak posts |
| `npm run excerpt:posts -- --weak --dry-run` | Preview local-AI excerpt repairs for weak posts |
| `npm run translate:post -- src/data/posts/.../post.md` | Translate one or more posts into the other locale |
| `npm run translate:all-missing` | Create missing translations for all posts |
| `npm run astro -- --help` | Show Astro CLI help |

## AI Cleanup And Translation

The import and one-off scripts use Ollama by default:

```sh
OLLAMA_URL=http://172.20.208.1:11434
OLLAMA_CLEANUP_FAST_MODEL=aya-expanse:32b
OLLAMA_CLEANUP_DEEP_MODEL=gemma4:31b
OLLAMA_TRANSLATE_MODEL=aya-expanse:32b
OLLAMA_METADATA_MODEL=aya-expanse:32b
```

Cleanup model selection:

- `short-tutorial` and `news-video` use `OLLAMA_CLEANUP_FAST_MODEL`.
- `blog` and `video-tutorial` use `OLLAMA_CLEANUP_DEEP_MODEL`.
- Translation uses `OLLAMA_TRANSLATE_MODEL`.
- Metadata suggestions and excerpt generation use `OLLAMA_METADATA_MODEL`, falling back to `OLLAMA_EXCERPT_MODEL` and then `OLLAMA_TRANSLATE_MODEL`.

Generated translation pairs are connected with `translationKey` frontmatter, and video translations can also be inferred from shared `youtubeId`.

The post overview search is static and runs in the browser against already-rendered post cards. It does not call a search backend or AI service at runtime, so it is compatible with GitHub Pages.
