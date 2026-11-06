# Franchise / career mode: plan

Status: **planned**. This is the spec for the next phase. Decisions marked **(confirm)** are proposals: ask the owner before building them in.

## Vision
A career that runs **high school -> college -> NFL**, built on the existing on-field game. Later, a **coach mode** that reuses the same league engine (recruiting, roster management, trades, full sims, scheduling, playoffs).

## Decisions so far
- **Player mode first, as a quarterback.** The game is built around the QB; a QB career fits it, gives a clean HS -> college -> NFL path, and builds the systems coach mode needs (seasons, schedules, quick-sim, progression, saves). QB only to start; other positions need new controls. **(confirm QB-only)**
- **Real college names and logos**, and the same approach for the NFL. It's a personal game. **All team identity lives in JSON** (name, abbreviation, conference, colours, logo file), so everything can be swapped in one place if the game is ever released.
- **High schools are generated**, not real (minors are involved, and there are thousands). Generated names, mascots and colours per region. **(confirm)**
- **Start with high school**, as the owner described: earn the job, play junior and senior seasons, get offers, try to win state. Then build the next tier.

## How a high school career plays (milestone 2)
1. **Create your QB**: name, home state/region **(confirm: pick a state, or generic regions?)**, archetype that sets starting strengths:
   - *Pocket passer* (accuracy, decisions), *Gunslinger* (arm), *Game manager* (decisions, low turnovers). Starting ratings ~55-65 (the existing `ratings.ts` scale; HS norms sit below college norms).
2. **Sophomore year + start of junior year: the backup.** Weekly hub; most games you watch (simulated). Some weeks you get **scenario snaps**: mop-up 4th quarters, relief when the starter struggles, or a two-minute drill. Each appearance is graded (completion %, yards/attempt, TDs, INT/sacks, scoring drives, game result) and fills a **QB battle meter** against the starter's rating. Win it and you're the starter for the rest of junior year.
3. **Senior year: the starter.** ~10-game regular season, then the **state playoffs** (bracket by record/region) and the state title game.
4. **Weekly loop**: hub -> pick a **practice focus** (accuracy / arm / reads / mobility later) -> game day (play it, or play only your snaps / your drives; other games quick-sim) -> results, stats, standings, awards race -> next week.
5. **Recruiting** runs from junior year: a star rating (1-5) from ratings + stats + team success + exposure. **Camps** in the off-season (a skills challenge using the game: accuracy and reading drills) raise exposure. Colleges show interest, then offer; you take visits and **commit**. Offers come from tiers (P4 / G5 / FCS) matching your rating; a breakout senior year can pull bigger offers late.
6. **Transfers / better high school offers** (optional): a standout sophomore/junior can get an offer to move to a bigger program. **(confirm: include?)**
7. **End of HS**: signing day, summary screen (career stats, awards, star rating, commitment) -> unlocks college (milestone 3).

### What you control on game day (confirm)
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

## Open questions for the owner
1. QB only to start? (proposed yes)
2. Home state: pick a real state, or generic regions? Season length (~10 games + playoffs)?
3. Game day: play only your offensive drives (opponent drives simulated), or full games including defense, or a choice?
4. Include high school transfers / better-school offers?
5. How much team management in high school (just you, or also team play-calling/strategy)?
6. Logos: will you supply PNGs, or should a session fetch them?

## Suggested first prompt for the next session
"Read CLAUDE.md and docs/FRANCHISE.md. Ask me the open questions, then build milestone 1 (foundation) and start milestone 2 (high school career)."
