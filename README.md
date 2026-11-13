# Wiesn Walk

A free browser game by [Nassau](https://nassau.se/apps): walk the Munich Wiesn at golden hour, step into Festhalle Sonnenwirt, sway to the waltz and raise your Maß at the Prosit.

Plain HTML + JS in `public/`, served by Astro on Webflow Cloud (same setup as Intus).

- `public/game.js`: the game (three.js r158, loaded from `public/lib/three.min.js`)
- `public/data/trachten.json`: the Bursch and Madl characters exported from Blender (meshes in three detail levels, skin weights, baked bone matrices for every animation)
- `public/controls.js`, `public/gyro.js`: the Intus touch joystick, start-screen pictures and look-by-moving-the-phone
- `src/pages/index.astro`: the page; `<base>` follows the Webflow Cloud mount path

## Run locally

```
npm install
npm run dev
```

## Controls

- Desktop: WASD to walk, Shift to run, mouse to look, V to switch view, P for Prosit, M for sound, F for full screen, Esc to pause
- Phone and tablet: joystick in the lower-left corner (push to the edge to run), drag anywhere else to look, tilt button to look by moving the phone, Prost! button for Prosit

## Credits

- Ein Prosit der Gemütlichkeit: Bernhard Dittrich, 1898 (public domain), arranged and synthesized in the browser
- Fonts: UnifrakturMaguntia, Grenze Gotisch, Grenze (SIL Open Font License, via Google Fonts)
- three.js: MIT licence, see `public/lib/three-LICENSE.txt`
