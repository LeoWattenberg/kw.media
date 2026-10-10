---
id: 3529
slug: "how-to-install-ffmpeg-for-audacity-4-windows-mac-and-linux"
path: "/audacity/how-to-install-ffmpeg-for-audacity-4-windows-mac-and-linux/"
title: "How to Install FFmpeg for Audacity 4 (Windows, Mac & Linux)"
excerpt: "So, you try to open a file in Audacity 4 and your project is just gone. No error message, nothing."
date: "2026-10-09T15:27:00"
modified: "2026-10-09T15:27:00"
locale: "en"
translationKey: "video:Yc_krVz-8-o"
category: "audacity"
relatedPosts: ["/en/audacity/installing-ffmpeg-for-audacity-tutorial/", "/en/audacity/installing-ffmpeg-for-audacity-fast-tutorial/", "/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/"]
image: "https://i.ytimg.com/vi/Yc_krVz-8-o/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=Yc_krVz-8-o"
video:
  youtubeId: "Yc_krVz-8-o"
  embedUrl: "https://www.youtube.com/embed/Yc_krVz-8-o"
  watchUrl: "https://www.youtube.com/watch?v=Yc_krVz-8-o"
  thumbnailUrl: "https://i.ytimg.com/vi/Yc_krVz-8-o/maxresdefault.jpg"
sources:
  - title: "FFmpeg for Audacity (Windows & macOS installer)"
    url: "https://lame.buanzo.org/ffmpeg.php"
  - title: "Windows on ARM"
    url: "https://github.com/tordona/ffmpeg-win-arm64"
  - title: "Your own FFmpeg build (pick a \"shared\" version)"
    url: "https://github.com/BtbN/FFmpeg-Builds/releases"
  - title: "Official guide"
    url: "https://support.audacityteam.org/basics/installing-ffmpeg"
  - title: "Still on Audacity 3? Here's the previous version"
    url: "https://youtu.be/mY9wBvDgnfQ"
  - title: "Software used: Windows 11, Audacity 4.0.1 ( )"
    url: "https://www.audacityteam.org/"
postCta:
  text: "Confused about why your audio files won't open in Audacity 4? You likely need to install the FFmpeg library. Check out our {page} for a step-by-step guide on how to do this quickly and easily, or contact our expert below."
  pagePath: "/en/audacity/"
  pageTitle: "Audacity Tutorials"
---

<!-- kwm:article:start -->
## Why Your Files Won't Open in Audacity 4

There is a frustrating experience some users encounter when upgrading to Audacity 4: you attempt to open a media file, but instead of the audio loading, the project simply doesn't open. There is no error message and no warning—the file just fails to load.

This silent failure is almost always a sign that you are missing the FFmpeg library. FFmpeg is a free, open-source library that allows software to handle a vast array of media formats. Because of patent restrictions, the Audacity team cannot ship FFmpeg bundled with the software. Consequently, users must install the library manually to enable full format support.

## How to Check if FFmpeg is Installed

Before downloading any software, you can verify whether Audacity recognizes the FFmpeg library on your system.

1. Open Audacity.
2. Navigate to **Edit > Preferences**.
3. Select the **General** tab.
4. Scroll to the bottom of the window.

If you see the message **"FFmpeg library not found,"** you will need to proceed with the installation to open a wider variety of [audio files](/en/tools/abx-tester/).

## Installing FFmpeg on Windows

For the majority of Windows users, the installation process is straightforward and takes about a minute.

### Standard Windows Installation
If you are using a standard 64-bit Windows PC, you can find the necessary installer via the official guide at [https://support.audacityteam.org/basics/installing-ffmpeg](https://support.audacityteam.org/basics/installing-ffmpeg) or directly at [https://lame.buanzo.org/ffmpeg.php](https://lame.buanzo.org/ffmpeg.php).

1. Download the 64-bit installer.
2. Run the downloaded file. When Windows asks if the app can make changes to your device, click **Yes**.
3. Accept the license agreement.
4. Keep the default installation folder (**Program Files\FFmpeg for Audacity**).
5. Click **Install**.

### Windows on ARM
If you are using a Windows laptop powered by an ARM chip, the standard 64-bit installer will not work. You will need a specific build designed for ARM64, which can be found here: [https://github.com/tordona/ffmpeg-win-arm64](https://github.com/tordona/ffmpeg-win-arm64).

### Verifying the Windows Installation
Once the installation is complete, you must restart Audacity for the changes to take effect. To confirm it is working, return to **Edit > Preferences > General**. Instead of "not found," you should now see the specific FFmpeg version and the directory where it is installed.

## Installing FFmpeg on macOS and Linux

### macOS
Mac users can use the same download site as Windows users: [https://lame.buanzo.org/ffmpeg.php](https://lame.buanzo.org/ffmpeg.php). Download the package and follow the installer prompts. Note that during the process, the installer may appear to be stuck while "validating packages"; be patient, as this is normal behavior for macOS.

### Linux
For Linux users, the process is handled through the system's native package manager. Install FFmpeg via your preferred terminal or software center, then restart Audacity to enable the library.

## Advanced Setup: Using Custom FFmpeg Builds

Some advanced users prefer to use their own FFmpeg builds rather than the provided installers. If you choose this route, such as by downloading from [https://github.com/BtbN/FFmpeg-Builds/releases](https://github.com/BtbN/FFmpeg-Builds/releases), there is one critical requirement: **you must download the "shared" version.**

Audacity requires specific DLL files to function, and only the shared builds include these. To link a custom build to Audacity:

1. Go to **Preferences > General**.
2. Scroll down and click **Locate existing installation** (or **Change FFmpeg** if a version was already detected).
3. Navigate to the folder containing the DLL files. In a GitHub build, these are typically located in the **bin** folder.
4. Select the **avformat.dll** file and click **Open**.
5. Restart Audacity.

## Important Tip for .m4a Files in Audacity 4.0

Even after installing FFmpeg, you may notice a quirk regarding specific file types. In Audacity 4.0, `.m4a` files do not currently appear under the **File > Import** menu. To open these files, you must use **File > Open** instead.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transcript

So, you try to open a file in Audacity 4 and your project is just gone. No error message, nothing. That means you're missing FFmpeg. It's a free library for all kinds of media formats, and Audacity can't ship it for patent reasons. So, you have to install it once yourself. It takes about a minute. Whether you've already installed FFmpeg or not, you can see right here: go to Edit > Preferences > General, scroll down to the bottom, and at the bottom it says "FFmpeg library not found."

If you haven't installed FFmpeg, click "Download FFmpeg." That opens the official guide, and the guide sends you to this website. The link is in the description, too. For most Windows PCs, the 64-bit version is the right one. If you're on a Windows laptop with an ARM chip, there's a separate build; that link is in the description as well. Once you've downloaded the installer, open it. Windows will ask if this app can make changes to your device. Click yes. Accept the license.

Keep the default folder—Program Files\FFmpeg for Audacity—and click install, and you're done. Now restart Audacity and it will find FFmpeg on its own. To make sure, go back to Edit > Preferences > General. Instead of "not found," you will now see the FFmpeg version you have installed and where it's installed. Click okay and you're set. Let's try that file again. And there it is. One tip in Audacity 4.0: .m4a files don't show up under File > Import yet. Just open them with File > Open.

On a Mac, it's the same website. Download the package, click through the installer, and be patient if it seems to be stuck on validating packages. On Linux, install FFmpeg through your package manager, then restart Audacity. 

One thing for advanced users: if you'd rather download your own FFmpeg build, make sure you download the shared version. Only that one has the DLL files Audacity needs. Then go to Preferences > General, scroll down, and click "Locate existing installation." If Audacity already found one, click "Change FFmpeg." Open the folder with the DLL files.

In a GitHub build, that's the bin folder. Select the avformat.dll file. Click open and then restart Audacity. The official guide is linked below. If anything doesn't work, let me know in the comments below and I'll try to help you out.
<!-- kwm:transcript:end -->
