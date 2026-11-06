const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  console.log(await p.evaluate(() => {
    const g = window.__game; const out = [];
    const ovr = (t) => Math.round(t.players.reduce((s, x) => s + x.ovr, 0) / t.players.length);
    for (const diff of ['rookie', 'pro', 'allpro']) {
      g.settings.difficulty = diff; g.settings.quarter = '2.5';
      const tot = { you: { plays: 0, yards: 0, tds: 0 }, cpu: { plays: 0, yards: 0, tds: 0 } }; let cpuOvr = 0;
      for (let k = 0; k < 8; k++) {
        g.sim.forceCall = null; g.autoplay = true; g.newGame(); g.autoplay = true; cpuOvr += ovr(g.cpuTeam);
        let n = 0; while (g.screen !== 'final' && n < 300000) { g.update(1 / 30); n++; }
        for (const s of ['you', 'cpu']) for (const k2 of ['plays', 'yards', 'tds']) tot[s][k2] += g.match.stats[s][k2];
      }
      const f = (s) => `${(tot[s].yards / tot[s].plays).toFixed(1)} ypp, ${(tot[s].plays / Math.max(1, tot[s].tds)).toFixed(1)} plays/TD`;
      out.push(`${diff.padEnd(7)} (you OVR ${ovr(g.team)} vs CPU OVR ~${Math.round(cpuOvr / 8)}):  your offense ${f('you')}   CPU offense ${f('cpu')}`);
    }
    return out.join('\n');
  }));
  if (errs.length) console.log('ERR', errs[0]);
  await b.close();
})();
