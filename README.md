# footballgame

Top-down, vertical, pixel-art football game for phone and laptop (browser / installable web app).

## Current prototype: QB throwing
- The QB stands still. Touch (or click) and drag to draw the throw arc; release to throw.
- The ball lands at the end of the arc. A receiver there makes the **catch**; a defender makes the **interception**; nobody there means **incomplete**.
- Receivers keep running their routes while the ball is in the air, so lead them.
- Two control schemes to compare; tap **MODE** (bottom right) to switch:
  - **PULL**: slingshot. Drag *away* from where you want to throw; longer pull = longer throw. Your finger never covers the target.
  - **AIM**: the landing spot follows your finger.

## Develop
```sh
npm install
npm run dev        # http://localhost:5173 (also on your LAN, for testing on a phone)
npm run build      # type-check + production build into dist/
```

Smoke test (touch input on an emulated phone, needs Playwright + Chromium):
```sh
npm run build && npx vite preview --port 4173 &
npm run test:smoke
```

## Play on your phone
Pushes to `main` deploy to GitHub Pages (enable it once: repo **Settings → Pages → Source: GitHub Actions**).
Open the page on your phone, then *Add to Home Screen* for full-screen play.

## Code map
- `src/config.ts`: resolution (180x320, scaled up crisp), field layout, throw tuning
- `src/game.ts`: players, routes, coverage, throw arc, catch/interception rules, rendering
- `src/sprites.ts`: pixel-art sprites as character maps
- `src/font.ts`: 3x5 bitmap font
- `src/main.ts`: canvas + pointer (touch/mouse) input
