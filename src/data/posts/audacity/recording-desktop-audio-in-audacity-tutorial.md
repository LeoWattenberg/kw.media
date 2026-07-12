---
id: 3401
slug: "recording-desktop-audio-in-audacity-tutorial"
path: "/en/audacity/recording-desktop-audio-in-audacity-tutorial/"
title: "Recording desktop audio in Audacity [Tutorial]"
excerpt: "To record desktop audio in Audacity, go to Audio Setup Host and set the host to Windows WASAPI. In the case of Mac or Linux, it's a lot more complicated, and I will not be covering it in this tutorial."
date: "2023-09-02T21:41:18"
modified: "2023-09-02T21:41:18"
locale: "en"
translationKey: "video:VB0-XfW6lms"
category: "audacity"
tags: ["Audacity 3", "Audio Setup", "Windows WASAPI", "Desktop Audio Recording", "Loopback Devices", "Stereo Recording", "Overdub", "Audio Settings", "Sample Rate Matching"]
relatedPosts: ["/en/audacity/installing-ffmpeg-for-audacity-fast-tutorial/", "/en/audacity/installing-ffmpeg-for-audacity-tutorial/", "/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/"]
image: "https://i.ytimg.com/vi/VB0-XfW6lms/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=VB0-XfW6lms"
video:
  youtubeId: "VB0-XfW6lms"
  embedUrl: "https://www.youtube.com/embed/VB0-XfW6lms"
  watchUrl: "https://www.youtube.com/watch?v=VB0-XfW6lms"
  thumbnailUrl: "https://i.ytimg.com/vi/VB0-XfW6lms/maxresdefault.jpg"
sources:
  - title: "support.audacityteam.org"
    url: "https://support.audacityteam.org/basics/recording-desktop-audio"
postCta:
  text: "Need more help with Audacity? Our {page} offers detailed tutorials and updates to enhance your audio editing skills. Learn more and get expert advice."
  pagePath: "/en/audacity/"
  pageTitle: "Audacity Tutorials"
---

<!-- kwm:article:start -->
## Setting Up Desktop Audio Recording in Audacity

Recording audio that is playing directly from your computer—such as a video call, a web browser, or a software application—is a common requirement for many creators. In Audacity, this process involves configuring the software to "listen" to your system's output rather than an external hardware input like a microphone. 

While recording desktop audio is possible on various operating systems, the method varies significantly. This guide focuses specifically on Windows users; recording desktop audio on Mac or Linux is considerably more complex and falls outside the scope of this tutorial.

## Configuring the Audio Host for Windows WASAPI

The first step in capturing system sound is changing how Audacity interacts with your audio hardware. By default, Audacity may be set to a host that only recognizes physical inputs. To capture internal sounds, you must use the Windows Audio Session API (WASAPI).

To do this, navigate to **Audio Setup > Host** and select **Windows WASAPI**. 

Changing the host to WASAPI allows Audacity to access the "loopback" functionality of your sound card. In simple terms, loopback tells the computer to route the audio that is intended for your speakers back into the recording software.

## Selecting the Correct Loopback Device

Once you have switched the host to Windows WASAPI, you will notice a change in your available recording devices. Your standard playback devices (your speakers or headphones) will now appear in the recording devices list, but they will be labeled with the suffix **"(loopback)"**.

These loopback devices essentially treat your speakers as if they were a microphone. To ensure you are capturing the correct audio stream, you must select the device that matches your current system output. 

If you are unsure which device is currently active, you can verify this through your Windows system settings:
1. Click on the **speaker icon** in your system tray.
2. Access the secondary speaker/volume menu to see which output device is currently selected by Windows.
3. Return to Audacity and select the corresponding device that has "loopback" attached to its name.

## Adjusting Recording Channels

Before you begin recording, check your channel settings. Because almost all desktop audio outputs are delivered in stereo, you should set your **recording channels to Stereo**. Selecting mono may result in a loss of audio data or an unbalanced recording, as it would not accurately represent the stereo output of your system.

## Understanding Recording Behavior

It is important to note that recording desktop audio via WASAPI behaves differently than recording from a microphone. When you hit the record button, you may notice that the recording cursor does not move and no waveform appears immediately. 

This is by design. Audacity is currently in a waiting state; it will only begin capturing data once there is an actual audio signal being played through your system. Once you start playing a file or a video, Audacity will begin recording. Similarly, if the audio stops playing, the recording process effectively pauses until sound resumes.

## Enabling Continuous Recording and Overdubbing

In some scenarios, you may want to record continuously without the recording stopping when the source audio pauses. To achieve this, you need to adjust your track configuration and transport settings.

First, remove any existing tracks that are causing issues and add a new track specifically for the recording. Then, ensure that **Overdub** is enabled by navigating to **Transport > Transport Options**. Overdub is typically enabled by default, but verifying this setting ensures that Audacity handles multiple audio streams correctly.

A critical requirement for continuous recording is ensuring that your **playback device and recording device are identical**. If these two settings are mismatched, Audacity may trigger a cryptic error—such as error -9997—or exhibit other undesirable behavior. When the devices match, the software can maintain a steady stream of desktop audio without interruption.

## Troubleshooting Sample Rate Errors

If you encounter error messages despite having the correct host and devices selected, the issue is likely a mismatch between your project's sample rate and your hardware's sample rate.

To resolve this, you must align the values in both Audacity and Windows:
1. **In Audacity:** Go to your audio settings and locate the **project template**. Note the current sample rate (for example, 44.1 kHz).
2. **In Windows:** Click the **speaker icon**, go to **more volume settings**, and find the properties for the speaker device you are using. Check the "Advanced" tab or the general properties to see the default format/sample rate.

If the Windows system is set to 44.1 kHz but Audacity is set to 48 kHz (or vice versa), an error will occur. Adjust the project rate in Audacity to match the value found in your Windows settings.

Regarding the **sample format**, this setting is generally less critical for the recording process itself. It is recommended to leave this at **32-bit float** within Audacity, as this is the native format used by most of the software's internal effects and processing tools.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transcript

To record desktop audio in Audacity, go to Audio Setup > Host and set the host to Windows WASAPI. In the case of Mac or Linux, it's a lot more complicated, and I will not be covering it in this tutorial. 

Once you've done that, you will find that your playback devices are now also present in the recording devices section, but now with "loopback" behind them. These are your speakers, but now acting as a microphone, and you should select the one that matches your actual output. If you're not sure what the correct choice is, you can go down here to the speaker icon and then this other speaker icon; here it will have selected the appropriate choice that you now have to choose in Audacity as well—except, of course, with "loopback" behind it. 

Additionally, in the recording channels, select stereo, as all of these outputs are stereo. If you now hit record, you will see that not much is happening; this is by design, as it is now waiting for input. So, if you now play back some audio, it will start recording this audio for you, and if you stop this audio, then you will also stop recording. 

If you instead want to continuously record audio, what you have to do is first remove this and then add another track in addition to the track that you want to record into. Make sure that under Transport > Transport Options, you have "Overdub" enabled (it is enabled by default). Additionally, make sure that your playback device is the same as your recording device. If they are mismatched, what will happen instead is that you will get some sort of cryptic error like -9997 or some other undesirable behavior. But if these two are the same, it now records your desktop audio, and if I now start playing the file again, you will see that it just works continuously.

If you run into some other error messages at this point, what you have to do instead is go to your audio settings, and here you will find the project template. This sample rate you can match with your audio devices, which you can then find again in the speaker icon > more volume settings. Here, for your speaker in question, you will find the appropriate value; in my case, it's 44.1 kHz, which matches my project rate. Incidentally, the sample format is not important and you generally should leave it at 32-bit float in Audacity, as that's the format that all the effects are using as well.

This is all I have for you in this tutorial. If you have any questions, you can ask them in the Discord or the forum. To see an updated version of this guide, check the link in the description. And with that, take care and goodbye!
<!-- kwm:transcript:end -->
