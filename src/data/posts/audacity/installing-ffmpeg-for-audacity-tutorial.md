---
id: 3399
slug: "installing-ffmpeg-for-audacity-tutorial"
path: "/en/audacity/installing-ffmpeg-for-audacity-tutorial/"
title: "Installing FFmpeg for Audacity [Tutorial]"
excerpt: "FFmpeg is a library that is necessary to open, import, and export various kinds of media files. It is not included with Audacity by default."
date: "2023-08-30T14:53:36"
modified: "2023-08-30T14:53:36"
locale: "en"
translationKey: "video:mY9wBvDgnfQ"
category: "audacity"
tags: ["Audacity 3", "FFmpeg", "Installation Guide", "Media File Compatibility", "Windows Software", "Audio Editing", "Software Update"]
relatedPosts: ["/en/audacity/installing-ffmpeg-for-audacity-fast-tutorial/", "/en/audacity/recording-desktop-audio-in-audacity-tutorial/", "/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/"]
image: "https://i.ytimg.com/vi/mY9wBvDgnfQ/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=mY9wBvDgnfQ"
video:
  youtubeId: "mY9wBvDgnfQ"
  embedUrl: "https://www.youtube.com/embed/mY9wBvDgnfQ"
  watchUrl: "https://www.youtube.com/watch?v=mY9wBvDgnfQ"
  thumbnailUrl: "https://i.ytimg.com/vi/mY9wBvDgnfQ/maxresdefault.jpg"
sources:
  - title: "lame.buanzo.org"
    url: "https://lame.buanzo.org/ffmpeg.php"
  - title: "Official guide"
    url: "https://support.audacityteam.org/basics/installing-ffmpeg"
  - title: "Users on versions pre-Audacity 3.2: Use ffmpeg-win-2.2.2 from"
    url: "https://lame.buanzo.org/#lamewindl"
  - title: "Audacity 3.3.3"
    url: "https://www.audacityteam.org/"
  - title: "7zip"
    url: "https://www.7-zip.org/"
  - title: "Mozilla Firefox"
    url: "https://www.mozilla.org/firefox/"
postCta:
  text: "Confused about installing FFmpeg for Audacity? Our tools page provides simple, step-by-step guidance. Learn how to seamlessly integrate FFmpeg with Audacity, making media file management a breeze. Check out {page} for more info, or contact our expert below."
  pagePath: "/en/tools/"
  pageTitle: "Tools"
---

<!-- kwm:article:start -->
## Understanding FFmpeg and Why Audacity Needs It

If you have spent any time using Audacity, you may have encountered a limitation when trying to open or export certain media files. This is because Audacity does not include FFmpeg by default. 

FFmpeg is a powerful library that allows software to open, import, and export a wide variety of media formats. Without it, Audacity's ability to handle diverse [audio and video](/en/tools/converter/) containers is limited. To unlock full compatibility with various media files, you will need to install the FFmpeg library separately.

## Determining Which Version You Need

Before downloading any files, it is important to determine which version of Audacity you are running. Installing a 64-bit library on a 32-bit application (or vice versa) will not work.

To check your current build:
1. Open Audacity.
2. Navigate to **Help > About Audacity**.
3. Look at the **Build Information**.

If the information explicitly mentions "64-bit," you have the 64-bit version of the software. If there is no mention of 64-bit, you are likely running the 32-bit version. For those using very old versions of Audacity (specifically versions pre-Audacity 3.2), you may need to use `ffmpeg-win-2.2.2` from [lame.buanzo.org](https://lame.buanzo.org/#lamewindl). Otherwise, updating your Audacity installation is recommended.

## Installing FFmpeg via the Recommended Installer

For most users on Windows and macOS, using a dedicated installer is the simplest and most reliable method. 

### Step-by-Step Installation
1. Visit [lame.buanzo.org/ffmpeg.php](https://lame.buanzo.org/ffmpeg.php).
2. Choose the version that matches your system:
   - **64-bit Windows:** The most common choice for modern PCs.
   - **macOS:** For Apple users.
   - **32-bit:** Generally only relevant for older systems or specific legacy Audacity builds.
3. Download and open the installer file.
4. Follow the installation prompts: click "Yes" to proceed, accept the license agreement, and save the files to the default installation path.
5. Click "Install" to complete the process.

### Verifying the Installation in Audacity
Once the installer has finished, you need to ensure Audacity recognizes the new library. 

Go to **Preferences > Libraries** and click the **Locate** button. In many cases, Audacity will automatically detect the valid FFmpeg files and display a message saying: *"Success! Audacity has automatically detected valid FFmpeg files."* When this happens, you can simply click "No" when asked if you want to locate them manually, then click "OK" to save your settings.

## Installation for Linux Users

The recommended installer site does not provide a direct download for Linux. Instead, Linux users should obtain FFmpeg directly from their distribution's official repository. You can do this by using your system's package manager or following the specific instructions provided on the installation website.

## Advanced Manual Installation

Some users may prefer not to use the recommended installer—perhaps because they want a more modern version of FFmpeg or wish to compile their own. If you choose this route, there is a critical technical requirement: **Audacity only works with the shared version of FFmpeg.** 

Most builds offer two versions: a full self-contained version and a shared version. The self-contained version will not work with Audacity; you must ensure you have the shared library files.

### How to Manually Link FFmpeg
If you have downloaded a zip file containing the shared version of FFmpeg, follow these steps to link it to Audacity:

1. Unpack the zip file into a folder (for example, in your Downloads folder).
2. Open Audacity and go to **Preferences > Libraries**.
3. Click **Locate**. 
4. When asked if you want to locate the files manually, click **Browse**.
5. Navigate to the unpacked FFmpeg folder and open the **bin** folder.
6. Select the file named `avformat-60.dll` (or the equivalent version provided in your build).
7. Click **OK**.

Once selected, Audacity will update the version information in the Libraries menu, confirming that the manual installation was successful. You can now [import and export](/en/audacity/installing-ffmpeg-for-audacity-fast-tutorial/) the extended range of media files supported by FFmpeg.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transcript

FFmpeg is a library that is necessary to open, import, and export various kinds of media files. It is not included with Audacity by default. To download it, simply go to this website, and you are presented with three options. The first one is 64-bit Windows, which will be the most useful for most people. macOS is also found here, and 32-bit is usually not relevant on modern systems.

To install it, simply click on the link and open the file you just downloaded, which is the installer. In here, click "Yes," accept the agreement, save it to the default path, click "Install," and you are done. Now, if you go back to Audacity and click the "Locate" button, it will tell you: "Success! Audacity has automatically detected valid FFmpeg files." We do not need to locate them manually again, so we click "No." And here we have the version that we just installed; click "OK," and that's pretty much it.

Now, if you have been using Audacity for a very long time and have a very old version of Audacity that is 32-bit, in that case, you will need to use the 32-bit version of FFmpeg or [update Audacity](/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/). To check what version of Audacity you're running, go to Help > About Audacity > Build Information. If it says "64-bit" in here, you have the 64-bit version; if it says nothing, you have the 32-bit version.

If you are on Linux, you will see that this site does not feature a Linux download. Instead, you can get your Linux version of FFmpeg straight from your repository—instructions are on the site—or just use your package manager.

If you do not want to use the recommended installer—for example, because you want to use a more modern version of FFmpeg—you can do so through these links provided here or compile your own version. If you do this, be aware that most builds (for example, if we take this one) have different versions between the normal full self-contained version and the shared version. Audacity only works with the shared version.

So, if we download this, which is some sort of a zip file, and unpack it, it's now a folder inside of our downloads folder. Audacity doesn't know about this FFmpeg install, so we need to tell it where it is. To do this, go to Preferences > Libraries and click "Locate." We get the same question again; this time, we do want to locate it manually, so click the "Browse" button. Now navigate to the file in question—it is usually in the bin folder—and in here is avformat-60.dll. If you click "OK," the version in Audacity updates and you can now use the different version of FFmpeg.

Additionally, a link to this guide I have been following is in the description. If you have any questions, feel free to ask them in the Audacity Forum or on the Discord. That is all I have for you today. Goodbye and take care!
<!-- kwm:transcript:end -->
