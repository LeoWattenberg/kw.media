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
image: "https://i.ytimg.com/vi/VB0-XfW6lms/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=VB0-XfW6lms"
video:
  youtubeId: "VB0-XfW6lms"
  embedUrl: "https://www.youtube.com/embed/VB0-XfW6lms"
  watchUrl: "https://www.youtube.com/watch?v=VB0-XfW6lms"
  thumbnailUrl: "https://i.ytimg.com/vi/VB0-XfW6lms/maxresdefault.jpg"
---

## Transcript

To record desktop audio in Audacity, go to Audio Setup > Host and set the host to Windows WASAPI. In the case of Mac or Linux, it's a lot more complicated, and I will not be covering it in this tutorial. 

Once you've done that, you will find that your playback devices are now also present in the recording devices section, but now with "loopback" behind them. These are your speakers, but now acting as a microphone, and you should select the one that matches your actual output. If you're not sure what the correct choice is, you can go down here to the speaker icon and then this other speaker icon; here it will have selected the appropriate choice that you now have to choose in Audacity as well—except, of course, with "loopback" behind it. 

Additionally, in the recording channels, select stereo, as all of these outputs are stereo. If you now hit record, you will see that not much is happening; this is by design, as it is now waiting for input. So, if you now play back some audio, it will start recording this audio for you, and if you stop this audio, then you will also stop recording. 

If you instead want to continuously record audio, what you have to do is first remove this and then add another track in addition to the track that you want to record into. Make sure that under Transport > Transport Options, you have "Overdub" enabled (it is enabled by default). Additionally, make sure that your playback device is the same as your recording device. If they are mismatched, what will happen instead is that you will get some sort of cryptic error like -9997 or some other undesirable behavior. But if these two are the same, it now records your desktop audio, and if I now start playing the file again, you will see that it just works continuously.

If you run into some other error messages at this point, what you have to do instead is go to your audio settings, and here you will find the project template. This sample rate you can match with your audio devices, which you can then find again in the speaker icon > more volume settings. Here, for your speaker in question, you will find the appropriate value; in my case, it's 44.1 kHz, which matches my project rate. Incidentally, the sample format is not important and you generally should leave it at 32-bit float in Audacity, as that's the format that all the effects are using as well.

This is all I have for you in this tutorial. If you have any questions, you can ask them in the Discord or the forum. To see an updated version of this guide, check the link in the description. And with that, take care and goodbye!
