const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  console.log(await p.evaluate(() => {
    const g = window.__game; g.paused = true; const sim = g.sim; const YD = 3.15;
    if (g.newGame) g.newGame();
    let plays = 0, standing = 0, clusters = 0;
    for (let k = 0; k < 600; k++) {
      g.match.offense = 'you'; g.match.drive.ballOn = 35; g.match.drive.down = 1; if ('ballX' in g.match.drive) g.match.drive.ballX = 0; sim.forceCall = null;
      g.startHuddle(); g.pickPlay(window.__plays[k % window.__plays.length]); sim.snap();
      let t = 0; while (sim.phase === 'live' && t < 1.0) { sim.update(1/60); t += 1/60; }
      const cov = () => sim.defense.filter(d => d.job === 'man' || d.job === 'zone');
      const before = cov().map(d => ({ d, x: d.x, y: d.y }));
      while (sim.phase === 'live' && t < 1.5) { sim.update(1/60); t += 1/60; }
      if (sim.phase !== 'live') continue;
      plays++;
      standing += before.filter(o => Math.hypot(o.d.x - o.x, o.d.y - o.y) / YD < 0.5).length;
      const mid = cov().filter(d => Math.abs(d.x - sim.qb.x) / YD < 9);
      if (mid.some(a => mid.filter(b => Math.hypot(a.x - b.x, a.y - b.y) / YD < 4).length >= 3)) clusters++;
    }
    return `coverage defenders standing still (1.0-1.5s): ${(standing / plays).toFixed(2)} per play;  3+ bunched in the middle: ${Math.round(100 * clusters / plays)}% of plays`;
  }));
  await b.close();
})();
