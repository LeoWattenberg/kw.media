---
id: 990005
slug: "how-to-use-audacity-online"
path: "/en/audacity/how-to-use-audacity-online/"
title: "How to use Audacity online"
excerpt: "Audacity has no official web version. Use Soundscaper, a free editor based on Audacity 4, to record, edit, and export audio right in your browser."
date: "2026-11-21T00:00:00"
modified: "2026-11-21T00:00:00"
locale: "en"
translationKey: "post:990005"
aiGenerated: true
category: "audacity"
tags: ["Audacity", "Soundscaper", "Audio Editing", "Open Source"]
relatedPosts: ["/en/audacity/the-best-free-audacity-alternative-2027/", "/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/"]
authorName: "Leo Wattenberg"
sourceUrl: "https://soundscaper.org/docs/tutorials/your-first-project/"
sources:
  - title: "Official Audacity downloads"
    url: "https://www.audacityteam.org/download/"
  - title: "Soundscaper source code"
    url: "https://github.com/mindscaper-org/Soundscaper"
  - title: "Wavacity source documentation"
    url: "https://github.com/ahilss/wavacity/blob/master/README.txt"
---

Audacity has no official online version. The Audacity team distributes it as a desktop app for Windows, macOS, and Linux. If you want the Audacity workflow without installing anything, **Soundscaper** is a free, open-source audio editor based on Audacity 4. It brings multitrack recording and editing, noise reduction, and effects to the browser. [Open Soundscaper in your browser](https://soundscaper.org/en/).

## How to edit audio in your browser

1. **Import a file or record.** Choose **File → Import** and select an audio file. To make a recording, click the red record button and allow microphone access when your browser asks.
2. **Edit your clips.** Drag a clip edge to trim it, or use the **Split tool** and click the waveform where you want to cut. Select a passage and open the **Effect** menu to clean up a recording or add a fade.
3. **Export the finished audio.** Choose **File → Export audio** and pick a format. Use WAV for a lossless copy or MP3 for a smaller file to share.
4. **Keep an editable copy.** Use **File → Export project file (.sscape)** to download a `.sscape` project. Soundscaper processes audio on your device and saves your working project in the browser, without an account. The downloaded copy lets you reopen the project after clearing site data or moving to another computer.

## Soundscaper vs. Wavacity

Wavacity is a browser port based on Audacity 3.0.2. Soundscaper is based on the newer **Audacity 4**, with its updated interface and clip editing workflow. If you're used to Audacity 4, you'll recognize the timeline, the split tool, and the real-time effects workflow.

Soundscaper Web also adds tools beyond Audacity 4. You can loop over a passage to record several takes, then assemble a final take from the best parts. The mixer has buses and sends so you can route several tracks through a shared effect. Automation lets you change volume, pan, or effect settings over time. Native third-party plug-ins such as VST3 require a compatible desktop edition. [Soundscaper and Audacity feature comparison](https://soundscaper.org/docs/start/how-soundscaper-compares/).

## Can I open an Audacity project in Soundscaper?

Yes. Use **File → Open** to open an `.aup3` or `.aup4` file. To continue in Audacity 4, choose **File → Export other → Export AUP4**. Check the compatibility report for changes to effects and mixer settings, and keep a `.sscape` copy to preserve the full Soundscaper project. [Soundscaper project file guide](https://soundscaper.org/docs/projects-and-data/project-files/).

Soundscaper was developed by Leo Wattenberg, the author of this site.
