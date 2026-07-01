---
id: 3399
slug: "installing-ffmpeg-for-audacity-tutorial"
path: "/audacity/installing-ffmpeg-for-audacity-tutorial/"
title: "Installing FFmpeg for Audacity [Tutorial]"
excerpt: "FFmpeg is a library that is necessary to open, import, and export various kinds of media files. It is not included with Audacity by default."
date: "2023-08-30T14:53:36"
modified: "2023-08-30T14:53:36"
locale: "en"
translationKey: "video:mY9wBvDgnfQ"
category: "audacity"
image: "https://i.ytimg.com/vi/mY9wBvDgnfQ/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=mY9wBvDgnfQ"
video:
  youtubeId: "mY9wBvDgnfQ"
  embedUrl: "https://www.youtube.com/embed/mY9wBvDgnfQ"
  watchUrl: "https://www.youtube.com/watch?v=mY9wBvDgnfQ"
  thumbnailUrl: "https://i.ytimg.com/vi/mY9wBvDgnfQ/maxresdefault.jpg"
---

## Transcript

FFmpeg is a library that is necessary to open, import, and export various kinds of media files. It is not included with Audacity by default. To download it, simply go to this website, and you are presented with three options. The first one is 64-bit Windows, which will be the most useful for most people. macOS is also found here, and 32-bit is usually not relevant on modern systems.

To install it, simply click on the link and open the file you just downloaded, which is the installer. In here, click "Yes," accept the agreement, save it to the default path, click "Install," and you are done. Now, if you go back to Audacity and click the "Locate" button, it will tell you: "Success! Audacity has automatically detected valid FFmpeg files." We do not need to locate them manually again, so we click "No." And here we have the version that we just installed; click "OK," and that's pretty much it.

Now, if you have been using Audacity for a very long time and have a very old version of Audacity that is 32-bit, in that case, you will need to use the 32-bit version of FFmpeg or update Audacity. To check what version of Audacity you're running, go to Help > About Audacity > Build Information. If it says "64-bit" in here, you have the 64-bit version; if it says nothing, you have the 32-bit version.

If you are on Linux, you will see that this site does not feature a Linux download. Instead, you can get your Linux version of FFmpeg straight from your repository—instructions are on the site—or just use your package manager.

If you do not want to use the recommended installer—for example, because you want to use a more modern version of FFmpeg—you can do so through these links provided here or compile your own version. If you do this, be aware that most builds (for example, if we take this one) have different versions between the normal full self-contained version and the shared version. Audacity only works with the shared version.

So, if we download this, which is some sort of a zip file, and unpack it, it's now a folder inside of our downloads folder. Audacity doesn't know about this FFmpeg install, so we need to tell it where it is. To do this, go to Preferences > Libraries and click "Locate." We get the same question again; this time, we do want to locate it manually, so click the "Browse" button. Now navigate to the file in question—it is usually in the bin folder—and in here is avformat-60.dll. If you click "OK," the version in Audacity updates and you can now use the different version of FFmpeg.

Additionally, a link to this guide I have been following is in the description. If you have any questions, feel free to ask them in the Audacity Forum or on the Discord. That is all I have for you today. Goodbye and take care!
