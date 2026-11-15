---
id: 3425
slug: "audacity-4-is-missing-lots-of-audacity-3-features-i-added-them"
path: "/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/"
title: "Audacity 4 is missing lots of Audacity 3 features – I added them"
excerpt: "Which Audacity 3 features are still missing in Audacity 4.0.2? Compare Audacity 3.7.9, Audacity 4.0.2 and Soundscaper, with the Audacity columns checked against their tagged source."
date: "2026-09-04T10:00:00"
modified: "2026-11-15T10:00:00"
locale: "en"
translationKey: "post:3425"
category: "audacity"
tags: ["Audacity 4", "Audacity 3", "Soundscaper", "Audio Editing", "Feature Comparison", "Software Update", "Effects", "Macros", "Audio Export", "Open Source"]
relatedPosts: ["/audacity/missing-macros-in-audacity-4-0-here-is-the-solution/", "/audacity/mix-and-render-missing-in-audacity-4-0-how-to-do-it-anyway/", "/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/"]
image: "https://i.ytimg.com/vi/5nJuWdclGkw/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://kw.media/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/"
sources:
  - title: "Audacity 4.0.2 source tag"
    url: "https://github.com/audacity/audacity/tree/Audacity-4.0.2"
  - title: "Audacity 3.7.9 source tag"
    url: "https://github.com/audacity/audacity/tree/Audacity-3.7.9"
  - title: "Audacity 4.0.2 changelog and compatibility notes"
    url: "https://github.com/audacity/audacity/blob/Audacity-4.0.2/CHANGELOG.txt"
  - title: "Audacity 4.0.2 built-in effect registration"
    url: "https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/internal/builtincollectionloader.cpp"
  - title: "Audacity 4.0.2 editing commands"
    url: "https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/trackedit/internal/trackeditactionscontroller.cpp"
  - title: "Audacity 4.0.2 playhead and selection commands"
    url: "https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/projectscene/view/playcursor/playpositionactioncontroller.cpp"
  - title: "Soundscaper, in your browser"
    url: "https://kw.media/en/tools/audio-editor/"
postCta:
  text: "Missing a feature after the jump to Audacity 4? Our {page} cover the new workflows, and you can reach our expert below."
  pagePath: "/en/audacity/"
  pageTitle: "Audacity Tutorials"
---

Moin. [I worked on Audacity 4](/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/), which has now reached version 4.0.2. If you're coming from Audacity 3, you'll see that it looks a lot better now, and has some really handy new UX which you can learn more about in [the release video](https://www.youtube.com/watch?v=BTQymidLYIM). However, you'll also soon see that it is a bit... unfinished. Several effects and other functions were missing at launch, including some vital ones like exporting stems and Mix & Render. Exporting stems has since returned, while Mix & Render is still missing in 4.0.2. Why the decision was made to release like this I do not know as I left the team in late 2025, but if I had to guess (and this is really just a guess) it's probably just time pressure from the corporate overlords who probably demanded this release ­– no matter what's in it! – to be out by a certain date. So the initial release, even though it says 4.0 is perhaps more akin to a Beta 5, with the actual complete 4.0 bearing the name 4.1.

Anyway: In the lead-up to the release I played around with LLMs a bunch and made some [creator tools](/en/tools), and eventually asked myself the question: But can I make a web version of it? And I could. Behold: [Soundscaper](https://soundscaper.org), a web-based audio editor that incorporates practically all features of Audacity 4. And while I was at it, I also added a bunch of Audacity 3 features to it. So feast your eyes upon the following table, with the many features that you can use in Soundscaper.

You're not even locked into using only Soundscaper, Soundscaper can import and export AUP4 files, so you can switch between the two. This comes especially handy on mobile because – yes, Soundscaper, as a web app, runs anywhere a browser does. So while you can't use Audacity 4 on your phone, you can start recording and editing in Soundscaper, and then export the AUP4 to continue editing on your desktop later. Or just open it back up in Soundscaper again!

Soundscaper is free and open source, and completely private – despite being a web app, there's no account and all files stay on your device. 

## Audacity 3.7.9 vs Audacity 4.0.2 vs Soundscaper

*Updated November 15, 2026. The Audacity columns compare the 3.7.9 and 4.0.2 source tags. This list focuses on features affected by the move to Audacity 4, with a few retained or restored features for context; it is not a complete feature list.*

Audacity 4.0.1 brought back exporting each track or labeled region to a separate file, and 4.0.2 restored the Trim shortcut and several selection and zoom shortcuts. Those changes are included below. [Audacity's changelog](https://github.com/audacity/audacity/blob/Audacity-4.0.2/CHANGELOG.txt) also lists crash and project-corruption fixes in 4.0.2.

| Feature | Audacity 3.7.9 | Audacity 4.0.2 | Soundscaper |
| --- | --- | --- | --- |
| **Named in Audacity's own compatibility notes** | | | |
| Time tracks | Yes | No | No — automation lanes and tempo maps instead |
| Note tracks | Yes | No | Yes - beta|
| Mixer board | Yes | No | Yes |
| Macros | Yes | No | Yes – including JS scripting|
| Scripting pipe and the Scriptables commands | Yes | No | No |
| VAMP and LADSPA plug-in hosting | Yes | No | Yes - desktop only |
| Play-at-Speed | Yes | No | Yes |
| **Effects** | | | |
| Auto Duck | Yes | No | Yes |
| Change Speed effect | Yes | No separate effect — clip pitch/speed controls remain available | Yes |
| Change Tempo effect | Yes | No separate effect — project tempo and clip stretching remain available | Yes |
| Classic Filters | Yes | No | Yes |
| Distortion | Yes | No | Yes |
| Echo | Yes | No | Yes |
| Phaser | Yes | No | Yes |
| Wahwah | Yes | No | Yes |
| Repeat | Yes | No | Yes |
| Legacy Compressor | Yes | No | Yes |
| Real-time effect rack per track | Yes | Yes | Yes – and more added|
| **Analyzers** | | | |
| Plot Spectrum | Yes | No  | Yes |
| Contrast | Yes | No | Yes |
| Find Clipping | Yes | No | Yes |
| **Recording** | | | |
| Timer Record | Yes | No | Yes |
| Sound-activated recording  | Yes | No | Yes |
| Punch and roll | Yes | Yes — renamed lead-in recording | Yes |
| **Export and import** | | | |
| Export the selection only | Yes | Yes | Yes |
| Export each label as its own file | Yes | Yes — restored in 4.0.1 | Yes |
| Export tracks as separate stems | Yes | Yes — restored in 4.0.1 | Yes |
| Import raw data | Yes | No | Yes |
| **Tracks** | | | |
| Mix and Render | Yes | No | Yes |
| Align tracks (seven commands) | Yes | No | Yes |
| Sort tracks by name or start time | Yes | No | Yes |
| Mute and unmute all tracks | Yes | No | Yes |
| Pan and gain commands for the focused track | Yes | No | Yes |
| **Editing and selection** | | | |
| Labeled Audio commands (cut, delete, split, join by label region) | Yes | No | No |
| Store and retrieve a selection, store the cursor position | Yes | No | No |
| Trim audio outside the selection | Yes | Yes — Ctrl+T restored in 4.0.2 | Yes |
| Move the playhead to selection start or end | Yes | Yes — assign shortcuts in Preferences | Yes |
| Move to previous or next label | Yes | No | No |
| Keyboard scrubbing and the seek-during-playback commands | Yes | No | No |
| Preview playback (play one second, play to selection, cut preview) | Yes | No | No |
| Spectral selection, spectral delete and spectral amplify | Yes | Yes | Yes – also added spectral drawing |
| **View and window** | | | |
| Fit to height | Yes | No | Yes |
| Collapse and expand all tracks | Yes | No | Yes |
| Scroll the view to selection start or end (Skip to) | Yes | No | Yes |
| The Extra menu (cursor jumps, focused-track commands) | Yes | No | Partial |

## But wait... there's more!

My focus hasn't just been copying Audacity 4. I also have added tons of new features, such as:

* Video tracks
* Track routing (including send/group buses)
* Project bin
* Automation
* Surround support
* Expanded format support

and much, much more, which you can read more about in [the Soundscaper docs](https://soundscaper.org/docs/start/how-soundscaper-compares/). I even started working on an entire video editor, which I call [Framescaper](https://framescaper.org) (though that one I haven't paid nearly as much attention to. Yet.)

I hope you enjoy Audacity 4 and Soundscaper!
