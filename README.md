# Surge Rider 3D

A jetski arcade game in the browser, built with [three.js](https://threejs.org).


**[Play it now](https://howtoaicontent.github.io/ijustwannajetski/)**

## What keeps you riding

- **Stars** you collect are banked after every run.
- **Garage**: spend stars on new skis and rider outfits (press `G`, or tap GARAGE).
- **Daily missions**: three new goals each day, plus a bonus for playing on consecutive days.

Progress is saved in the browser.

## Play locally

    npm install
    npm start

`npm run build` writes the whole game to one file, `dist/index.html`. That file also runs when opened directly from disk.

## Publish on GitHub Pages

1. Push this folder to a GitHub repository (branch `main`).
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` builds the game and publishes it (see `.github/workflows/pages.yml`).

## Project layout

- `src/game.js` – all game code (rendering, physics, spawning, HUD, audio)
- `template.html` – page shell, loading screen and touch buttons
- `build.mjs` – bundles `src/game.js` and three.js into `dist/index.html`

## Controls

| Key | Action |
| --- | --- |
| ← → / A D | Steer, spin in the air |
| ↑ / W | Full throttle |
| ↓ / S | Brake (hold to stop) |
| Space / Shift | Nitro |
| C | Chase / helmet camera |
| G | Garage (from the menu or game over) |
| Q | Graphics quality (low, medium, high) |
| F | Fullscreen |
| P | Pause |
| M | Mute |

Tuning values worth knowing in `src/game.js`: `INTRO` (length of the easy warm-up stretch), `spawnRow` (what appears and how far apart), `QUAL` (graphics quality levels), `SKIS` / `RIDERS` (garage items and prices), `MTYPES` (daily mission targets).
