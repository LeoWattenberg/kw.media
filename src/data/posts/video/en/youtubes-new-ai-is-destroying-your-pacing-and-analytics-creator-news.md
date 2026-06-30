---
id: 3101
slug: "youtubes-new-ai-is-destroying-your-pacing-and-analytics-creator-news"
path: "/youtube-tips-en/youtubes-new-ai-is-destroying-your-pacing-and-analytics-creator-news/"
title: "YouTube's new AI is destroying your Pacing & Analytics | Creator News"
excerpt: "We're starting today with an open source escape route from the Adobe subscription trap. YouTube is testing an AI that fast forwards viewers through your videos destroying your pacing."
date: "2026-04-11T12:15:07"
modified: "2026-04-11T12:15:07"
locale: "en"
categoryIds: [18]
postType: "news-video"
image: "https://i.ytimg.com/vi/S_Qwsk7CKB0/maxresdefault.jpg"
authorName: "Martin Koytek"
sourceUrl: "https://www.youtube.com/watch?v=S_Qwsk7CKB0"
video:
  youtubeId: "S_Qwsk7CKB0"
  embedUrl: "https://www.youtube.com/embed/S_Qwsk7CKB0"
  watchUrl: "https://www.youtube.com/watch?v=S_Qwsk7CKB0"
  thumbnailUrl: "https://i.ytimg.com/vi/S_Qwsk7CKB0/maxresdefault.jpg"
---

## Transcript

We're starting today with an open source escape route from the Adobe subscription trap. YouTube is testing an AI that fast forwards viewers through your videos destroying your pacing. And we look at the theoretical exploits to bypass YouTube's new courses attachment limits. Here are the creative views of the week. Let's go. A couple of weeks ago, we briefly talked about Adobe's new Project Moonlight AI co-worker. And as always, I told you guys to not getting locked into their expensive subscription ecosystem.

Well, obviously, there were questions like from Manini who asked on her that video for good alternatives to Adobe Photoshop. And of course, there is like Photopea, which is a website you can go to and it is a free to use Photoshop if you want to frame it like that, but it's not fully open source. And usually, open source is the better alternative long-term. And I know a lot of people disagree with that, but hear me out. So, my recommendation here is getting PhotoGIMP.

It is a patch or plugin or add-on or whatever you want to call it for which is in itself open source, and you can download it from the repository on GitHub. And the overhaul changes the entire UI of the shortcuts and the layout and everything to mimic Photoshop. So, it would definitely lower the learning curve getting into if you are making the switch from Photoshop.

However, if you grew up with Adobe Firefly fixing your errors on a whim, you might actually need to relearn how to use an image manipulation program from the ground up. And well, I've linked you the GitHub repo in the description if you want to try it out. And by the way, if you have specific workflow questions like Manini did here, just drop them in the comments and I'll pick them up if I see a fitting time for it. All right, let's move over to YouTube.

And we have to look at a feature that sounds great for viewers, but might be an actual nightmare for content creators and in fact, our analytics. Until April 27th, YouTube Premium users on Android and iOS can test a new experimental feature called Auto Speed on English videos. With Auto Speed, the app automatically adjusts your playback speed. Duh. It speeds up when the creator speaks slowly or takes a pause and is supposed to slow down to normal speed when the information density is too high.

Now, if a creator is just rambling for 5 minutes without getting to the point, this can be great for the viewer. But, effectively doing the editing work the creator was lazy to do is a double-edged sword because it also overrides the creator's creative vision, which is pacing, dramatic pauses, comedic timing, and all of that gets flattened by an algorithm that is optimizing for information density. And that's not even what I'm worried about most here. How's the strength on the back end? Will it affect recommendations?

If a viewer watches 50% of your video on 1.5x speed, your absolute average view duration, AVD, and the user session time will go down. Does the algorithm register this lower session time as a negative signal? And furthermore, if a video is frequently auto sped by the audience, does YouTube internally flag that content as boring or suboptimal? If YouTube doesn't adjust the back end to weigh these metrics correctly, this feature could completely wreck the recommendation algorithm for slower, methodically paced content. Let me know in the comments what you think about it.

Staying on the platform but moving on to an educational content, I got a notification by YouTube Studio the other day for files being able to be attached to videos that are part of the YouTube Courses playlist. Also, shout-out to the known issues list right below it, and they have apparently this week a lot of them. Well, if you have a YouTube Courses playlist, you can now attach up to five PDFs file per video directly to the videos via the video elements tab. Now, why only PDFs?

Because these PDFs have to be hosted on Google Drive, and Google Drive's automated malware scanners are already built for scanning the structure of a PDF for viruses. It doesn't help all the time, especially if they are like password protected or something like that, but to save development resources, they don't want you to upload shady executable files directly to YouTube because that would mean they would have to build a separate scanner for it.

As someone that breaks the platform on a regular basis, and shout out to the YouTube devs watching, I love you guys and you always get my feedback on stuff, and I can't let that sit on its own. So, technically, as a thought experiment, the limitation to PDF is a mere speed bump. You could easily bypass this restriction using a method called base 64 encoding.

So, what that does is you can take a DaVinci Resolve preset or a zip file and convert the binary data of that file into a long string of regular text. You could then take the text and put it in a PDF. You can upload the PDF to a Google Drive scanner, and that would see a harmless PDF full of text and will likely approve it. You can then let viewers download that, run it through a base 64 decoder, and get the original file back.

Of course, that is just a thought experiment, and we totally didn't build a tool internally this week to test this, and it works flawlessly. Anyway, before you get your hopes up, we are obviously not releasing that tool to the public, and I strongly advise against building one yourself to share files on YouTube that are outside the parameters given in the help article. Obfuscating files to bypass a security scanner sounds like a straight way into a spam, scam, and deceptive practices termination, and that's why I'm not showing it on screen, either.

Stick to the standard PDFs for your courses, but honestly, YouTube, I have to raise my finger here. Make it make sense. If anyone with access to a somewhat incompetent LLM manages to bypass the limitation within 30 minutes of trial and error, why are you artificially trying to restrict the uploads to only PDFs? Why not natively allow images or audio files or project files for DaVinci or presets for Lightroom or whatever?

If a bad actor really wants to distribute malware, they are just using the exploit we just discussed, or they just host it as a Google ad because there's no filter in those either. This PDF-only rule is an arbitrary speed bump that doesn't really stop scammers, but hurts actual legitimate educational content creators sharing actual working files with their students. So, in my opinion, YouTube should lift the PDF-only rule.

But maybe I'm too optimistic and I don't see an attack vector that they are doing and but yeah, how are you folks feeling about it? Let me know in the comments below. Finally, a quick B2B update. YouTube has updated the native media kit feature in the YouTube studio. It was formerly part of the brand connect feature set and it got separated out a couple of months back, so everyone that is a YouTube partner can now pull their media kit and send it to sponsors.

This media kit now includes the data for income brackets and parental status of your audience. Is this a nice to have? Sure. Will this be the deciding factor in your sponsorship negotiations going forward? Probably not. In my experience, brands care more about the core demographics, so age and gender, as well as the integration concept. So, how are you actually going to do the ad read and how is it integrated into the rest of your video?

So, whether you have 35 or 30% of your audience as parents is rarely a deal-breaker, but it does make the pitch deck look a little bit nicer, so it's it's a nice to have. Anyway, that's all for week. I want to know from you, how do you feel about the auto speak feature? Is it a helpful tool for viewers or is it an insult to video creators? Let me know in the comments below. I'm Martin bringing you the relevant creator news and I'll see you next week.
