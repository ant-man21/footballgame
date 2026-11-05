# footballgame

Top-down, vertical, pixel-art football game for phone and laptop (browser / installable web app).

## Current prototype: 11 on 11 passing drives
- Pick a play from the **playbook** (opens on launch; **PLAYS** button between snaps). Plays stay picked so you can rep them.
- **One touch does it all:** touching the screen snaps the ball and starts the aim; drag to draw the throw arc, release to throw.
- **Drives:** start at your own 25, 1st & 10. Real yard lines and numbers, a yellow first-down line, downs and distance, touchdowns, turnovers on interceptions or on downs. The field scrolls, so the end zone only shows up when you're close.
- The ball lands at the end of the arc; whoever is there when it comes down decides it. Contested balls get harder the longer the ball hangs. While you aim, a **landing oval** shows where the ball will come down: tiny on short throws, stretched along the throw line on bombs, bigger (orange) with a rusher in your face. The ball always lands inside it.
- **Lead your receivers:** throw to where he's going; the receiver the ball is meant for runs under anything he can reach in time.
- **Run after the catch:** the receiver keeps running until tackled, pushed out, or in the end zone; defenders take pursuit angles, other receivers get in their way, and he breaks the odd tackle.
- Hold it too long and the rush gets home: **sack**.
- After each play the banner shows the result, yards, and the defense you faced (e.g. `COVER 3 - 4-MAN RUSH`).
- Top bar: down & distance, field position, and TDs / yards per play / plays per TD.
- Two control schemes; tap **MODE** to switch: **PULL** (slingshot, finger never covers the target) and **AIM** (landing spot just above your finger).

Balance target: 8-15 plays per touchdown, with the short game as the reliable way to move the chains and deep shots as boom-or-bust. A scripted QB that reads coverage and aims with some error gets about 8.4 yards per play and 12 plays per TD; short throws complete ~72% (about 50% success), deep throws ~33%.

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
| QUICK | Stick | Cover 3 |
| QUICK | Quick Outs | soft coverage |
| CORE | Mesh | man |
| CORE | Smash | Cover 2 |
| CORE | Flood | Cover 3 |
| CORE | Y Cross | man |
| CORE | Levels | zone |
| SHOTS | Four Verts | Cover 3 |
| SHOTS | Yankee | Cover 1 |
| SHOTS | Post Wheel | man |

Against three or more wide receivers the defense subs a nickel back in for a linebacker.

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
- `src/sim.ts`: the on-field simulation (routes, pass rush and blocking, man/zone coverage, catches, run after catch); no drawing, so tests can step it
- `src/drive.ts`: field position, downs and distance, and the stat line
- `src/defense/calls.ts`: defensive alignment, zones, and the coverage/rush calls
- `src/playbook/`: routes, formations, plays and categories
- `src/game.ts`: input, aiming, camera, field/HUD drawing
- `src/menu.ts`, `src/playart.ts`: the playbook menu and its play diagrams
- `src/sprites.ts`, `src/font.ts`: pixel-art sprites and the 3x5 bitmap font
- `src/main.ts`: canvas + pointer (touch/mouse) input
