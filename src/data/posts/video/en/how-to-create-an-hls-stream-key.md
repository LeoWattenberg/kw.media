---
id: 3273
slug: "how-to-create-an-hls-stream-key"
path: "/youtube-tips-en/how-to-create-an-hls-stream-key/"
title: "How to Create an HLS Stream Key for HDR Streams on YouTube"
excerpt: "Learn how to set up an HLS stream key to display HDR content correctly on YouTube, involving a simple process in the Live Control Room."
date: "2022-09-13T18:42:14"
modified: "2022-09-13T18:42:14"
locale: "en"
translationKey: "video:RSeROQWVAPk"
category: "short-tutorial"
tags: ["YouTube Live Streaming", "HDR Streams", "HLS Stream Key", "Stream Settings", "Streaming Protocols", "Live Control Room", "Content Creation", "Video Production", "YouTube Features"]
relatedPosts: ["/youtube-tips-en/hdr-youtube-streams-made-easier-than-ever-your-weekly-youtube-updates/", "/youtube-tips-en/connecting-obs-to-twitch-and-youtube/", "/youtube-tips-en/getting-started-with-youtube-live-streaming/"]
image: "https://i.ytimg.com/vi/RSeROQWVAPk/maxresdefault.jpg"
authorName: "Martin Koytek"
sourceUrl: "https://www.youtube.com/shorts/RSeROQWVAPk"
video:
  youtubeId: "RSeROQWVAPk"
  embedUrl: "https://www.youtube.com/embed/RSeROQWVAPk"
  watchUrl: "https://www.youtube.com/shorts/RSeROQWVAPk"
  thumbnailUrl: "https://i.ytimg.com/vi/RSeROQWVAPk/maxresdefault.jpg"
postCta:
  text: "Confused about streaming HDR on YouTube? Creating an HLS stream key is a simple process. Head over to {page} for more detailed guidance and expert support."
  pagePath: "/en/creator/"
  pageTitle: "Creator Services"
---

<!-- kwm:article:start -->
## Ensuring Correct HDR Display with HLS Stream Keys

To ensure that High Dynamic Range (HDR) content is displayed correctly during your [YouTube live streams](/en/live/), you cannot rely on a standard streaming setup. Instead, you must broadcast your stream using the HLS (HTTP Live Streaming) protocol. Without this specific configuration, YouTube may not be able to process and display the HDR metadata properly, potentially affecting the visual quality for your viewers.

To enable this functionality, you need to create a dedicated stream key that specifically supports the HLS protocol. This setup is handled within the backend of your YouTube account before you go live.

### Step-by-Step: Creating an HLS Stream Key

Setting up an HDR-compatible stream requires a few specific steps within the YouTube Studio environment. Follow this process to configure your settings:

1. **Access the Live Control Room:** Navigate to the Live Control Room menu in your account.
2. **Manage Stream Keys:** From the menu, select the "Stream Keys" option.
3. **Initiate a New Key:** Click on "Create New Stream Key" to open the configuration window.
4. **Configure Protocol Settings:** 
   - Assign a name to the key so you can easily identify it as your HDR/HLS key in the future.
   - In the dropdown menu for streaming protocols, select **HLS Advanced**. This is the essential step that allows YouTube to accept HDR content correctly.
5. **Finalize:** Click "Create" to generate the key.

### Critical Configuration Warning

Once you have created your HLS Advanced stream key, it is ready to be plugged into your [broadcasting software](/youtube-tips-en/connecting-obs-to-twitch-and-youtube/). However, there is a crucial detail regarding the settings: **do not enable the manual options** in this section. 

Sticking to the default configurations—aside from selecting the HLS Advanced protocol—is necessary to ensure the stream remains compatible with YouTube's HDR requirements. Enabling manual overrides may interfere with how the HLS protocol handles the high-dynamic-range data, potentially neutralizing the benefits of using an HLS key in the first place.

By following these steps and avoiding manual adjustments, you can successfully broadcast HDR content that maintains its intended visual fidelity for your audience on YouTube.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transcript

To display HDR correctly in your streams, you need to broadcast your stream using the HLS protocol. For YouTube to accept this properly, you'll need to create a stream tier that supports the HLS protocol. Before starting your stream, go to the Live Control Room menu, select "Stream Keys," and click on "Create New Stream Key." Here, give the key a name and choose HLS Advanced as the streaming protocol. Once you hit "Create," you can use this key to stream HDR content. It's crucial that you do not enable the manual options here.
<!-- kwm:transcript:end -->
