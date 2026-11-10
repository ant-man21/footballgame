# Franchise / career mode: plan

Status: **milestone 1 built; milestone 2 (high school) playable, including recruiting; camps not yet built.** See "Status" at the end for what exists and what's next.

## Vision
A career that runs **high school -> college -> NFL**, built on the existing on-field game. Later, a **coach mode** that reuses the same league engine (recruiting, roster management, trades, full sims, scheduling, playoffs).

## Decisions so far
Answered by the owner (Nov 2026):
- **QB only** to start.
- **Home state: pick a real state.** Generated high schools sound regional (town word pools per region).
- **Game day: keep the defense.** You play your offense as the QB *and* the MIKE linebacker on defense, as in the exhibition. A hub toggle simulates the opponent's drives instead for players who'd rather skip defense.
- **10 games + an 8-team state playoff. No high school transfers.**
- **The coach calls the plays in high school** (offense and defense). You run them (FLIP still works). No other team management.
- **Option: call your own plays** (owner, follow-up): a hub toggle, PLAYS: COACH / YOU CALL. With YOU CALL a career game plays exactly like an exhibition: the huddle on both sides, you at QB and the MIKE. KICKOFF on the title screen is still the plain exhibition game.
- **Logos: a later session fetches them**; generated pixel badges until then.
- **Levels (owner agreed):** a QB's norm overall (average starter) is ~60 in high school, ~70 in college (an incoming freshman at 70-74 is in a real QB battle; a good college career ends ~80-85), and 76 in the NFL (the base game; a college QB at 80+ arrives as a starter, elite NFL QBs reach the high 80s-90s).
- **Recruiting means colleges recruiting you** in the player career (owner, follow-up); recruiting players is a coach-mode feature. **Stars move every week**, senior year included.

Original proposals:
- **Player mode first, as a quarterback.** The game is built around the QB; a QB career fits it, gives a clean HS -> college -> NFL path, and builds the systems coach mode needs (seasons, schedules, quick-sim, progression, saves).
- **Real college names and logos**, and the same approach for the NFL. It's a personal game. **All team identity lives in JSON** (name, abbreviation, conference, colours, logo file), so everything can be swapped in one place if the game is ever released.
- **High schools are generated**, not real (minors are involved, and there are thousands). Generated names, mascots and colours per region.
- **Start with high school**, as the owner described: earn the job, play junior and senior seasons, get offers, try to win state. Then build the next tier.

## How a high school career plays (milestone 2)
1. **Create your QB**: name, home state (a real state), archetype that sets starting strengths:
   - *Pocket passer* (accuracy, decisions), *Gunslinger* (arm), *Game manager* (decisions, low turnovers). Starting ratings ~55-65 (the existing `ratings.ts` scale; HS norms sit below college norms).
2. **Sophomore year + start of junior year: the backup.** Weekly hub; most games you watch (simulated). Some weeks you get **scenario snaps**: mop-up 4th quarters, relief when the starter struggles, or a two-minute drill. Each appearance is graded (completion %, yards/attempt, TDs, INT/sacks, scoring drives, game result) and fills a **QB battle meter** against the starter's rating. Win it and you're the starter for the rest of junior year.
3. **Senior year: the starter.** ~10-game regular season, then the **state playoffs** (bracket by record/region) and the state title game.
4. **Weekly loop**: hub -> pick a **practice focus** (accuracy / arm / reads / mobility later) -> game day (play it, or play only your snaps / your drives; other games quick-sim) -> results, stats, standings, awards race -> next week.
5. **Recruiting** runs from junior year: a star rating (1-5) from ratings + stats + team success + exposure. **Camps** in the off-season (a skills challenge using the game: accuracy and reading drills) raise exposure. Colleges show interest, then offer; you take visits and **commit**. Offers come from tiers (P4 / G5 / FCS) matching your rating; a breakout senior year can pull bigger offers late.
6. **Transfers / better high school offers** (optional): a standout sophomore/junior can get an offer to move to a bigger program. **Not included (owner).**
7. **End of HS**: signing day, summary screen (career stats, awards, star rating, commitment) -> unlocks college (milestone 3).

### What you control on game day (decided: offense + the MIKE, or simulated defense; the coach calls plays in high school)
Proposal: **you play your team's offensive drives as the QB; opponent drives are simulated** drive-by-drive (outcome, time used, field position) so games stay short and centered on you. Option: "play defense too" for players who want it (uses the existing defense mode). A game's scoreboard/clock carry over between your drives.

## Milestones
### 1. Foundation (no new screens beyond a basic hub; everything else depends on it)
- **Career save**: one JSON blob in localStorage (`footballgame.career.v1`), with a version field and migrations. Autosave after each week. Later IndexedDB if it gets big.
- **League model**: teams (generated HS teams now, real colleges/NFL later), divisions/conferences, a **schedule generator**, standings with tiebreakers, playoff brackets.
- **Team strength**: each team has a generated roster (`makeRoster(name, strength)` already exists) or at least an overall + unit ratings (pass offense, pass defense, run game proxy for sims).
- **Quick-sim engine**: turns two teams' ratings into a believable final score and a box score (passing yards, TDs, INTs, sacks, a QB line) in milliseconds. Drive-based: alternate possessions; each drive resolves to a touchdown, punt, turnover or end of half (there are no kicks in this game), with time used and yards gained. Calibrate it against auto-played real games (`scripts/balance/season.cjs` style) so simulated and played games produce similar stat lines.
- **Scenario games**: start a `Match` from a situation: quarter, clock, score, field position, down/distance, who has the ball, timeouts. (`Match` already tracks all of these; add a constructor/factory and a "your drives only" mode.) Used for backup snaps, two-minute drills, and simulated drive hand-offs.
- **Player career model**: your player (a `Player` from `ratings.ts` plus career data: age/class, stats by season/game, awards, star rating, XP).
- **Progression**: ratings grow from practice focus + game performance + age; small random swings; caps by tier. Visible on the TEAM screen and a career stats screen.

### 2. High school career (described above)
Screens: career hub (week, next opponent, record, QB battle meter / standings), practice focus picker, schedule, standings, stats (game/season/career), recruiting board (interest, offers, visits), signing day, season summary.

### 3. College
- `data/colleges.json`: every FBS and FCS school (name, short name, abbreviation, mascot, conference, division FBS/FCS, prestige 1-100, primary/secondary colours, logo file path).
- Conferences and schedules, conference championships, the **12-team College Football Playoff**, bowl-style results for others, Heisman-style awards.
- Freshman depth chart battle (reuse the QB battle meter), redshirt option, transfer portal (later), declaring for the NFL draft.

### 4. NFL
- `data/nfl.json`: teams (same JSON approach, real names/logos by the owner's call).
- Draft (projected round from ratings/production/combine), contracts (simple), seasons, playoffs, **Super Bowl**, awards, retirement / career summary.

### 5. Coach mode (later)
Reuses the league engine: recruiting a whole class, roster management, depth charts, trades (NFL), full-season sims, scheduling, play-calling for both sides, CFP and Super Bowl runs.

## Data and assets
- `data/*.json`: schools/teams with identity fields above. Load at startup (Vite can import JSON).
- **Logos**: PNG files under `public/logos/<id>.png`, referenced by the JSON. Sourcing the real logo images is the owner's call for personal use (he can drop PNGs in, or ask a session to fetch them). **Fallback**: a generated pixel badge (team colours + abbreviation) so everything works with no logo files present.
- Keep all team identity out of code so it's replaceable in one place.

## Technical notes (fit with the current code)
- New code under `src/career/` (models, league, schedule, quick-sim, recruiting, progression, save) and `src/ui/` for the new screens; keep the on-field game (`sim.ts`, `match.ts`, `game.ts`) reusable. `Game` will need an entry point like `playCareerGame(matchSetup, teams, onFinish)` instead of always starting a fresh exhibition.
- Exhibition (the current quick game from the title screen) stays as is; the title screen gets a **CAREER** button.
- Your QB's ratings already flow into the sim (`accFactor`, `maxThrow`, `rd()`), so progression is immediately felt on the field.
- Screens must work in portrait and landscape (`view.ts`), with the 3x5 font and existing button/box helpers.
- Tests: extend `scripts/smoke.cjs` (create a career, sim a week, play a scenario drive, check the save round-trips, finish a season into recruiting). Add a balance script that quick-sims many seasons and checks score/stat distributions against auto-played games.

## Status

### Built (milestone 1 + most of the high school career)
- **Save**: `footballgame.career.v1`, one JSON blob (`CareerSave`) with `v` and `migrate()`, autosaved every week.
- **League**: 16 generated schools in your state, 2 regions of 8; 3 non-region weeks then a 7-game region round robin; standings (region record, overall, head to head, point diff, points); top 4 per region into an 8-team crossover bracket -> state title. Ties go to a played overtime (college style from the 25, no kicks, no clock), on the field and in the quick-sim.
- **Team strength**: each school has a prestige (0-100) that pulls its offense/defense unit ratings each year (graduation turnover is the randomness). Your team and opponents get generated rosters at the high school tier for played games.
- **Tiers**: rosters carry a `tier` (high school -16); the on-field sim judges ratings against the tier's norms, so progression is felt on the field.
- **Quick-sim**: runs a real `Match` with generated plays; calibrated to auto-play (`drives.cjs` vs `quicksim.cjs`): even teams ~26.5 pts, TD 46% / punt 27% / INT 11% of drives (auto-play 46 / 30 / 8-11). Career sims use a slower between-play pace (`HUMAN_RUNOFF`), ~20 pts a game.
- **Scenario games**: `Match.fromSituation()` and the backup's game day: the starter's part is quick-simmed to a moment: a **two-minute drill** (end of the 1st half, your stint ends at halftime), **relief** (the 2nd half; likelier when trailing), **mop-up** (the 4th quarter of a 17+ point game, or forced after two dry weeks). Your line counts only your snaps.
- **Your QB**: name, real state, archetype (pocket passer / gunslinger / game manager), ratings ~52-62 as a sophomore (high school norm ~62).
- **Progression**: weekly practice focus (accuracy / arm / reads), playing time (better games teach more), the off-season; capped at 86 in high school; hidden growth rate.
- **QB battle meter**: game grades (passer-rating based, ~60 = an average line), practice and the ratings gap vs the starter. A sophomore can't take a senior's job (meter capped at 90); juniors start from last year's trust and win the job at 100 (about 70% do, around week 6 in `career.cjs`). Seniors start.
- **Stars** (1-5) move every week from a recruiting score: your overall vs a solid QB of your class (the bar rises through each year), how you're playing (grades count fully after 5 starts; before 6 appearances it blends with last season), wins as the starter, playoff wins, a state title. Thresholds: 2 stars at 0, 3 at 10, 4 at 22, 5 at 32.
- **Recruiting** (`career/recruiting.ts`, `data/colleges.json`: all FBS + ~100 FCS, real names): each school has a bar (P4 3-5 stars, G5 2-3, FCS 1-2). Every week schools near your level gain interest (more in your state, more if they need a QB this year; ~1 in 5 schools does, re-rolled every year). Sophomores only get noticed; from the junior year a school that's interested (60+), needs a QB and is within reach (2 under its bar up to 5 + 0.3 x your score over it) has a 7% weekly chance to offer. The summers and 4 weeks after the senior season count too (late bloomers). Commit to an offer (tap twice) or decommit; **signing day** after the senior season: sign an offer, or a preferred walk-on spot if there are none. Calibrated with `career.cjs`: ~12 offers a career; 2-stars mostly FCS, 3-stars G5 / low P4, 4-5 stars P4.
- Season awards (region champion, all-region / all-state QB, state champion).
- **Events**: scouts in the stands (a specific college), the recruiting site's evaluation (grade counts double, posts a national / state QB ranking), TV games (semifinals and the state title always). **Letter grades** for games.
- **Screens with personality**: the hub in your school's colours (week-by-week strip, the next game's storyline, a scrolling state news ticker, GAME PLAN for the defense / play-calling options), each season ends with a yearbook page (photo, season stats, best game, honors, teammates signing your yearbook) and high school ends in a trophy case (titles, plaques, medals, game balls from A games, the rivalry record, career totals, your letter of intent). Seasons record `avg`, `balls` and `rival` for it.
- **Flavor**: a state top-10 poll (STANDINGS > TOP 10, with weekly movement; your rank on the hub), AROUND THE STATE headlines (upsets, OT, big passing days, streaks, playoff advances), pregame storylines (rivalry week with a trophy, homecoming, senior night, undefeated showdowns, top-10 clashes, playoff rounds and rematches), players to watch and the coach's two keys on game day, a hometown-newspaper result (front-page headline, your top target's line, player of the game, keys met or missed), and 1-4 teammates signing with colleges each season. QB rankings follow your star band (a 4-star is top 35 nationally); stars freeze once a season ends.
- **Recruiting footprint**: schools recruit hardest in-state, then their region and neighbouring regions; the elite programs recruit 4-5 stars nationally. A Texas 5-star draws ~30 offers (Texas and A&M nearly always, plus the SEC / Big 12 and national powers); a Montana 5-star ~25.
- **Official visits**: five a career, juniors and seniors, one a week, from the recruiting board (tap a school, VISIT). Interest +30; half the time the school decides it needs you at QB; if you're at its level it may offer on the spot.
- **Team colours on the field** in career games: home in school colours, visitors in white (auto-swapped for clashes and for jerseys that vanish on the green field); end zones in team colours.
- **Screens**: start (continue / new), create, hub, game day intro, week result (with around-the-state scores and recruiting news), schedule, standings + bracket, stats (season, game log, career), recruiting board, season summary, signing day, graduated. Portrait and landscape.
- **On the field**: coach-called plays (no huddle) or your own calls (PLAYS: YOU CALL), team abbreviations in the HUD, your defense or simulated opponent drives, SIM REST OF GAME in the pause menu.

### Next (rest of milestone 2)
- **Camps** in the off-season (an accuracy / reading drill on the field) to raise exposure.
- Team colours on the field sprites (currently blue vs red), logos from JSON with the badge fallback.
- Player of the week / season awards race on the hub; a career stats screen across levels.
- Saving a game in progress (closing the app mid-game replays that week).

### Backlog the owner asked to keep in mind (flavor and polish, not gameplay)
- **Headlines**: the big-passing-day headline fires in over half the games (winner 5+ TD or 400+ yds), so a week with no upsets reads four identical lines. Raise it (6 TD / 450 yds), one per week, varied wording.
- **Quick-sim box scores** look too clean: ~72% completions and almost no sacks (0.2 a game vs 1-2 for you). Cosmetic (box scores / headlines), not results.
- **Teammate names** can match yours (a J.MOORE CB on J.MOORE's team): skip your name when generating the roster.
- **Difficulty per career**: difficulty is one global setting, so switching it (even for an exhibition) re-scores the career's stars next week (ALL-PRO steps 8 / 18 / 33 / 52 vs PRO 5 / 14 / 28 / 46). Store it in `CareerSave` at creation, show it on the hub / GAME PLAN, and warn before changing it mid-career.
- More life: your own news in the ticker (offers, commitment, "WALKER COMMITS TO TEXAS"), a Mr. Football / all-state banquet at season's end, an All-American game invite for 5-stars, a signing day ceremony (hats on the table), game-day weather and night games, rival trash talk on rivalry week, your jersey retired in the trophy case.
