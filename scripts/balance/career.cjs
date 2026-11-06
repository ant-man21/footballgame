// Plays N whole high school careers fast (your stints are quick-simmed too, at
// an average QB's level of play) and reports how a career unfolds: how often a
// backup gets in, the QB battle, when you win the job, ratings, stars, records.
// Usage: node scripts/balance/career.cjs [N]
const { chromium } = require('playwright');
const N = +(process.argv[2] || 40);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  const out = await p.evaluate((N) => {
    const ui = window.__careerUI, Q = window.__quicksim;
    const agg = { app: [0, 0, 0], games: [0, 0, 0], kinds: {}, battleEnd: [0, 0], wonJob: 0, wonWeek: 0, ovr: [0, 0, 0], stars: [0, 0, 0], wins: [0, 0, 0], titles: 0, playoffs: [0, 0, 0], grade: [0, 0, 0], gradeN: [0, 0, 0], pf: 0, gamesAll: 0 };
    for (let k = 0; k < N; k++) {
      const c = ui.create('TEST', 'QB', 'TX', ['pocket', 'gunslinger', 'manager'][k % 3]);
      let guard = 0;
      while (c.s.phase !== 'done' && guard++ < 100) {
        if (c.s.phase === 'summary') { c.nextSeason(); continue; }
        const yr = c.s.year, wasBackup = c.s.role === 'backup';
        const plan = c.prepareGame();
        let stint;
        if (plan.kind !== 'none') {
          agg.kinds[plan.label] = (agg.kinds[plan.label] || 0) + 1;
          if (plan.endAtHalf) { Q.simUntil(plan.match, plan.units, (m) => m.quarter >= 3); stint = { ...plan.match.stats.you }; }
          else Q.simToEnd(plan.match, plan.units);
        }
        const log = c.finishGame(plan, stint);
        agg.games[yr]++; if (log.kind !== 'none') agg.app[yr]++;
        if (log.grade !== null) { agg.grade[yr] += log.grade; agg.gradeN[yr]++; }
        if (wasBackup && c.s.role === 'starter') { agg.wonJob++; agg.wonWeek += log.week; }
        agg.pf += log.us; agg.gamesAll++;
        if (c.s.phase === 'summary' && yr < 2 && wasBackup) agg.battleEnd[yr] += c.s.battle;
      }
      c.player.seasons.forEach((s, i) => {
        agg.ovr[i] += s.ovr; agg.stars[i] += s.stars; agg.wins[i] += +s.record.split('-')[0];
        if (s.finish !== 'MISSED THE PLAYOFFS') agg.playoffs[i]++;
        if (s.finish === 'STATE CHAMPIONS') agg.titles++;
      });
    }
    const f = (a, d = 1) => a.map((x) => (x / d).toFixed(1)).join(' / ');
    return [
      `${N} careers (SO / JR / SR)`,
      `games ${f(agg.games, N)}   appearances ${f(agg.app, N)}   avg grade ${agg.grade.map((g, i) => (g / Math.max(1, agg.gradeN[i])).toFixed(0)).join(' / ')}`,
      `backup stints: ${Object.entries(agg.kinds).filter(([k]) => k !== 'YOU START').map(([k, n]) => `${k} ${(n / N).toFixed(1)}`).join('  ')}`,
      `QB battle at season end: SO ${(agg.battleEnd[0] / N).toFixed(0)}  JR (still backup) ${(agg.battleEnd[1] / Math.max(1, N - agg.wonJob)).toFixed(0)}`,
      `won the job as a junior: ${(100 * agg.wonJob / N).toFixed(0)}%  (avg week ${(agg.wonWeek / Math.max(1, agg.wonJob)).toFixed(1)})`,
      `OVR at season end ${f(agg.ovr, N)}   stars ${f(agg.stars, N)}   team wins ${f(agg.wins, N)}`,
      `made playoffs ${agg.playoffs.map((x) => (100 * x / N).toFixed(0) + '%').join(' / ')}   state titles ${(100 * agg.titles / N).toFixed(0)}% of careers   your team ${(agg.pf / agg.gamesAll).toFixed(1)} pts/game`,
    ].join('\n');
  }, N);
  console.log(out, errs.length ? '\nERR ' + errs[0] : '');
  await b.close();
})();
