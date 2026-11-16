# Handoff: what to build next

Notes for the next session (written Nov 2026, after the high school polish pass).
Read `CLAUDE.md` first, then `docs/FRANCHISE.md`. The owner's order of work:

1. **The college career** (simple first), see below.
2. **Abilities** get their effects (placeholders exist), see below.
3. Unlocking teams for exhibitions (high school first, then college / NFL).

The owner keeps tuning on-field play in parallel; don't change balance while
building these unless asked. Gate every push on `SMOKE OK`, merge to `main`,
confirm the `deploy.yml` run.

---

## Watch item: the Dual Threat (do NOT change yet)

The owner reports a Dual Threat QB "abusing" his legs and wants to play
another archetype first before any change. Data from his export (Arizona,
PRO, coach calls the plays, simulated defense, 2.5 min quarters):

| | Junior (9 GP) | Senior (13 GP) |
|---|---|---|
| Passing | 140/220, 1,842 yds, 19 TD, 5 INT | 245/378, 3,886 yds, 49 TD, 9 INT |
| Rushing | 105 for 813 (7.7 avg), 11 TD | 147 for 1,010 (6.9 avg), 9 TD |
| Avg grade | 64 | 79 (four 97-100 games) |

~11 runs a game at ~7 yds: almost all are scrambles (the coach only calls a
sneak / draw now and then). Senior: SPD 70, ELU 69, 4 stars, signed Notre
Dame. Simulated QBs on their own average ~3-4 yds a scramble, so a person
steering finds ~2x that. Candidate levers if the owner asks (measure first: a
Playwright script that snaps plays, calls `sim.keep()` at ~1.2 s and records
the gain, as done for the commit `QB draws and scrambles actually gain yards`;
compare against the numbers in `CLAUDE.md` > QB runs):
- the defense adapting to scrambles (a spy / contain rusher after N runs, the
  way `Tendency` reacts to check-downs),
- coverage players' "backs turned" delay shrinking when the QB keeps leaving
  the pocket,
- the grade bonus for rushing (`gradeGame`: yards past 3 a carry x 0.12 + 5 a
  TD, capped at +20) may be generous.

---

## 1. The college career (milestone 3)

### What the owner asked for (Nov 2026)
"At first super simple. Similar: win the job, play career as is, no recruiting,
with a 12-team playoff. Needs rankings, real scheduling of opponents with
realism (needs an algorithm), ratings for teams and players, etc. Transfers,
stadium adds, culture, traditions can be added later. The current finished
high school can stay or be picked up if we have the data for it, and have
multiple save games."

### What already exists to build on
- `src/data/colleges.json`: 239 schools (all FBS + ~100 FCS): `id, name, abbr,
  mascot, conference, division (FBS/FCS), tier (P4/G5/FCS), prestige, state,
  colors, logo`. Conferences: SEC 16, BIG TEN 18, ACC 17, BIG 12 16, PAC-12 8,
  MOUNTAIN WEST 9, AMERICAN 14, SUN BELT 13, MAC 12, C-USA 11, INDEPENDENT 2,
  plus the FCS leagues. `college(id)` in `career/recruiting.ts` looks one up.
- A graduated save (`CareerSave.phase === 'done'`) has the player (ratings,
  `xp`, `growth`, `archetype`, `unlocked`), `recruit.signed` (college id, and
  whether it was a walk-on: not in `recruit.offers`), awards and seasons.
- `Career` (`career/career.ts`) is the high school flow: weekly
  `prepareGame()` -> `GamePlan` -> `Game.playCareerGame` -> `finishGame()`, the
  QB battle (backup scenarios: two-minute drill / relief / mop-up with
  `Match.fromSituation`), playoffs, `endSeason()`, `nextSeason()`. The college
  flow should mirror it (a `CollegeCareer` class or a level switch), reusing:
  - `league.ts`: standings, tiebreakers, round-robin helpers (regions of 8 are
    high-school specific: college needs conference schedules instead),
  - `quicksim.ts` (`simGame`, `simUntil`, `simToEnd`): any two `Units`,
  - `news.ts` flavor (poll movement, headlines, storylines, keys, the paper),
  - the UI kit (`ui/kit.ts`, `ui/art.ts`) and the hub layout in `ui/career.ts`.
- Tiers: `Roster.tier` shifts every norm. High school `HS_TIER = -16`, the base
  game (NFL) 0. The agreed college norm for a QB is ~70 overall, so a college
  tier of about **-6** (QB norms acc/arm 72, dec 70). Use a `COLLEGE_TIER` and a
  `COLLEGE_CAP` (~94) for `addXp` (it takes a cap argument).
- `nation.ts` shows how a light weekly model ranks teams that aren't simulated
  in full: the college poll can do the same for all 130+ FBS teams, or simulate
  every FBS game with `simGame` (cheap: ~60 games a week).

### Suggested scope for version 1
- **Save slots**: the save is one key (`footballgame.career.v1`). Add a slot
  list (e.g. `footballgame.careers.v2`: `{ slots: [{ id, label, level }] }`,
  each slot's save under its own key), migrate the current save into slot 1,
  and keep `footballgame.history.v1` (PAST CAREERS) as is. The career start
  screen lists slots: CONTINUE / NEW / and on a graduated high school save a
  GO TO COLLEGE button that creates a college save from it.
  - PAST CAREERS records (`CareerRecord`) don't keep ratings, so only a save
    still on the device can continue into college. Cheap fix worth doing first:
    store `player.r` / `growth` / `archetype` in the record on `archive()` so a
    finished high school career can always be picked up later.
- **Team strength**: each school's offense/defense units from `prestige` each
  year (like high school `rollStrength`, ~ (prestige - 50) / 6 rating points)
  with turnover; FCS schools a few points lower.
- **Scheduling algorithm** (12 games, ~14-15 weeks with byes):
  1. Conference games: 9 for the SEC / BIG TEN / BIG 12 / ACC (SEC is 8 or 9:
     pick 9), 8 for the others; with more teams than games, give each team a
     balanced subset (rotate opponents by a seeded pairing; avoid repeats
     within 2 years if you keep history).
  2. Fill to 12 with non-conference games: P4 schools play ~1 FCS, 1-2 G5 and
     sometimes 1 P4 (prefer in-state / neighbouring-state rivals: `state`
     field); G5 play 1 FCS, 1-2 P4 "money games" and G5 in their region; FCS
     play their conference plus 1 FBS game.
  3. Home / away balance (6-6 or 7-5), byes spread out, rivalry games last
     week of the regular season when both are in the same conference or a
     known pair (a small list of real rivalries is fine as data).
  Build it as a pure function `makeCollegeSchedule(teams, rng)` with tests that
  check: everyone has 12, no duplicates in a week, conference counts right.
- **Rankings**: a top 25 each week from record, margin, strength of schedule
  and preseason prestige (the same shape as `statePoll` / `nationalPoll`), plus
  a CFP ranking after week ~9 that weighs conference titles.
- **Conference championships**: top 2 in each FBS conference by conference
  record (tiebreakers from `league.ts`).
- **The 12-team playoff**: the 5 highest-ranked conference champions plus the
  7 highest-ranked others; seeds 1-4 get byes (seed by the ranking); first
  round at the higher seed's stadium, then quarterfinals, semifinals, the
  title game (neutral sites; name them as bowls for flavor). Everyone else with
  6+ wins gets a bowl game (one quick-simmed or played game).
- **Your path**: arrive as a freshman (scholarship) or walk-on; the QB battle
  meter decides when you start (an incoming 70-74 freshman is in a real battle;
  a walk-on starts lower). Redshirt option: play 4 games or fewer and keep the
  year (eligibility FR/RS-FR/SO/JR/SR, 5 years). Weekly practice focus and
  progression as in high school, capped higher. Season awards (conference
  player of the year, All-American, a Heisman finalist / winner from passing +
  rushing lines and team record).
- **Not in v1** (owner said later): transfers / the portal, NIL, stadium
  upgrades, culture and traditions, NFL draft declaration (that's milestone 4).
- **Tests**: extend `scripts/smoke.cjs` (a high school save goes to college;
  a full college season reaches the playoff; the save round-trips) and add a
  `scripts/balance/college.cjs` like `career.cjs` (when freshmen win the job,
  stats per season, how often a top-10 team makes the playoff).

---

## 2. Abilities (placeholders exist)

`ABILITIES` in `career/player.ts`: one per archetype, earned at a rating
(`hasAbility`, `checkAbility`, `CareerPlayer.unlocked`), shown on the hub, the
create screen and STATS > YOU, with no effect on play yet. To give them
effects:

- **Plumbing**: pass the earned ability ids into the game:
  `CareerGameSetup.abilities` (set in `ui/career.ts` where the setup is built)
  -> `Game` -> `sim.reset(..., { abilities })` for your snaps only (never for
  the CPU, never in exhibitions unless an exhibition unlock system wants it).
- **PRE-SNAP READ** (Pocket Passer, ACC 76): before the snap show the real
  coverage. Today the safeties show a shell (`sim.shell`) that is wrong 35% of
  the time (`applyCall`). With the ability: label `sim.call.coverage` (COVER 3,
  MAN...) in the presnap HUD and flash the defenders in `sim.call.rush` (the
  blitzers). Purely information; no numbers change.
- **FASTBALL** (Gunslinger, ARM 75): extra zip on top of throw power, e.g.
  `zip *= 0.9` (floor ~0.72), or the defender's break on the ball delayed a
  beat on throws under ~15 yds (`updateCoverage` uses `airT >= d.react`).
- **SACK ALERT** (Game Manager, DEC 75): a warning ~0.7 s before a free rusher
  arrives (in `Game.update` while `sim.phase === 'live'`: any rusher with no
  `engagedBy` and `dist(r, qb) / r.speed < 0.7` -> flash the screen edge /
  the QB). Plus a guaranteed throw-away: a throw landing out of bounds (past
  the sideline or the end line) is always incomplete, never picked (in
  `updateBall` the out-of-bounds check already exists for the end line; add
  the sidelines and skip the contest).
- **ESCAPE ARTIST** (Dual Threat, SPD 73): the first sack each play is shaken
  off: in `Sim.update`'s sack check, if the ability is on and not used this
  snap, stun that rusher (`stunUntil`, push him back ~1 yd) and carry on; a
  burst of speed for the first ~2 s of a scramble (`keep()`).
- Measure each with a balance run before and after (they should feel strong
  but not break the targets in `CLAUDE.md`), and add a smoke check that the
  ability only applies when earned.

---

## Other open items (from the owner)
- PINNED (needs the owner's go-ahead): make offensive line ratings matter in
  pass protection (see `docs/FRANCHISE.md`, Backlog).
- Playable kick / punt returns (the MIKE joystick on the returner).
- Camps in the high school off-season.
- Saving a game in progress (closing the app mid-game replays the week).
