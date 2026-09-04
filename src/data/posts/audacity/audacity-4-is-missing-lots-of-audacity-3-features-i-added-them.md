---
id: 3425
slug: "audacity-4-is-missing-lots-of-audacity-3-features-i-added-them"
path: "/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/"
title: "Audacity 4 is missing lots of Audacity 3 features – I added them"
seoTitle: "Audacity 4 vs Audacity 3: every missing feature"
excerpt: "Audacity 4 is a ground-up rebuild, and rebuilds leave things behind. Here is the full accounting of what Audacity 3 could do that Audacity 4 cannot, checked against the source of both."
date: "2026-09-04T10:00:00"
modified: "2026-09-04T10:00:00"
locale: "en"
translationKey: "post:3425"
category: "audacity"
tags: ["Audacity 4", "Audacity 3", "Soundscaper", "Audio Editing", "Feature Comparison", "Software Update", "Effects", "Macros", "Audio Export", "Open Source"]
relatedPosts: ["/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/", "/en/audacity/recording-desktop-audio-in-audacity-tutorial/", "/en/audacity/installing-ffmpeg-for-audacity-tutorial/"]
image: "https://i.ytimg.com/vi/5nJuWdclGkw/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://kw.media/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/"
sources:
  - title: "Audacity 4.0.0 source tag"
    url: "https://github.com/audacity/audacity/tree/4c177d436e48c1d20f231eada44035593cb26292"
  - title: "Audacity 3.7.9 source tag"
    url: "https://github.com/audacity/audacity/tree/Audacity-3.7.9"
  - title: "Audacity 4.0 release notes (CHANGELOG.txt)"
    url: "https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/CHANGELOG.txt"
  - title: "Soundscaper, in your browser"
    url: "https://kw.media/en/tools/audio-editor/"
postCta:
  text: "Missing a feature after the jump to Audacity 4? Our {page} cover the new workflows, and you can reach our expert below."
  pagePath: "/en/audacity/"
  pageTitle: "Audacity Tutorials"
---

Moin. [I worked on Audacity 4](/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/), which just released. If you're coming from Audacity 3, you'll see that it looks a lot better now, and has some really handy new UX which you can learn more about in [the release video](https://www.youtube.com/watch?v=BTQymidLYIM). However, you'll also soon see that it is a bit... unfinished. Several effects and other functions are missing, including some vital ones like exporting stems and Mix & Render. Why the decision was made to release like this I do not know as I left the team in late 2025, but if I had to guess (and this is really just a guess) it's probably just time pressure from the corporate overlords who probably demanded this release ­– no matter what's in it! – to be out by a certain date. So this version, even though it says 4.0 is perhaps more akin to a Beta 5, with the actual complete 4.0 bearing the name 4.1.

Anyway: In the lead-up to the release I played around with LLMs a bunch and made some [creator tools](/en/tools), and eventually asked myself the question: But can I make a web version of it? And I could. Behold: [Soundscaper](https://soundscaper.org), a web-based audio editor that incorporates practically all features of Audacity 4. And while I was at it, I also added a bunch of Audacity 3 features to it. So feast your eyes upon the following table, with the many features that you can use in Soundscaper.

You're not even locked into using only Soundscaper, Soundscaper can import and export AUP4 files, so you can switch between the two. This comes especially handy on mobile because – yes, Soundscaper, as a web app, runs anywhere a browser does. So while you can't use Audacity 4 on your phone, you can start recording and editing in Soundscaper, and then export the AUP4 to continue editing on your desktop later. Or just open it back up in Soundscaper again!

Soundscaper is free and open source, and completely private – despite being a web app, there's no account and all files stay on your device. 

## Audacity 3 vs Audacity 4 vs Soundscaper

*(note: This very much is a "negative" list which only lists out the stuff that's missing in Audacity 4. It's not to be taken to mean that Audacity is only missing features, because it does have a lot still)*

| Feature | Audacity 3.7.9 | Audacity 4.0.0 | Soundscaper |
| --- | --- | --- | --- |
| **Named in Audacity's own compatibility notes** | | | |
| Time tracks | Yes | No | No — automation lanes and tempo maps instead |
| Note tracks | Yes | No — Planned for Audacity 5 | No — following Audacity|
| Mixer board | Yes | No | Yes |
| Macros | Yes | No | Yes – including JS scripting|
| Scripting pipe and the Scriptables commands | Yes | No | No |
| VAMP and LADSPA plug-in hosting | Yes | No | No — no desktop version yet |
| Play-at-Speed | Yes | No | Yes |
| **Effects** | | | |
| Auto Duck | Yes | No | Yes |
| Change Speed | Yes | No | Yes |
| Change Tempo | Yes | No | Yes |
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
| Export each label as its own file | Yes | No  | Yes |
| Export tracks as separate stems | Yes | No | Yes |
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
| Trim audio outside the selection | Yes | No | Yes |
| Move to previous or next label | Yes | No | No |
| Keyboard scrubbing and the seek-during-playback commands | Yes | No | No |
| Preview playback (play one second, play to selection, cut preview) | Yes | No | No |
| Spectral selection, spectral delete and spectral amplify | Yes | Yes | Yes – also added spectral drawing |
| **View and window** | | | |
| Fit to height | Yes | No | Yes |
| Collapse and expand all tracks | Yes | No | Yes |
| Skip to selection start or end | Yes | No  | Yes |
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