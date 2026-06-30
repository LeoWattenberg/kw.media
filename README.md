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
```

Cleanup model selection:

- `short-tutorial` and `news-video` use `OLLAMA_CLEANUP_FAST_MODEL`.
- `blog` and `video-tutorial` use `OLLAMA_CLEANUP_DEEP_MODEL`.
- Translation uses `OLLAMA_TRANSLATE_MODEL`.

Generated translation pairs are connected with `translationKey` frontmatter, and video translations can also be inferred from shared `youtubeId`.
