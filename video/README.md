# Sound Carvers — vídeo tutorial

A ~1:24 pt-BR tour of the Sound Carvers setlist app for the band, built with Remotion.

Run everything below from this `video/` folder (`npm install` first).

- `npm run dev` — Remotion Studio (preview and edit).
- `npx remotion render Tutorial out/sound-carvers-tutorial.mp4 --crf=20` — export the MP4.

## Structure

- `src/Tutorial.tsx` — scene order and lengths (`TransitionSeries`, 0.5 s crossfades).
- `src/scenes.tsx` — one component per scene: captions, which screenshots, camera moves and highlights.
- `src/components/Screen.tsx` — screenshot viewport with a virtual camera (`{at, x, y, zoom}` keys) and highlight marks.
- `public/shots/*.png` + `public/boxes.json` — screenshots of the real app and the rects of key elements, both produced by the capture script.

## Re-capturing screenshots

The screenshots come from a throwaway copy of the app with demo data (real member names, demo songs):

```bash
node capture/capture.mjs            # all shots (set CHROME_PATH if Chrome isn't in Playwright's cache)
node capture/capture.mjs public/shots 11   # only shots whose name starts with "11"
```

`capture/run-server.sh` starts the app from the repo root (build it first with `npm run build` there) on 127.0.0.1:18791
with a fresh copy of `capture/demo-data` every run, so the "everyone says Domino" step can be repeated.
To rebuild the demo data from scratch, start the server on an empty data dir and run `capture/seed.mjs`
then `capture/fix.mjs` (needs internet for Deezer/Spotify lookups).
