# CLAUDE.md

Working notes for Claude sessions on this repo. Read this first.

## What this is
A pixel-art, pass-first American football game for phones (and laptops), built as a web app.
Vite + TypeScript, plain Canvas 2D, no framework, no runtime dependencies.
Live at https://ant-man21.github.io/footballgame/ (GitHub Pages, deployed on every push to `main`).
The owner plays on an iPhone (portrait and landscape) and tunes by feel; keep changes testable on a phone.

Current phase: **franchise / career mode** (plan and status in `docs/FRANCHISE.md`). Milestone 1 (foundation) is built and the high school career is playable: create a QB, three seasons, the QB battle, state playoffs, recruiting (live stars, offers from real colleges, commit, signing day). Camps and the college career are next.

## Commands
```sh
npm ci                     # install (the cloud environment's setup script does this)
npm run dev                # dev server (LAN-visible, for testing on a phone)
npm run build              # tsc --noEmit (strict) + vite build -> dist/
npx vite preview --port 4173 --strictPort &   # serve dist/ for the tests below
npm run test:smoke         # end-to-end smoke test (needs the preview server)
node scripts/balance/season.cjs 10            # balance: auto-play N full games
node scripts/balance/drives.cjs 30            # balance: what auto-played drives turn into (quick-sim calibration target)
node scripts/balance/quicksim.cjs 2000 5      # the career quick-sim at auto-play pace, even and +-6 rating edges
node scripts/balance/career.cjs 60            # whole high school careers: appearances, QB battle, ratings, stars
node scripts/balance/simdefense.cjs 3000      # career DEFENSE: SIMULATED: opponent drive TD rates by matchup and field position
```
Playwright + Chromium are preinstalled in the cloud container (`require('playwright')` works; don't install another).
The preview server often dies between turns: if a test gets `ERR_CONNECTION_REFUSED`, restart it.
After `npm run build`, the preview server serves the new `dist/` without a restart.

## Workflow (what the owner expects)
- Work on a `claude/<topic>` branch, then fast-forward `main` and push. The owner wants changes **merged to main and deployed** so they can test on the phone; confirm the deploy run succeeded via the GitHub MCP `actions_list` tool (workflow `deploy.yml`).
- **Gate every push on the smoke test**: run it to a log and check the last line is exactly `SMOKE OK` before committing/pushing (`grep -q "^SMOKE OK" log && git commit ...`). Piping it through `grep` for display is not a gate.
- Measure before and after any gameplay change with the balance scripts; tune with numbers, then describe the change in football terms.
- Commit messages: a short summary line plus bullets of what changed and why; end with the attribution lines the session provides.
- Keep UI text in the 3x5 pixel font: uppercase letters, digits and the symbols in `src/font.ts` only (add glyphs there if needed).

## Architecture (src/)
| File | Role |
|---|---|
| `main.ts` | Canvas sizing per orientation, pointer input, the frame loop. Exposes `window.__game`, `window.__plays`, `window.__cpu` for tests. |
| `update.ts` | Keeps a home-screen install current: on open / return to the foreground it fetches `index.html` uncached and reloads if a newer build's script is deployed, only on a menu (never mid-game). The title screen shows `BUILD MM-DD HH:MM` (UTC, `__BUILD__` from vite.config.ts). |
| `config.ts` | Logical size (180x320 portrait world), `YD` = 3.15 px per yard, `LOS_Y`, field edges, `fx()`/`fy()` yard->px helpers, colours (PICO-8-ish palette), game-feel constants. |
| `view.ts` | Portrait (1:1) and landscape views: how the world maps to the screen (`s`, `ox`, `oy`, side panels). Landscape canvas width follows the phone's aspect. |
| `game.ts` | The controller: screens (`title`, `huddle`, `play`, `banner`, `final`, plus the TEAM screen and pause overlay), input (one-touch snap+throw, PULL/AIM aiming, defensive joystick), clock between plays, timeouts, hash spotting, camera, all drawing of the field/players/HUD. |
| `sim.ts` | The on-field simulation, no DOM: actors, routes, pass rush and blocking, man/zone coverage, catches, run after catch, downfield blocking, rollouts, the user-controlled MIKE. Stepped by `update(dt)`; tests step it directly. |
| `match.ts` | A game: score, quarters, clock rules (two-minute warning, running clock, play clock), timeouts, possession changes, punts, result banners. |
| `drive.ts` | Field position and downs for the team with the ball; per-team stats. `ballX` = lateral spot (hashes). |
| `cpu.ts` | CPU quarterback (progression reads, eyes, windup, throws), CPU play calling, CPU 4th-down decisions. `readReceiver()` = best lead spot + how open it is. |
| `ratings.ts` | Player ratings, position norms, roster generation (generated names), saving the user's roster, `playerFor()` mapping field spots to players. |
| `roster.ts` | TEAM screen UI. |
| `menu.ts` | The huddle (offensive/defensive playbooks with paging), the settings panel, and the title screen (a mode of the menu: PLAY NOW / CAREER / TEAM / SETTINGS via `titleLayout()`; SETTINGS opens the settings panel with the quarter length, DONE returns). |
| `playart.ts`, `defart.ts` | Diagrams for play cards and defensive call cards, drawn from the data. |
| `settings.ts` | Difficulty, game speed, aim mode, quarter length (saved in localStorage). |
| `playbook/` | `routes.ts` (route library in "outside / depth" yards), `formations.ts`, `plays.ts` (all offensive plays + categories). Adding a play is data only. |
| `defense/calls.ts` | Defensive alignment, zones, the 19 calls, categories, `beats()` (what each play label beats). |
| `hd.ts` | HD pixel art: the canvas renders at `HD` (3) canvas pixels per logical pixel (`main.ts` sets the transform), so the HUD/text stay chunky while players, the ball and the grass get a 3x finer grid. Players are 3/4 top-down sprites built procedurally (auto-outlined) per kit / build / facing (up, down, or a side view for running across) / pose (`stand`, `run` 4-frame cycle, `stance`, `block`, `throw`, `hold`, `carry`, `catch`, `down`) / lean / jersey number / skin tone, cached. `Game.poseFor()` picks the pose; `Game.anim` tracks each actor's speed and stride. Sprites carry no ball: they report a ball hand and `renderBall` draws the one ball there. |
| `stadium.ts` | The stadium on the HD grid: behind each end line a dark padded wall with the home school's mascot painted on (`Crowd.homeName`, exhibition `PIXEL BOWL`), a packed 19-row bowl of fans in the schools' colours that darkens toward the back (cached while still; animated when `Game.crowd().hype` is up), the facade, light towers and a night sky; goalposts on the end lines; a low wall along the portrait sidelines; in landscape sideline stands in the HUD panels (dimmed). `STANDS_YD` = how deep the stands reach. The camera stops a few rows into the stands (`camLimit`). |
| `intro.ts` | The pregame show (~10 s, tap to skip) before a game from the opening kickoff: the camera sweeps down from the home stands with a title card (storyline or week, the two schools as badges); the home team runs out of an inflatable tunnel through a paper banner (`GO <MASCOT>`), with smoke, fireworks (more for big games) and the crowd up; then a TV-style coin toss close-up (captains, a striped referee, the coin) and who receives. `Game.startIntro(info, then)`, screen `intro`; `CareerGameSetup.intro` (from `CareerScreens.introFor`, only when the game hasn't started). Off under automation (`Game.introEnabled`, `navigator.webdriver`); the smoke test turns it on once. |
| `sprites.ts`, `font.ts`, `util.ts` | Team uniforms (blue/red, or a `Kit` from school colours via `kitsFor(home, away)`: home in colour, visitors in white, swapped when a jersey would vanish on the green field or clash; career games also colour the end zones), 3x5 bitmap font, small math helpers. |
| `career/career.ts` | The high school career: `CareerSave` (the whole saved state), `Career` (season flow, `prepareGame()` -> `GamePlan`, `finishGame()`, QB battle, playoffs, season summary, `nextSeason()`). |
| `career/league.ts` | Teams, the 10-game schedule (3 non-region + 7-game region round robin), standings + tiebreakers, 8-team playoff bracket. |
| `career/quicksim.ts` | The quick-sim: drives a real `Match` with generated play outcomes from team unit ratings (`simPlay`, `simDrive`, `simUntil`, `simToEnd`, `simGame`). Calibrated against auto-play. |
| `career/player.ts` | Your QB: creation (archetypes), practice/game/off-season progression, game grades, passer rating, star rating. `HS_TIER`. |
| `career/recruiting.ts` | Colleges recruiting you: `COLLEGES` (from `src/data/colleges.json`), each school's `bar()` (the recruiting score it wants), weekly interest and offers (`recruitingWeek`), official visits (`officialVisit`: 5 a career, juniors+, one a week, via `Career.visit()`; +30 interest, half the time the school decides it needs you, 45% offer on the spot if you're at its level), stars from the score (`starsFor`), the board, walk-on spots. Per-state footprint (`affinity`: in-state 1.7x, own region 1.3x, neighbouring regions 1.15x, elite programs recruit 4-5 stars anywhere); top recruits get noticed early and schools make room (`effectiveNeed`), offers come faster for 4-5 stars. Events: `pickScout`, `scoutReaction`, `tvReaction`, `qbRank` (national / state ranking). |
| `data/colleges.json` | Every FBS school and ~100 FCS schools: name, abbreviation, mascot, conference (2026), tier P4/G5/FCS, prestige, state, colours, logo path. All college identity lives here. |
| `career/news.ts` | Flavor only (never changes results): `statePoll`/`pollRank` (the top 10, `CareerSave.poll`/`pollPrev`), `headlines` (AROUND THE STATE, `CareerSave.headlines`), `storyline` (rivalry / homecoming / senior night / playoff rounds), `keysFor`/`keyMet` (the coach's keys), `playersToWatch`, `targetLine` (your top receiver's share of your line), `frontPage`/`paperName` (the newspaper result), `teammateSignees` (`SeasonLine.signees`). |
| `career/hsnames.ts`, `career/rng.ts`, `career/save.ts` | Generated schools per state/region, seeded RNG, the versioned save (`footballgame.career.v1`, `migrate()`). |
| `ui/export.ts` | EXPORT SAVE (career start screen): copies `{game, build, exported, settings, career}` as JSON to the clipboard (on pointerup via `Game.afterTap`, since phones only grant clipboard access when the finger lifts), or shows it in a box to copy by hand. When the owner pastes one, `career` is the `CareerSave`. |
| `ui/career.ts`, `ui/kit.ts`, `ui/art.ts` | The career screens: start, create, the hub (school-colour banner, week strip, next-game card with storyline, news ticker, tiles, GAME PLAN screen for DEF / PLAYS), game day, the newspaper result, schedule, standings (regions / TOP 10 / bracket), stats, the yearbook season summary, the trophy case (graduated). Drawing helpers (buttons, badges, meters, stars, `inkOn`/`accentOn` for text on school colours) and pixel art (`qbBust`, cup, plaque, medal, game ball). |

### Key concepts
- **World coordinates** are the 180x320 portrait layout in pixels; offense always attacks up the screen (smaller y). The line of scrimmage sits at `LOS_Y`; the field scrolls by field position (`drive.ballOn`), and `Game.camY` follows the ball. Everything drawn goes through `game.sx()/sy()`; touches come back through `wx()/wy()`.
- **Sim time** runs `TIME_SCALE` (1.2) x real time x the game-speed setting. All speeds are yards/second x `YD`. Ball flight durations are in sim seconds.
- **Actors** have a `job`: `route`, `block` (pass pro), `lead` (downfield block), `rush`, `man`, `zone`. Phases: `presnap` -> `live` -> `air` -> `run` (after the catch) -> `done`.
- **Catches** are decided where the ball lands: nearest receiver vs nearest defender within reach, with odds from the distance edge, hang time and ratings.
- **Ratings** are applied as deltas from the position norm (`sim.rd(actor, key)`), so an average roster plays like the base tuning. Difficulty = CPU roster strength.
- **Defense adapts** to repeated plays (`Game.history` -> call bias + recognition).
- **Hashes**: `drive.ballX` (yards, +-`HASH_YD`); formations/defense shift with the ball; plays point their strength to the field; FLIP mirrors.
- **Tiers**: `Roster.tier` shifts every position norm (high school = `HS_TIER` = -16). The sim judges ratings against the tier's norms (`sim.tier`), so an average high school starter plays like the base tuning, and a 70 QB dominates high school.
- **Kicking (simulated)**: a TD is 6 plus a simulated extra point (92%); `Match.fieldGoal()` kicks a FG worth 3 (`fgOdds(fgDistance(ballOn))`: ~95% from 20 yd to ~35% from 50, `FG_MAX` 55); a miss gives the other team the ball at the spot of the kick (or their 20). 4th downs for the CPU / coach / quick-sim come from `fourthDownCall()` (go / fg / punt): no punting inside the other team's 30, kick in range unless it's short yardage, and late when trailing only kick if 3 ties or wins it. Your huddle shows PUNT (not inside their 30) and FG nn (in range).
- **Overtime** (`Match.ot`): tied after Q4 -> college style, no kicks: each team gets a possession from the 25 (`OT_YARD`), no clock, no punting (`cpuGoesForIt` goes for it, no PUNT button), 1 timeout each per round; after both possessions the leader wins, else another round with the other team first. From OT3 it's a two-point shootout: one play from the 5 (`SHOOTOUT_YARD`), worth 2. `match.periodText` shows `OT`/`OT2`. Exhibition and career games both use it; the quick-sim plays it too.
- **Plays are data for the Match**: `Match.afterPlay(PlayRaw, secs)` takes a plain outcome (`rawFromSim(sim)` on the field, generated outcomes in the quick-sim), so clock/downs/possession rules are shared. `Match.fromSituation()` starts a game mid-way; `match.names` labels the teams.
- **Career games**: `Game.playCareerGame(setup)`: with `coachCalls` no huddle (the coach calls plays via `callPlay`, 4th downs via `cpuGoesForIt`); without it (`CareerSave.calls === 'you'`) the normal huddle runs, as in an exhibition; you play the MIKE on defense or the opponent's drives are quick-simmed (`simDefense`; those drives get `SIM_DEF` in game.ts: +4 to your defense, 14 s of runoff and a per-game random `form` (sd 4) for the opponent's offense, so an even opponent scores a TD on ~37% of drives from its 25 instead of the arcade ~50%, weak offenses ~5 points a game and good ones ~18 with 28+ about a third of the time), a two-minute drill ends at halftime (`endAtHalf`), the pause menu offers SIM REST OF GAME, and `onDone(match, stint)` hands the game back. `screen === 'career'` delegates input/drawing to `Game.careerScreens`.

## Testing and balance
- `scripts/smoke.cjs`: Playwright on emulated Pixel 7 (portrait + landscape) with real touch events (CDP). Covers the title screen, TEAM screen, huddle, both aim modes, run after catch, sacks, punts, defense with the joystick, pause/timeouts/settings/restart, clock rules, hashes/FLIP, a full auto-played game, every call vs every play fielding 11 v 11, and the career (create, practice focus, a backup scenario on the field with coach calls, result, save round-trip through a reload, simulated defense, a season into the playoffs, the next season). Keep it green; extend it for new features.
- Test handles: `window.__careerUI` (the career screens: `create()`, `gameDay()`, `play()`, `career`, `toHubForTest()`, `recruitRows/recruitPages`, `signingRows/signingPages`, `pagerLayout`), `window.__quicksim`, `window.__recruiting`.
- `scripts/balance/` (run with the preview server up; `GAME_URL` overrides the URL):
  - `season.cjs N`: auto-play N games (CPU brain both sides): yards/play, plays/TD, completion %, INT %, sacks, plays/game.
  - `difficulty.cjs`: the same per difficulty, with team overalls.
  - `routes.cjs N`: ideal-timed throws to each short route vs man and vs zone.
  - `plays.cjs`: screens and rollouts with well-timed throws.
  - `rb-vs-man.cjs`: running back separation/completion vs man and zone.
  - `bunching.cjs`: defenders standing still / bunched in the middle.
  - `drives.cjs N`, `quicksim.cjs N runoff`, `career.cjs N`: see Commands. Retune the quick-sim (`career/quicksim.ts`) whenever on-field balance changes.
- **Stars freeze** once a season ends (`recruitingUpdate` only re-scores in `phase === 'season'`), so the summary and signing day agree. `qbRank` follows the star band (5: 1-4, 4: 5-35, 3: 36-150, 2: 151-400, 1: unranked).
- **Events** (`CareerSave.events`, `Career.scheduleEvents/eventFor/eventText`): juniors and seniors get 2 scout games (a college near or above your level; an A-range game sells them, maybe an offer on the spot; a bad one costs interest), 1-2 recruiting site (PREP ZONE) evaluations (that grade counts double and posts your ranking) and 1-2 TV games (grade counts 1.5x, every school watching reacts); playoff semifinals and the state title are on TV. Grades show as letters (`letterGrade`: ~60 = B-, 74 = A-, 90 = A+).
- Recruiting score: talent (overall vs the class bar) + this season's production + last season (fully early in a season, 40% all year: `RESUME`). Wins count as a winning rate on a 10-game pace (`WIN_VALUE` 1.2 per win of pace), plus playoff wins and a title. Star steps depend on the difficulty setting (`STAR_STEPS_BY_DIFFICULTY`, `useDifficulty()`): PRO 5 / 14 / 28 / 46, tuned on a person's pace (grades ~65) so ~25% of careers reach 4+ stars (simulated QBs grade higher and land ~48%); colleges' bars stay on the original 0 / 10 / 22 / 32 scale via `barScale()`. Bump `SCORE_FORMULA` when the score changes (old saves re-score once on load).
- Career targets (career.cjs): a sophomore backup gets in ~4 of 11 games; ~70% win the job as a junior (~week 6); simulated seniors average ~3.1 stars, ~48% 4+ stars, ~7% 5-star on PRO (a person's pace: ~25% 4+); ~10-13 offers per career (2-stars mostly FCS, 3-stars G5 / low P4, 4-5 stars P4); quick-sim drive outcomes within a few % of drives.cjs.
- Current targets (auto-play, even rosters, Pro): ~7-9 yards/play, ~11-14 plays/TD, ~65-70% completions, ~1-3% INT. Quick routes ~60-80% vs zone, ~50% vs man; deep ~35-40%. Human players have been landing a bit higher (they read coverage well).

## Gotchas
- `tsc` runs with `noUnusedLocals`/`noUnusedParameters`: remove unused imports.
- Tests mutate game state directly through `window.__game`; when adding state to `Game`, make sure `startHuddle()`/`newGame()` reset it.
- Random outcomes make single test runs flaky if a check depends on a specific result (an interception flips possession). Force the state you need (`g.match.offense = 'you'`, `sim.forceCall = '...'`) before such checks.
- `localStorage` keys: `footballgame.settings`, `footballgame.roster`, `footballgame.career.v1` (has a `v` field, now 2: bump `CAREER_VERSION` and add a `migrate()` step when `CareerSave` changes; v1 saves get recruiting started and caught up in the `Career` constructor). Bump/validate shapes when they change (see `loadSettings`).
- The owner plays from an iPhone home-screen icon: never tell them to delete it or clear website data (that erases the career save). New builds arrive through `update.ts`.
- Career state lives in `CareerSave` (plain JSON). A `GamePlan` in progress is not saved: closing the app mid-game replays that week.
