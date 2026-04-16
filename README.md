# Tabata Timer (PWA)

Configurable Tabata interval timer for iPhone/iPad. Zero dependencies, zero
build step, works offline once installed.

## Features

- Configurable: tabatas/set, sets, work sec, rest sec, between-set rest
- Voice cues: "Set 1 of 8", "Rep 3, work", "Rest"
- 1 Hz click during 3 s initial prep and last 5 s of each work interval
- Air-horn at workout completion
- Pause / Skip / Stop
- Named presets (saved in localStorage)
- Visual: big digit + progress ring, green for WORK, red for REST
- Screen wake lock (iOS 16.4+)
- Installable to home screen (standalone, no Safari chrome)
- Offline via Service Worker

## File layout

```
index.html                top-level UI
style.css                 all styles
js/app.js                 UI wiring, wake lock, SW registration
js/workout.js             state machine + phase scheduler
js/audio.js               Web Audio synthesis + SpeechSynthesis wrapper
js/storage.js             preset + last-used persistence
manifest.webmanifest      PWA metadata
sw.js                     cache-first service worker
assets/
  icon.svg                source icon
  make-icons.html         open in a browser to generate PNG icons
  icon-192.png            (generate me)
  icon-512.png            (generate me)
  icon-512-maskable.png   (generate me)
```

## First-time setup

1. Generate PNG icons: open `assets/make-icons.html` in any browser, click
   each download button, save the three PNG files into `assets/`.
2. Init a git repo and push to GitHub.
3. In the repo's **Settings → Pages**, set source = `main` branch, `/` root.
4. Wait ~1 min; open the `https://<you>.github.io/<repo>/` URL on your iPhone
   in Safari.
5. Share → **Add to Home Screen**. Launch from the icon.

## Local development

```
# Any static server works. Two easy options on Windows:
python -m http.server 5500
# or use the "Live Server" VSCode extension.
```

To test on the iPhone over your LAN: find your PC's IP (`ipconfig`) and open
`http://<pc-ip>:5500` in Safari. A few APIs (Wake Lock, Service Worker
install) require HTTPS — easiest fix is **ngrok**:

```
ngrok http 5500
```

Open the generated `https://xxxx.ngrok-free.app` URL on the iPhone.

## iOS-specific notes

- **Audio unlock:** the Start button *must* be what first calls
  `AudioContext.resume()` and speaks a silent utterance. Both are handled in
  `app.js` on the Start tap. Programmatic calls from timers won't work.
- **Wake Lock:** only available iOS 16.4+. Silently no-ops on older versions.
- **Voices:** `speechSynthesis.getVoices()` may return empty on first call.
  The TTS warmup in `audio.js` handles this.
- **Home-screen vs Safari:** installed PWA has its own storage; presets saved
  in Safari won't appear after installing (and vice versa). Save presets
  from the installed app.

## Configuration defaults

| Field              | Default | Range  |
| ------------------ | ------- | ------ |
| Tabatas per set    | 6       | 1–30   |
| Sets               | 8       | 1–30   |
| Work seconds       | 20      | 5–120  |
| Rest seconds       | 10      | 3–120  |
| Set-rest seconds   | 30      | 5–600  |

## License

Personal use; do what you want.
