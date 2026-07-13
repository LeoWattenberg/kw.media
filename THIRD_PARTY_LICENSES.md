# Third-party browser runtime notices

## Audacity-derived native audio effects

Parts of `src/lib/tools/audio-editor/audacity-effects/` are JavaScript translations and adaptations of native effect implementations from Audacity 3.7.7, exact commit `5ef610ed23260d6d648175735bb16b32536eb30b`:

- source: <https://github.com/audacity/audacity/tree/Audacity-3.7.7>
- upstream license and notices: <https://github.com/audacity/audacity/blob/Audacity-3.7.7/LICENSE.txt>
- bundled GPLv3 terms: [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)

Audacity is distributed under GPLv3. Many individual source files are GPL-2.0-or-later; the GPLv3 option is selected for the adapted portions so they can be combined with this AGPLv3 application under section 13 of both licenses. The Audacity-derived portions remain governed by GPLv3. Upstream authorship, source paths, and modification notices are retained in the corresponding JavaScript source files.

Original code is copyright the Audacity Team and the individual authors named in the retained source-file headers. The SimpleCompressor portion retains its separate notice below.

The implementations were translated from C/C++ to JavaScript, separated from Audacity's application and UI construction, and integrated into the kw.media browser audio editor on 2026-07-13. The distributed source code is the preferred form for modification.

Audacity's Compressor and Limiter incorporate SimpleCompressor code:

- SimpleCompressor — Copyright © 2019 Daniel Rudrich; GPL-3.0-only; source: <https://github.com/DanielRudrich/SimpleCompressor>

The port deliberately excludes Audacity effects that rely on SoX/libsoxr, SoundTouch, or SBSMS. No code from those libraries is included in this effect port.

The effect inventory covers Audacity's menu-visible native processing effects (`EffectTypeProcess`). Generate-menu modules (DTMF, Chirp, Noise, Silence, and Tone), the Analyze-menu Find Clipping module, and the hidden Stereo To Mono command are different editor operations and are outside this processing-effect inventory.

Audacity is a registered trademark. This project is not affiliated with or endorsed by the Audacity project or Muse Group.

## Packaged browser dependencies

The browser tools can distribute the following pinned browser-side packages as part of the site build:

- `@ffmpeg/ffmpeg` 0.12.15 — MIT; source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `@ffmpeg/util` 0.12.2 — MIT; source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `@ffmpeg/core` 0.12.10 — GPL-2.0-or-later; corresponding source and build scripts: <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10>
- `fflate` 0.8.3 — MIT; source: <https://github.com/101arrowz/fflate>
- `sql.js` 1.14.1 — MIT; source: <https://github.com/sql-js/sql.js>

Except for identified third-party portions under compatible licenses, the repository is distributed under AGPL-3.0-only. Before deploying the FFmpeg core, the release process must archive the exact corresponding source and build configuration alongside the deployed version and verify the enabled codec libraries and their notices.
