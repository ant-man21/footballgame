# footballgame

Top-down, vertical, pixel-art football game for phone and laptop (browser / installable web app).

## Start screen
Pick **quarter length** (2 / 3 / 5 / 8 minutes), difficulty, game speed and aim mode, then **KICKOFF**. Pause has **MAIN MENU** to come back here.

## The game
A full game against the CPU: **4 quarters of 3 minutes**, passing only, no kicks.
- **Scoring:** a touchdown is worth 7 (no kicking), then the other team starts at its own 25.
- **Possession changes:** an interception or turnover on downs gives the other team the ball where it ended.
- **4th down:** choose **GO FOR IT** or **PUNT** (punts are simulated: about 40 yards, touchback to the 20).
- **Clock:** it runs during plays, and between plays after a tackle or sack in bounds. Incompletions, out of bounds, scores and turnovers stop it. Possession alternates at halftime, and the final screen shows both teams' stats.

### Between plays
- **The huddle:** before every snap you call your play (offense) or your defense. **SAME PLAY / SAME CALL** repeats the last one; on defense **AUTO** lets the coordinator call it; on 4th down the offensive huddle offers **PUNT** (pick a play to go for it).
- **Clock:** after a catch in bounds or a sack the clock keeps running while you huddle (2.5 game seconds per real second, up to a 25-second play clock shown on the scoreboard), so hurrying up saves time. Incompletions, out of bounds, scores and turnovers stop it. **Two-minute warning** in Q2 and Q4.
- **Timeouts:** 3 per team per half (pips under the score). Call yours from the pause menu; the CPU uses its own late when it's behind.
- **Pause** (top right): resume, timeout, settings, restart game.

### Hashes
The ball is spotted where the last play ended: on the nearest hash if it ended outside the hashes, in between otherwise (incompletions keep the spot; touchdowns and turnovers start in the middle). Inside players and the box move with the ball while wide receivers stay near the numbers, so the short side isn't jammed. Plays automatically point their strong side to the field (the wide side); **FLIP** at the line mirrors the play.

### Your offense
- Pick a play from the **playbook** (opens on launch; **PLAYS** between snaps). Plays stay picked so you can rep them.
- **One touch does it all:** touching the screen snaps the ball and starts the aim; drag to draw the throw arc, release to throw.
- The scoreboard shows the score, quarter and clock, down & distance, and field position, with a yellow first-down line on the field. The field scrolls with field position.
- The ball lands at the end of the arc; whoever is there when it comes down decides it. Contested balls get harder the longer the ball hangs. While you aim, a **landing oval** shows where the ball will come down: tiny on short throws, stretched along the throw line on bombs, bigger (orange) with a rusher in your face. The ball always lands inside it.
- **Lead your receivers:** throw to where he's going; the receiver the ball is meant for runs under anything he can reach in time.
- **Run after the catch:** the receiver keeps running until tackled, pushed out, or in the end zone.
- Hold it too long and the rush gets home: **sack**. After each play the banner shows the result, yards, and the defense you faced.
- Two control schemes; tap **MODE** to switch: **PULL** (slingshot, finger never covers the target) and **AIM** (landing spot just above your finger).

### The defense you face
- Nineteen calls (you can call these yourself on defense), including a QB spy and a simulated pressure: Cover 0, Cover 1 (with and without a blitz or robber), Cover 2, Cover 2 Man, Tampa 2, Cover 3 (and a fire-zone blitz), Cover 4, Cover 6, with 3- to 6-man rushes.
- It lines up to your formation (flat defenders over the slot, linebackers sliding to the strength), and man defenders vary their technique snap to snap: inside or outside leverage, press or off. Read it before the snap: outside leverage leaves the slant, off coverage leaves the hitch.
- The safeties show a shell (one-high, two-high, or both down) that is usually, not always, what they play; they rotate after the snap.
- It adapts: lean on the same play and it starts calling coverages that beat it and jumps it quicker ("THEY'VE SEEN THIS PLAY").
- Every player gets a slightly different speed each game, and routes vary a little in depth, so no two snaps are identical.

### Settings
From the playbook: **DIFFICULTY** (Rookie, Pro, All-Pro: how much the CPU side is slowed and how contested catches lean), **GAME SPEED** (slows or speeds up everything together, so timing feels the same), and **AIM MODE**. Saved on your device.

### Your defense
- Call your defense in the huddle: a defensive playbook of 17 calls in ZONE / MAN / BLITZ tabs, each with a diagram (or AUTO).
- The CPU calls plays by down and distance and runs them with a quarterback that **reads its receivers one at a time** and throws to the first one open enough. A **yellow arrow from the QB shows who he's looking at**; it sweeps between reads, and **turns orange for a beat when he's about to throw** (your cue to break on it).
- You are the **MIKE linebacker** (yellow marker). He plays his assignment in the call on his own (shown before the snap, e.g. `COVER 3 - YOU: HOOK ZONE` or `BLITZ!`). **Touch and drag anywhere to take over** (a thumb joystick), and let go to hand him back. Jump the QB's read for a pick, break up passes, chase down a runner, or come through the line for a sack (the line will try to block you).
- The other ten defenders play the randomly chosen coverage.

### Screen
- **Portrait or landscape:** turn the phone sideways and the game turns with it. The play still runs up the screen, but the field's width gets the long side (about 1.3x bigger, classic chunky players), with the scoreboard and buttons in side panels; the camera follows deep balls. Rotate back for portrait.

### Defense
Picked at random each snap. Linemen block, rushers try to beat their block; spare linemen double-team, and anyone not picked up comes free.

| Call | Rush | Coverage |
|---|---|---|
| Cover 0 | 6-man blitz | all-out man, no deep help |
| Cover 1 | 4 or 5 | man + a deep safety (+ a robber on 4-man) |
| Cover 2 | 3 or 4 | zone: 2 deep halves, 5 underneath |
| Cover 3 | 4 or 5 (fire zone) | zone: 3 deep thirds, 3-4 underneath |
| Cover 4 | 3 or 4 | zone: 4 deep quarters, 3-4 underneath |

### Blocking, screens and rollouts
Linemen on screens let their rusher through and release downfield; receivers on stalk routes block the defender over them. Downfield blockers pick the nearest defender to the ball, get between him and the ball, and hold him for a moment (a held defender barely moves and can't make the tackle; linemen hold better than receivers). On rollouts the QB sprints out and throws on the run (a bit less accurate, away from the rush).

### Playbook
| Category | Play | Good against |
|---|---|---|
| QUICK | Slant Flat | blitz |
| QUICK | Curl Flat | zone |
| QUICK | Stick | Cover 3 |
| QUICK | Quick Outs | soft coverage |
| QUICK | Spacing | zone |
| QUICK | Snag | Cover 3 |
| CORE | Smash | Cover 2 |
| CORE | Flood | Cover 3 |
| CORE | Levels | zone |
| CORE | Dagger | Cover 1 |
| CROSSERS | Mesh | man |
| CROSSERS | Y Cross | man |
| CROSSERS | Drive | man |
| SHOTS | Four Verts | Cover 3 |
| SHOTS | Yankee | Cover 1 |
| SHOTS | Post Wheel | man |
| SHOTS | Double Post | Cover 3 |
| SHOTS | Sluggo | man (slant-and-go) |
| SHOTS | Out and Up | man |
| SHOTS | Scissors | Cover 4 |
| SHOTS | Hail Mary | last play |
| QUICK | Hitch Seam | Cover 3 |
| CORE | Mills | Cover 4 |
| CROSSERS | Shallow | zone |
| CROSSERS | Texas | man |
| SHOTS | Corner Post | Cover 3 |
| SHOTS | Deep Cross | Cover 1 |
| SCREEN | RB Screen | blitz (QB drifts back, three linemen release to block) |
| SCREEN | Bubble | soft coverage (two receivers stalk-block) |
| SCREEN | Tunnel | man (receiver comes inside behind two releasing linemen) |
| CORE | Sprint Out | zone (QB rolls right, throws on the run) |
| CORE | Roll Cross | man (QB rolls left, deep crosser coming back) |

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
- `src/match.ts`: the game: score, quarters and clock, possession, punts
- `src/drive.ts`: field position and downs for whoever has the ball
- `src/cpu.ts`: the CPU quarterback (reads, eyes, throws), CPU play calling and 4th-down decisions
- `src/defense/calls.ts`: defensive alignment, zones, and the coverage/rush calls
- `src/playbook/`: routes, formations, plays and categories
- `src/game.ts`: input, aiming, camera, field/HUD drawing
- `src/menu.ts`, `src/playart.ts`, `src/defart.ts`: the huddle (offensive and defensive playbooks, settings) and the play / coverage diagrams
- `src/sprites.ts`, `src/font.ts`: pixel-art sprites and the 3x5 bitmap font
- `src/view.ts`: portrait/landscape views (how the field maps onto the screen)
- `src/settings.ts`: difficulty / game speed / aim mode, saved on the device
- `src/main.ts`: canvas sizing per orientation + pointer (touch/mouse) input
