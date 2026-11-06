const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  console.log(await p.evaluate(() => {
    const g = window.__game; g.paused = true; const sim = g.sim; const YD = 3.15;
    const tests = [['rb-screen', 'RB', 1.1], ['bubble', 'Y', 0.55], ['tunnel', 'Z', 0.85], ['sprint-out', 'H', 1.8], ['sprint-out', 'Y', 1.3], ['roll-cross', 'Z', 2.2], ['roll-cross', 'H', 1.4]];
    const out = [];
    for (const [pid, who, tt] of tests) {
      let n = 0, c = 0, i = 0, y = 0, yac = 0, sk = 0;
      for (let k = 0; k < 120; k++) {
        g.match.offense = 'you'; g.match.drive.ballOn = 35; g.match.drive.down = 1; g.sim.forceCall = null;
        g.startHuddle(); g.pickPlay(window.__plays.find(x => x.id === pid)); sim.snap();
        let t = 0; while (sim.phase === 'live' && t < tt) { sim.update(1/60); t += 1/60; }
        if (sim.phase !== 'live') { n++; if (sim.result === 'sack') sk++; continue; }
        const r = sim.receivers.find(a => a.id === who);
        const rd = window.__cpu.readReceiver(sim, r);
        sim.throwTo(rd.to);
        let catchY = null;
        for (let s = 0; s < 3000 && sim.phase !== 'done'; s++) { sim.update(1/60); if (sim.phase === 'run' && catchY === null) catchY = sim.carrier.y; }
        n++;
        if (sim.result === 'catch') { c++; y += (210 - sim.spotY) / YD; if (catchY !== null) yac += (catchY - sim.spotY) / YD; }
        if (sim.result === 'int') i++;
      }
      out.push(`${(pid + ' -> ' + who).padEnd(18)} cmp ${String(Math.round(100 * c / n)).padStart(3)}%  int ${Math.round(100 * i / n)}%  sack ${Math.round(100 * sk / n)}%  ${(y / n).toFixed(1).padStart(5)} y/a  YAC/catch ${(yac / Math.max(1, c)).toFixed(1)}`);
    }
    return out.join('\n');
  }));
  await b.close();
})();
