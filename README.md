# cki-about — the CKI / Clay & Kelsy About page

Instant-loading editorial About page (Courier-Prime mono + EB Garamond + Petit Formal
Script), upgraded from `cki-about.html` with a live three.js layer and playful interactions
— all built to paint text first and never block load. Clone of the site's `experience-i-am`
"instant three.js" pattern (no GLB, no post stack).

Live: `https://clayburton.github.io/cki-about/` · Preview: launch config `cki-about`, port **8852**.

## What's on the page
- **Intro + two bios** (Clay Burton she/her, **Kelsy Burton** she/they) with their real portraits.
- **Drifting pollen** — three.js `Points`, one draw call, screen-space shader. Mauve on the
  white page, shifts to warm ember-dust as the page descends to black. Leans toward the cursor.
- **Spotlight cursor + hidden eggs** — a soft `mix-blend-difference` lens follows the pointer;
  hidden lyric fragments (`i am`, `moving on`, `the descent`, …) live in the outer margins and
  are revealed only inside the lens (radial mask, same radius as the lens). Desktop ≥1080px only;
  on touch the lens idle-drifts on a lissajous. Eggs are clamped into the true margins so they
  never sit on the text column.
- **Playable "pretty wave" divider** — the pink rule is an oscilloscope you can pluck/drag; it
  bends the wave and plays a soft pentatonic note (WebAudio, **silent until first click** — audio
  off by default). Doubles as the reactive-waves signature.
- **Bio photos bloom on hover** — flower-style glow + fresnel rim, name turns rose, the other bio recedes.
- **Reactive "pretty waves" text** — the script words ripple on hover.
- **Scroll into black (The Descent)** — the page fades white→black as you reach the "Act I: 'I am'"
  doorway; the Greek inscription glows and hover/tap reveals its translation (localized); then the
  `Experience I Am →` button links to the hub (`/i-am/`, `target=_top`). iOS status bar strobes with it.

## Files
- `index.html` (fonts + importmap pinned to three@0.185.1 jsDelivr — same URL as i-am-home for a
  warm CDN cache hit; `?v=N` cache-busters — **bump after every edit**)
- `styles.css` · `app.js` (debug: `window.__about` — `renderOnce(t)`, `spotAt(x,y)`, `probe()`, `eggs()`)
- `wordpress-embed.html` — full-bleed auto-growing iframe block. Feeds the page scroll into the
  iframe (the descent tracks the real scroll) and repaints the parent for the iOS bars.

## Deploy
1. `git init` the folder, `gh repo create Clayburton/cki-about --source=. --push` (pushes **private** —
   the safety layer blocks `--public`).
2. **User:** make the repo **public**, then enable Pages (Settings → Pages → branch `main` `/root`).
3. Paste `wordpress-embed.html` into a Custom HTML block on the About page (`/aboutus/`), replacing the
   current text blocks.

## Notes / gotchas
- **three.js custom `Points` shader:** the geometry's `position` attribute must be **vec3** (three
  auto-injects `attribute vec3 position`); reading it as vec2 fails to compile → zero pixels. Set
  `frustumCulled=false` when rendering with a bare/identity camera.
- **Pollen uses `NormalBlending`** — additive is invisible on white paper.
- **No `vh` in the CSS** — the embed iframe auto-grows in height, and vh would feedback-loop.
- The preview pane reports `innerWidth:0` during JS eval and pauses rAF; verify canvases with
  `__about.renderOnce()` / `probe()` and mobile emulation, not desktop screenshots after a scroll.
