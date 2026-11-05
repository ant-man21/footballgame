# footballgame

Top-down, vertical, pixel-art football game for phone and laptop (browser / installable web app).

## Current prototype: 11 on 11 passing
- Pick a play from the **playbook** (opens on launch; **PLAYS** button between snaps). Plays stay picked so you can rep them against different defenses.
- **Tap to snap.** Then touch and drag to draw the throw arc; release to throw. The QB stays in the pocket.
- The ball lands at the end of the arc: receiver there = **catch**, defender there = **interception**, nobody = **incomplete**. Contested balls usually go to the receiver; a defender needs real position to pick it off.
- Hold it too long and the rush gets home: **sack**.
- After each play the banner shows the defense you faced (e.g. `COVER 3 / 4-MAN RUSH`) so you can learn to read it.
- Two control schemes; tap **MODE** to switch: **PULL** (slingshot, finger never covers the target) and **AIM** (landing spot under your finger).

### Defense
Picked at random each snap. Linemen block, rushers try to beat their block; spare linemen double-team, and anyone not picked up comes free.

| Call | Rush | Coverage |
|---|---|---|
| Cover 0 | 6-man blitz | all-out man, no deep help |
| Cover 1 | 4 or 5 | man + a deep safety (+ a robber on 4-man) |
| Cover 2 | 3 or 4 | zone: 2 deep halves, 5 underneath |
| Cover 3 | 4 or 5 (fire zone) | zone: 3 deep thirds, 3-4 underneath |
| Cover 4 | 3 or 4 | zone: 4 deep quarters, 3-4 underneath |

### Playbook
| Category | Play | Good against |
|---|---|---|
| QUICK | Slant Flat | blitz |
| QUICK | Curl Flat | zone |
| CORE | Mesh | man |
| CORE | Smash | Cover 2 |
| SHOTS | Four Verts | Cover 3 |

Adding a play is data only: add it to `src/playbook/plays.ts` (routes come from `src/playbook/routes.ts`, alignments from `src/playbook/formations.ts`). The menu and its play art pick it up automatically. New categories go in `CATEGORIES`.

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
- `src/config.ts`: resolution (180x320, scaled up crisp), field scale, game-feel tuning
- `src/sim.ts`: the on-field simulation (routes, pass rush and blocking, man/zone coverage, catches); no drawing, so tests can step it
- `src/defense/calls.ts`: defensive alignment, zones, and the coverage/rush calls
- `src/playbook/`: routes, formations, plays and categories
- `src/game.ts`: input, aiming, field/HUD drawing
- `src/menu.ts`, `src/playart.ts`: the playbook menu and its play diagrams
- `src/sprites.ts`, `src/font.ts`: pixel-art sprites and the 3x5 bitmap font
- `src/main.ts`: canvas + pointer (touch/mouse) input
