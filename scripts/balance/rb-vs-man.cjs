const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  console.log(await p.evaluate(() => {
    const g = window.__game; g.paused = true; const sim = g.sim; const YD = 3.15; const out = [];
    for (const [pid, tt] of [['four-verts', 1.6], ['mesh', 1.4], ['texas', 1.5], ['levels', 1.6]]) {
      for (const fam of [['c1', 'c1-blitz', 'c2-man', 'c1-press', 'c1-lurk'], ['c3', 'c2', 'c4']]) {
        let n = 0, c = 0, y = 0, sep = 0;
        for (let i = 0; i < 150; i++) {
          sim.forceCall = fam[i % fam.length];
          g.match.offense = 'you'; g.match.drive.ballOn = 35; g.match.drive.down = 1; g.match.drive.ballX = 0;
          g.startHuddle(); g.pickPlay(window.__plays.find(x => x.id === pid)); sim.snap();
          let t = 0; while (sim.phase === 'live' && t < tt) { sim.update(1/60); t += 1/60; }
          if (sim.phase !== 'live') { n++; continue; }
          const rb = sim.receivers.find(a => a.id === 'RB');
          const cov = sim.defense.filter(d => d.job === 'man' || d.job === 'zone');
          sep += Math.min(...cov.map(d => Math.hypot(d.x - rb.x, d.y - rb.y))) / YD;
          sim.throwTo(window.__cpu.readReceiver(sim, rb).to);
          for (let s = 0; s < 3000 && sim.phase !== 'done'; s++) sim.update(1/60);
          n++; if (sim.result === 'catch') { c++; y += (210 - sim.spotY) / YD; }
        }
        out.push(`${pid.padEnd(11)} RB vs ${fam[0] === 'c1' ? 'MAN ' : 'ZONE'}: sep at throw ${(sep / n).toFixed(1)} yd  cmp ${Math.round(100 * c / n)}%  ${(y / n).toFixed(1)} y/a`);
      }
    }
    return out.join('\n');
  }));
  await b.close();
})();
