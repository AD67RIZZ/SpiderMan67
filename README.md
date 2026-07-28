# Neon Grapple Rush
Redeploy
**Swing fast. Dash hard. Own the skyline.**

Neon Grapple Rush is an original third-person 3D rooftop race built with Three.js, TypeScript, Vite, cannon-es, and Web Audio. Runners automatically surge through a procedural neon city, swing from energy anchors, wall-run, air-dash, grind rails, collect shards, break drones, and race through checkpoints.

The game includes:

- Offline solo practice and a local interactive tutorial.
- Real 2–8 player WebSocket matches managed by Cloudflare Durable Objects.
- Quick Match and private rooms with short shareable codes.
- Ready-up lobbies, deterministic courses, checkpoints, placement, authoritative results, ping, and reconnection support.
- Keyboard, mouse, and touchscreen controls.
- No accounts, chat, purchases, tracking, external gameplay APIs, or downloaded game assets.

## Project layout

```text
index.html                  Vite entry page
public/runtime-config.js    Deployed multiplayer Worker URL
src/                        Three.js game, UI, audio and networking
worker/                     Cloudflare Worker and Durable Objects
wrangler.jsonc              Multiplayer backend configuration
dist/                       Production frontend output after npm run build
```

The frontend and multiplayer server are deliberately separate:

- Cloudflare Pages serves the static files from `dist`.
- Cloudflare Workers and Durable Objects run the multiplayer WebSocket server.
- Wrangler is only for the multiplayer Worker. It is not used to deploy the Pages frontend.

## Requirements

- Node.js 20 or newer.
- npm.
- A modern browser with WebGL and WebSocket support.
- A free Cloudflare account only when you are ready to deploy online multiplayer.

## Install

From the repository root:

```bash
npm install
```

## Run the frontend locally

```bash
npm run dev
```

Open the Local URL printed by Vite, normally `http://localhost:5173`.

Solo Practice and the tutorial work even when the multiplayer Worker is not running.

## Run local multiplayer

Use two terminals in the repository root.

Terminal 1 — frontend:

```bash
npm run dev
```

Terminal 2 — multiplayer Worker:

```bash
npm run dev:server
```

During Vite development the game automatically connects to `ws://localhost:8787/ws`. You do not need to edit `runtime-config.js` for local testing.

To test with two players:

1. Open the Vite URL in two browser windows.
2. In the first window, choose **Private Room**, then **Create private room**.
3. Copy the room code.
4. In the second window, choose **Private Room**, enter the code, and join.
5. Ready up in both windows.
6. Move each runner and confirm both windows show the other runner moving.
7. Try falling, checkpoint respawning, leaving, and rejoining.

Quick Match also connects players to an available room and creates a room when needed.

## Controls

### Desktop

| Action | Control |
| --- | --- |
| Steer | `A` / `D` or Left / Right Arrow |
| Movement influence | `W` / `S` or Up / Down Arrow |
| Jump | `W` or Up Arrow while grounded |
| Grapple | Hold left mouse button or `Space`; release to detach |
| Air dash | `Shift`, `E`, or right mouse button |
| Pause | `Escape` or `P` |
| Leaderboard | Hold `Tab` |
| Return to checkpoint | `R` |

Right-click inside the game is reserved for dashing, so the browser context menu is disabled over the canvas.

### Mobile

- Drag the large left steering pad.
- Hold the **Grapple** control and release it to detach.
- Tap **Jump**, **Dash**, or **Pause**.
- Landscape orientation is recommended. A rotate-device message appears on narrow portrait screens.

Touch controls use large safe-area-aware targets and prevent page scrolling, pull-to-refresh, text selection, and accidental zoom while playing.

## Build and verify

```bash
npm run check
npm run build
npm run preview
```

`npm run check` checks both the frontend and Worker TypeScript. `npm run build` creates the Cloudflare Pages-ready frontend in `dist`. The expected entry file is:

```text
dist/index.html
```

## Multiplayer configuration

Local Vite development automatically uses the local Worker at:

```text
ws://localhost:8787/ws
```

For production, deploy the Worker first and then edit:

```text
public/runtime-config.js
```

Set the secure Worker URL:

```js
window.NEON_GRAPPLE_CONFIG = {
  multiplayerUrl: "wss://neon-grapple-rush-server.your-subdomain.workers.dev"
};
```

Rebuild the frontend after changing it:

```bash
npm run build
```

Do not put secrets in `runtime-config.js`. The game validates missing or incorrect URLs, displays the real connection state, and keeps Solo Practice available.

## Deploy the multiplayer Worker

Sign in to Cloudflare once:

```bash
npx wrangler login
```

Deploy only the multiplayer backend:

```bash
npm run deploy:server
```

This creates or updates the Worker and its Durable Object classes according to `wrangler.jsonc`. Copy the resulting `https://...workers.dev` address, change `https://` to `wss://`, add it to `public/runtime-config.js`, and rebuild.

> `npm run deploy:server` and `npx wrangler deploy` deploy the multiplayer Worker only. Never enter either command as a Cloudflare Pages deploy command.

## Deploy the frontend with Cloudflare Pages

Push this repository to GitHub, then create a Pages project using Git integration.

Use exactly these settings:

```text
Framework preset: Vite
Build command: npm run build
Build output directory: dist
Root directory: /
Deploy command: leave empty / not applicable
```

The Pages frontend has no Wrangler deployment command and does not use Pages Functions.

## Upload to GitHub

Create an empty GitHub repository, then run these commands from this project root. Replace the example remote with your own repository URL.

```bash
git init
git add .
git commit -m "Build Neon Grapple Rush"
git branch -M main
git remote add origin https://github.com/YOUR-NAME/neon-grapple-rush.git
git push -u origin main
```

Do not commit `.dev.vars`, `.env`, `.wrangler`, or other secret files; they are ignored by `.gitignore`.

## Private room codes

Creating a private room asks the Worker for a new short code. The code selects one Durable Object, which owns that room’s lobby and match state. Names and colours are trimmed and validated, room capacity is eight, and joining is rejected if the code is invalid, the room is full, or the match can no longer accept players.

## How multiplayer works

- The room server owns match phase, countdown, seed, checkpoints, placement, finish order, shared hazard timing, validated score components, and results.
- Multiplayer power-up claims are checked against the deterministic course and player progress; activation and expiry use authoritative server timestamps.
- Clients send compact sequenced movement state at a limited rate instead of sending Three.js objects.
- The local runner is predicted immediately; small corrections are blended rather than snapped.
- Remote runners use buffered snapshots and interpolation.
- The Worker rejects stale, malformed, oversized, implausible, or over-frequent messages.
- A reconnect token allows a disconnected runner to reclaim a place during a short grace period.
- Durable Object alarms and inactivity checks clean up abandoned room state.

## Solo and offline play

Choose **Solo Practice** whenever the server is offline or not configured. It uses the same movement, grapple, course, hazards, checkpoints, scoring, power-ups, settings, audio, and local best-score systems without pretending an online connection exists.

## Troubleshooting

### The game says multiplayer is unavailable

For local play, make sure `npm run dev:server` is running in a second terminal and listening on port 8787. For production, confirm that `public/runtime-config.js` contains the deployed `wss://` Worker URL, then rebuild and redeploy Pages.

### A room code does not work

Check the code for missing characters. The room may also be full, already racing, expired, or cleaned up after being empty.

### The page is blank or reports a graphics problem

Update the browser, enable hardware acceleration, and try again. The game shows a compatibility panel when WebGL is unavailable and recovers gracefully from optional audio or storage failures.

### Audio is silent

Browsers only allow Web Audio after a click or tap. Interact with the menu, then check Master, Music, and Sound Effects volume in Settings.

### Mobile controls do not appear

Touch capability is detected from browser input features. Touch the game once, rotate to landscape, and reload only if the browser attached the touchscreen after the page opened.

### Port 5173 or 8787 is busy

Stop the other program using that port, then rerun the matching command. The configured ports are intentionally fixed so the automatic local multiplayer URL stays predictable.

## Privacy and originality

Neon Grapple Rush uses original procedural geometry, generated materials, a custom low-poly runner, and synthesized sound. It contains no copyrighted character, extracted game asset, account system, chat, advertisement, purchase, analytics SDK, or personal-data collection.
