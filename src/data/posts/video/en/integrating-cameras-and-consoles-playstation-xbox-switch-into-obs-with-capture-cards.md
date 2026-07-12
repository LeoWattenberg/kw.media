---
id: 3224
slug: "integrating-cameras-and-consoles-playstation-xbox-switch-into-obs-with-capture-cards"
path: "/youtube-tips-en/integrating-cameras-and-consoles-playstation-xbox-switch-into-obs-with-capture-cards/"
title: "Integrating Cameras & Consoles (Playstation, Xbox, Switch) into OBS with Capture Cards"
excerpt: "To capture from gaming consoles or DSLR facecams, you need a so-called capture card. Once this is connected to the console and your computer, you can then add the capture card as a source in OBS."
date: "2023-03-23T16:30:05"
modified: "2023-03-23T16:30:05"
locale: "en"
translationKey: "video:MxTHgbSwjWE"
category: "short-tutorial"
tags: ["Capture Cards", "OBS", "Gameplay Capture", "Facecam", "Streaming Equipment", "Video Capture", "Streaming Software", "Console Integration"]
relatedPosts: ["/youtube-tips-en/avermedia-streamer-cap-4k-or-elgato-cam-link-4k/", "/youtube-tips-en/using-scenes-and-sources-in-obs/", "/youtube-tips-en/getting-started-with-obs-a-beginners-guide/"]
image: "https://i.ytimg.com/vi/MxTHgbSwjWE/maxresdefault.jpg"
authorName: "Martin Koytek"
sourceUrl: "https://www.youtube.com/shorts/MxTHgbSwjWE"
video:
  youtubeId: "MxTHgbSwjWE"
  embedUrl: "https://www.youtube.com/embed/MxTHgbSwjWE"
  watchUrl: "https://www.youtube.com/shorts/MxTHgbSwjWE"
  thumbnailUrl: "https://i.ytimg.com/vi/MxTHgbSwjWE/maxresdefault.jpg"
postCta:
  text: "Confused about integrating consoles like Playstation, Xbox, or Switch into OBS? For more insights on creator tools, check out {page}, or contact our expert below."
  pagePath: "/en/tools/"
  pageTitle: "Tools"
---

<!-- kwm:article:start -->
## Understanding Capture Cards for Streaming

Whether you are looking to stream high-quality gameplay from a gaming console or want to use a professional DSLR as your facecam, you cannot simply plug these devices directly into your computer's USB port and expect them to function as video sources. To bridge this gap, you need a device known as a [capture card](/youtube-tips-en/avermedia-streamer-cap-4k-or-elgato-cam-link-4k/).

### What is a Capture Card?

A capture card acts as an intermediary between your hardware and your computer. It takes the video signal—typically sent via HDMI from a PlayStation, Xbox, Nintendo Switch, or DSLR camera—and converts it into a data format that your PC can recognize and process. This allows you to bring high-fidelity visuals into your streaming software, giving you more control over your production than the built-in streaming options provided by most consoles.

## Setting Up Your Hardware

Before configuring your software, you must ensure the physical connections are correctly established. The general workflow for a capture card setup is as follows:

1. **Connect the Source:** Plug the HDMI output of your gaming console or DSLR camera into the "Input" port of the capture card.
2. **Connect to PC:** Connect the capture card to your computer using the appropriate USB cable.
3. **Optional Passthrough:** If your capture card supports it, you can connect a second HDMI cable from the "Output" port of the card to your monitor or TV. This allows you to play the game with zero latency while the computer handles the recording and streaming.

## Integrating the Feed into OBS

Once the hardware is connected and recognized by your system, you need to bring that signal into your [broadcasting software](/youtube-tips-en/getting-started-with-obs-a-beginners-guide/). You can [add the capture card as a source in OBS](/youtube-tips-en/using-scenes-and-sources-in-obs/) by following these steps:

1. Open OBS and locate the **Sources** dock at the bottom of the screen.
2. Click the **"+" (plus)** icon to add a new source to your current scene.
3. Select **"Video Capture Device"** from the list of available options.
4. Give your source a descriptive name—such as "Console Gameplay" or "DSLR Facecam"—and click OK.
5. In the properties window that appears, find the **Device** dropdown menu and select your specific capture card from the list.

Once selected, your video feed should appear on the OBS canvas. You can then resize, crop, or position the source to fit your desired stream layout, allowing you to seamlessly blend high-end camera visuals with your gameplay.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transcript

To capture gameplay from gaming consoles or DSLR facecams using OBS, you'll need a device known as a "[capture card](/youtube-tips-en/avermedia-streamer-cap-4k-or-elgato-cam-link-4k/)." Once connected to your console and computer, you can [add the capture card as a source in OBS](/youtube-tips-en/using-scenes-and-sources-in-obs/). You'll find this under "Video Capture Devices."
<!-- kwm:transcript:end -->
