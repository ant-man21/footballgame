// Plays N auto games (CPU brain on both sides) and reports offense averages.
const { chromium } = require('playwright');
const N = +(process.argv[2] || 10);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  const out = await p.evaluate((N) => {
    const g = window.__game; g.menuOpen = false;
    const tot = { plays: 0, yards: 0, tds: 0, cmp: 0, att: 0, int: 0, sacks: 0 }; const scores = [];
    for (let k = 0; k < N; k++) {
      g.sim.forceCall = null; g.autoplay = true; g.newGame(); g.autoplay = true;
      let n = 0; while (g.screen !== 'final' && n < 300000) { g.update(1 / 30); n++; }
      for (const side of ['you', 'cpu']) for (const k2 of Object.keys(tot)) tot[k2] += g.match.stats[side][k2];
      scores.push(`${g.match.score.you}-${g.match.score.cpu}`);
    }
    return { tot, scores };
  }, N);
  const t = out.tot;
  console.log(`per offense: ypp ${(t.yards / t.plays).toFixed(1)}  plays/TD ${(t.plays / t.tds).toFixed(1)}  cmp ${(100 * t.cmp / t.att).toFixed(0)}%  int ${(100 * t.int / t.att).toFixed(1)}%  sack ${(100 * t.sacks / t.plays).toFixed(1)}%  plays/game ${(t.plays / N).toFixed(0)}`);
  console.log('scores:', out.scores.join('  '), errs.length ? 'ERR ' + errs[0] : '');
  await b.close();
})();
