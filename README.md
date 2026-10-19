# Hoxjad Clips (website)
Paste a link or upload a video, set clip count, length and prompt. The server downloads it (yt-dlp), transcribes (Whisper), AI picks and scores clips (Claude), and ffmpeg cuts 9:16 MP4s with burned-in captions.

## Deploy (Railway, Render or Fly: use the Dockerfile)
Environment variables:
- OPENAI_API_KEY (Whisper)
- ANTHROPIC_API_KEY
- ACCESS_CODE (optional password for the site, recommended)
- MAX_CLIPS (default 100), CLAUDE_MODEL (default claude-sonnet-5-5), DATA_DIR (mount a volume at /data)
Run locally: install ffmpeg and yt-dlp, `npm install`, set the keys, `npm start`.

## Notes
- Whisper accepts about 25 MB of audio, roughly 1.5 hours here. Longer videos need audio splitting.
- Only clip content you own or have permission to use. Some sites block downloads from cloud servers.
- Jobs are kept in memory and files are never deleted automatically: add cleanup and a queue before many users.
