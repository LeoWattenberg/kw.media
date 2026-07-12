---
id: 3278
slug: "integrating-youtube-chat-into-obs"
path: "/youtube-tips-en/integrating-youtube-chat-into-obs/"
title: "Integrating YouTube Live Chat into OBS: A Simple Guide"
excerpt: "Learn how to display YouTube Live Chat in OBS with free tools. Open chat in a new window, copy the link, and add it as a browser source."
date: "2023-03-24T16:30:02"
modified: "2023-03-24T16:30:02"
locale: "en"
translationKey: "video:E5BmjrCT1LE"
category: "short-tutorial"
tags: ["YouTube Live Streaming", "OBS", "Live Chat Features", "Free Tools", "Stream Setup", "Streaming Software", "Browser Source", "Customisation", "CSS Editing"]
relatedPosts: ["/youtube-tips-en/how-to-use-youtube-lives-take-a-break-feature-step-by-step-tutorial-with-obs-setup/", "/youtube-tips-en/getting-started-with-youtube-live-streaming/", "/youtube-tips-en/connecting-obs-to-twitch-and-youtube/"]
image: "https://i.ytimg.com/vi/E5BmjrCT1LE/maxresdefault.jpg"
authorName: "Martin Koytek"
sourceUrl: "https://www.youtube.com/shorts/E5BmjrCT1LE"
video:
  youtubeId: "E5BmjrCT1LE"
  embedUrl: "https://www.youtube.com/embed/E5BmjrCT1LE"
  watchUrl: "https://www.youtube.com/shorts/E5BmjrCT1LE"
  thumbnailUrl: "https://i.ytimg.com/vi/E5BmjrCT1LE/maxresdefault.jpg"
sources:
  - title: "Mit Tools wie Chatv2 ( ) kann man dazu noch das Aussehen des Chats beliebig anpassen."
    url: "https://chatv2.septapus.com/"
postCta:
  text: "Confused about integrating YouTube Live Chat into OBS? Our {page} offers free tools and step-by-step guidance to help you display chat seamlessly in your broadcasts, or contact our expert below."
  pagePath: "/en/tools/"
  pageTitle: "Tools"
---

<!-- kwm:article:start -->
## How to Add YouTube Live Chat to OBS

Integrating your live chat directly into your streaming software is essential for engaging with your audience in real-time. By bringing the conversation onto your screen, you can respond to viewers without having to constantly switch between windows or look away from your content. 

Here is a simple guide on how to [integrate a YouTube Live chat into your OBS](/youtube-tips-en/connecting-obs-to-twitch-and-youtube/) using free tools.

### Step 1: Extracting the Chat URL
To begin, you need to isolate the chat from the rest of the YouTube interface so that only the messages—and not the entire webpage—appear on your stream. 

In your [YouTube Live](/youtube-tips-en/how-to-use-youtube-lives-take-a-break-feature-step-by-step-tutorial-with-obs-setup/) dashboard or stream view, look for the option to open the chat in a new window (often referred to as "pop-out chat"). Once the chat is running in its own separate browser window, simply copy the URL from the address bar of that window.

### Step 2: Adding the Browser Source in OBS
Once you have the link, you can bring it into OBS using a browser source. A browser source allows OBS to render a web page as an element within your scene.

1. Open OBS and locate the **Sources** panel.
2. Click the **+** icon and select **Browser**.
3. Give the source a descriptive name, such as "YouTube Chat."
4. Paste the URL you copied from the pop-out chat window into the URL field.

Your [YouTube Live chat](/en/live/) should now appear in your OBS preview. You can resize and reposition this window to fit your stream layout.

### Customizing the Appearance with CSS
By default, the browser source will display the standard YouTube chat styling. However, if you want a more branded or polished look, you can use custom CSS (Cascading Style Sheets) to modify the visuals.

Free tools like [Chatv2](https://chatv2.septapus.com/) allow you to customize the appearance of your chat to your liking. After using Chatv2 to create your desired style, you can copy the generated CSS code and paste it into the "Custom CSS" section within the properties of your browser source in OBS. This allows you to adjust elements like transparency, colors, and fonts.

### Important: Updating the Video ID
There is one critical detail to keep in mind for future streams: every [YouTube Live](/youtube-tips-en/getting-started-with-youtube-live-streaming/) broadcast has a unique video ID. 

Because the chat link is specific to a single session, the URL from a previous stream will not work for a new one. Whenever you start a new live broadcast, remember to update the browser source URL with the current video ID; otherwise, the active chat will not be displayed on your stream.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transcript

To [integrate a YouTube Live chat into your OBS](/youtube-tips-en/connecting-obs-to-twitch-and-youtube/), you first need to open the chat as a new window. You can then simply copy the link and paste it in as a browser source in your OBS. With free tools like Chat V2, you can then create your own CSS to customize the chat to your liking. Remember to change the video ID next time, otherwise, of course, the new chat won't be displayed.
<!-- kwm:transcript:end -->
