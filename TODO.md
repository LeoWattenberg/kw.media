# Tool roadmap

## Completed

- [x] Normalize converter interfaces.
  - [x] Virtual converter pages now use the virtual tool title, the parent converter as eyebrow, and their intended target format by default.
  - [x] Document, image, media, and GIF converters use a shared input/output-left and toolbar-right layout; the toolbar collapses into an accessible drawer on small screens.
  - [x] Image, GIF, and media converters switch between original and converted assets in the same preview area.
  - [x] Pandoc HTML outputs render in a sandboxed preview and text outputs render in a text preview. Binary outputs retain a download action.
- [x] Add a local-AI tool-description workflow.
  - [x] `npm run description:tools -- --dry` proposes reviewed SEO descriptions with local Ollama; `--write` applies them.
  - [x] Every tools page renders its metadata description below the workspace.
- [x] Add feasible new tools.
  - [x] Shorts, TikTok, and Reels Safe Zone Previewer with platform presets and adjustable safety margins.
  - [x] Subtitle Burner for user-provided SRT/WebVTT text, including full-cue, single-word, and word-highlighted karaoke modes.

## Deferred after feasibility audit

- [ ] Add a Whisper.cpp speech-to-subtitle mode. Whisper.cpp has a browser/WASM example, but a production GitHub Pages tool still needs a versioned, self-hosted model download, size/bandwidth policy, language UX, and a reliable cancellation/progress flow. Do not ship a CDN-only model dependency without those decisions.
- [ ] Add Pandoc PDF.js and MathJax output rendering. The current Pandoc profile set does not generate PDF, and math-aware HTML needs an explicit, versioned MathJax asset strategy. Add these alongside a PDF-capable Pandoc pipeline rather than showing a broken PDF option.
- [ ] Add Chromaprint song identification. Local fingerprinting is possible, but song identification requires a reference catalogue or an AcoustID-compatible lookup and API-key/privacy decisions; fingerprint-only output is not a useful SongID replacement.
- [ ] Add RNNoise/DeepFilterNet denoising. RNNoise is technically WASM-suitable, but this project does not yet include a maintained browser wrapper, worker integration, or a model licensing/versioning policy. DeepFilterNet adds a considerably larger model/runtime requirement.
- [ ] Add WebGPU image/video upscaling. Existing WebGPU runtimes can run local models, but an accessible fallback and a pinned model-delivery budget are required for GitHub Pages. Video additionally requires frame batching and re-encoding memory limits.
- [ ] Add PSNR/VMAF quality metrics and bitrate optimization. PSNR can be added with a carefully scoped local implementation, but VMAF and optimizer decisions require a custom FFmpeg build with the relevant libraries; the current browser core must not advertise unsupported metrics.
- [ ] Add multi-camera audio sync and video stabilization. Audio-correlation sync needs a proven in-browser decoder/correlation runtime and media-duration limits. Stabilization requires a browser build with `vidstab` (or a maintained WASM alternative), which the configured FFmpeg core does not guarantee.

## Verification

- [x] `npm test`
- [x] `npm run build`
- [ ] `npm run test:browser` is blocked in this environment because Chromium system dependency `libnspr4.so` requires administrator installation. Chromium itself is installed; the Playwright dependency installer cannot obtain sudo here.
