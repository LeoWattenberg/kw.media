# Third-party browser runtime notices

The browser tools can distribute the following pinned browser-side packages as part of the site build:

- `@ffmpeg/ffmpeg` 0.12.15 — MIT; source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `@ffmpeg/util` 0.12.2 — MIT; source: <https://github.com/ffmpegwasm/ffmpeg.wasm>
- `@ffmpeg/core` 0.12.10 — GPL-2.0-or-later; corresponding source and build scripts: <https://github.com/ffmpegwasm/ffmpeg.wasm/tree/v0.12.10>
- `fflate` 0.8.3 — MIT; source: <https://github.com/101arrowz/fflate>
- `sql.js` 1.14.1 — MIT; source: <https://github.com/sql-js/sql.js>

The repository itself is distributed under AGPL-3.0. Before deploying the FFmpeg core, the release process must archive the exact corresponding source and build configuration alongside the deployed version and verify the enabled codec libraries and their notices.
