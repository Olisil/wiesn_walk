# Wiesn Walk

A free browser game by [Nassau](https://www.nassau.se/products): walk the Munich Wiesn at golden hour, step into Festhalle Sonnenwirt, sway to the waltz and drink your way to a high score.

Plain HTML + JS in `public/`, served by Astro on Webflow Cloud (same setup as Intus).

- `public/game.js`: the game (three.js r158, loaded from `public/lib/three.min.js`)
- `public/data/trachten.json`: the Bursch, Madl and Kellnerin characters exported from Blender (meshes in three detail levels, skin weights, glass fill heights, baked bone matrices for every animation)
- `public/controls.js`, `public/gyro.js`: the Intus touch joystick, start-screen pictures and look-by-moving-the-phone
- `src/pages/index.astro`: the page; `<base>` follows the Webflow Cloud mount path
- `tools/trachten/`: the Blender (bpy) scripts that build the characters, their animations and `trachten.json`: `python3 build_all.py --save`

## Run locally

```
npm install
npm run dev
```

## How to play

- You start with a full Maß. Prost! (P, or the Prost! button) takes a sip: a fifth of the glass and 10 points.
- After five sips the glass is empty and you leave it on the floor.
- Kellnerinnen carrying armfuls of Maß walk between the tables in Festhalle Sonnenwirt. Walk up to one: she stops and you take a fresh Maß for 50 points. While your glass is empty, the radar marks them.
- Every sip adds to the Rausch: the walk drifts, steering wanders and now and then you nearly lose your balance.
- The band still plays Ein Prosit every minute or so, and the whole tent drinks with it.

## Controls

- Desktop: WASD to walk, Shift to run, mouse to look, V to switch view, P to drink (Prost!), M for sound, F for full screen, Esc to pause
- Phone and tablet: joystick in the lower-left corner (push to the edge to run), drag anywhere else to look, tilt button to look by moving the phone, Prost! button to drink

## Credits

- Ein Prosit der Gemütlichkeit: Bernhard Dittrich, 1898 (public domain), arranged and synthesized in the browser
- Fonts: UnifrakturMaguntia, Grenze Gotisch, Grenze (SIL Open Font License, via Google Fonts)
- three.js: MIT licence, see `public/lib/three-LICENSE.txt`
