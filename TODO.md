* Normalize the converter interfaces:
    * When accessing a converter via a virtual page, the title should be replaced by the virtual tool's title, and the eyebrow should become the converter name. The output format also should be pre-selected to be the one desired by the virtual page. 
    * After hitting "convert", the converted file should be shown in place of the original. A toggle to switch between the original and the converted file in-place should be present.
    * Pandoc outputs should be rendered accordingly (pdf.js, mathjax, etc.)
    * The layout should have the input/output on the left, and a toolbar on the right. On mobile, the toolbar becomes a drawer. 
* Add a new local AI script that gives tools an SEO-friendly description. Add a description field below the converter. 

* Add more tools: 
    * whisper.cpp speech-to-subtitle
    * YouTube Shorts/Tiktok/Reels previewer: Shows safe zones so overlays and subtitles don't get buried
    * Subtitle burner: Burns in subtitles into the video, acknowledging safezones. Inputs user-choice or whisper.cpp. Styling options, including single-word, multi-word with syllable-by-syllable appearance/highlighting. 
* Investigate feasibility of the following ideas for this environment:
    * chromaprint wasm for songID
    * voice denoiser (deepfilternet3, RNNoise)
    * image/video Upscaler via webGPU. More generally, in-browser local AI workflows on github pages
    * Perceptual quality checkers for images, videos and audio (PSNR, VMAF, etc). Followup tool: Bitrate optimizer to a certain quality
    * multi-camera sync based on audio data
    * video stabilization
* Implement above ideas as tools if feasible. Use existing WASM implementations, creating new ones is out-of-scope here.

Make atomic commits. Re-check this TODO for completeness before finishing work.