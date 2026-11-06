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
    const ui = window.__careerUI, Q = window.__quicksim, C = window.__recruiting;
    const agg = { offers: { P4: 0, G5: 0, FCS: 0 }, best: { P4: 0, G5: 0, FCS: 0, none: 0 }, byStars: {}, jrOffers: 0, firstOffer: 0, firstOfferN: 0, app: [0, 0, 0], games: [0, 0, 0], kinds: {}, battleEnd: [0, 0], wonJob: 0, wonWeek: 0, ovr: [0, 0, 0], stars: [0, 0, 0], wins: [0, 0, 0], titles: 0, playoffs: [0, 0, 0], grade: [0, 0, 0], gradeN: [0, 0, 0], pf: 0, gamesAll: 0 };
    for (let k = 0; k < N; k++) {
      const c = ui.create('TEST', 'QB', 'TX', ['pocket', 'gunslinger', 'manager'][k % 3]);
      let guard = 0;
      while (c.s.phase !== 'done' && guard++ < 100) {
        if (c.s.phase === 'summary') { c.nextSeason(); continue; }
        if (c.s.phase === 'signing') {
          const offers = c.s.recruit.offers.map((id) => C.college(id)).sort((a, b) => b.prestige - a.prestige);
          const tiers = { P4: 0, G5: 0, FCS: 0 }; offers.forEach((o) => tiers[o.tier]++);
          for (const t of Object.keys(tiers)) agg.offers[t] += tiers[t];
          const best = offers[0]; agg.best[best ? best.tier : 'none']++;
          agg.byStars[c.s.recruit.stars] = agg.byStars[c.s.recruit.stars] || { n: 0, offers: 0, P4: 0, G5: 0, FCS: 0, none: 0 };
          const bs = agg.byStars[c.s.recruit.stars]; bs.n++; bs.offers += offers.length; bs[best ? best.tier : 'none']++;
          agg.jrOffers += c.s.recruit.offers.length ? 1 : 0;
          c.sign(best ? best.id : C.walkOns(c.s.recruit, c.s.state)[0].id);
          continue;
        }
        const yr = c.s.year, wasBackup = c.s.role === 'backup';
        const plan = c.prepareGame();
        let stint;
        if (plan.kind !== 'none') {
          agg.kinds[plan.label] = (agg.kinds[plan.label] || 0) + 1;
          if (plan.endAtHalf) { Q.simUntil(plan.match, plan.units, (m) => m.quarter >= 3); stint = { ...plan.match.stats.you }; }
          else Q.simToEnd(plan.match, plan.units);
        }
        const nOff = c.s.recruit.offers.length;
        const log = c.finishGame(plan, stint);
        if (!nOff && c.s.recruit.offers.length) { agg.firstOffer += yr + log.week / 14; agg.firstOfferN++; }
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
      `offers per career: P4 ${(agg.offers.P4 / N).toFixed(1)}  G5 ${(agg.offers.G5 / N).toFixed(1)}  FCS ${(agg.offers.FCS / N).toFixed(1)}   best offer: P4 ${agg.best.P4}  G5 ${agg.best.G5}  FCS ${agg.best.FCS}  none ${agg.best.none} (of ${N})   first offer ~ year ${(agg.firstOffer / Math.max(1, agg.firstOfferN)).toFixed(2)} (0 = SO)`,
      'by final stars: ' + Object.entries(agg.byStars).sort().map(([k, b]) => `${k}*: ${b.n} careers, ${(b.offers / b.n).toFixed(1)} offers, best P4 ${b.P4} G5 ${b.G5} FCS ${b.FCS} none ${b.none}`).join(' | '),
      `made playoffs ${agg.playoffs.map((x) => (100 * x / N).toFixed(0) + '%').join(' / ')}   state titles ${(100 * agg.titles / N).toFixed(0)}% of careers   your team ${(agg.pf / agg.gamesAll).toFixed(1)} pts/game`,
    ].join('\n');
  }, N);
  console.log(out, errs.length ? '\nERR ' + errs[0] : '');
  await b.close();
})();
