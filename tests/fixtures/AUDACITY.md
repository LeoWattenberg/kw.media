# Native Audacity project fixtures

These two files were saved by the official Linux x86_64 Audacity 3.7.9 and
4.0.1 applications on 2026-10-01. They are committed inputs; `npm run
fixtures:test` generates other media fixtures and does not overwrite them.

| File | SHA-256 |
| --- | --- |
| `audacity-3.7.9-stereo-tones.aup3` | `450ff25285f65132a6c3528e954b481885a1ee8312b871402039d84e50d6d2ec` |
| `audacity-4.0.1-stereo-tones.aup4` | `49c98a73d97b8f4b81c3b7d6d98837d44b322a6849be639badf1d6feb77f1e78` |

The source audio is a 4,800-frame stereo PCM16 WAV at 48,000 Hz. Its left
channel is `round(8192 * sin(2π * 1000 * frame / 48000))`; its right channel
is `round(4096 * sin(2π * 2000 * frame / 48000))`. The integer values are
written as signed little-endian 16-bit samples. This gives separate audible
1 kHz and 2 kHz tones, with peaks of 0.25 and 0.125.

Audacity 3.7.9 imported that WAV, set the project rate to 48,000 Hz, split the
stereo clip at 0.05 seconds, and moved the second clip to 0.15 seconds. The
first clip is named `First tone`, the second `Second tone`. The two clips
share their original source blocks through trims: the first has a 0.05-second
right trim; the second has a 0.05-second left trim and a 0.1-second sequence
offset. The rendered result is 9,600 stereo frames, with silence from frames
2,400 through 7,199. Project and raw audio tempos are both 120 BPM; there are
no envelopes, effects, pitch changes, or stretches.

The native 3 scripting commands were:

```text
Import2: Filename="native-stereo-source.wav"
SetProject: Rate=48000
SelectAll:
SelectTime: Start=0.05 End=0.05
Split:
SetClip: At=0.075 Track=0 Start=0.15 Name="Second tone"
SetClip: At=0.025 Track=0 Name="First tone"
SaveProject2: Filename="native-stereo-two-clips.aup3"
Close:
```

Audacity 4.0.1 then opened that native AUP3 project, saved it as an AUP4
project, and closed it. Its SQLite `user_version` is `0x04000001`; its embedded
XML has `version="2.0.0"` and `audacityversion="4.0.1"`. Both channel records
contain a spectrogram `gain` integer of 20 followed by an audio `gain` double
of 1. Those repeated, typed attributes come from Audacity itself.

The native AUP3 project and the downgraded native AUP4 project were also opened
and exported by Audacity 3.7.9. Both exports contain 9,600 frames, preserve both
channels and the clip gap, and match the expected waveform samples exactly.
`tests/aup-native-artifacts.test.js` checks every decoded sample independently
against the tone formula. Browser tests check real WAV and SQLite download bytes.

For an optional native compatibility check, start Audacity 3.7.9 with its
`mod-script-pipe` module enabled and dismiss any startup dialogs, then run:

```sh
node scripts/verify-audacity-projects.mjs
```

The script opens copies of both committed fixtures, converts the AUP4 copy,
exports them through the running native application, compares the native WAV
samples with the converter output, and writes WAV files and JSON evidence to
a temporary directory. It closes only the projects it opens. Paths can also
be supplied as arguments; `AUDACITY_PIPE_DIR` and `AUDACITY_PIPE_SUFFIX` override
the default Unix scripting-pipe location and user ID. The normal test suites
have no native Audacity dependency.
