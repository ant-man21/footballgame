// Route audit: throw each route at its ideal moment (just after the break),
// perfectly led, and see how often it works vs man and vs zone.
const { chromium } = require('playwright');
const N = +(process.argv[2] || 12);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  p.on('pageerror', e => console.log('PAGEERR', e.message));
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  const out = await p.evaluate((N) => {
    const g = window.__game; g.paused = true; g.menuOpen = false; const sim = g.sim; const YD = 3.15;
    const calls = ['c0','c1-blitz','c1','c2','c2-drop','c3','c3-fire','c4','c4-drop'];
    const fam = { c0: 'man', 'c1-blitz': 'man', c1: 'man', c2: 'zone', 'c2-drop': 'zone', c3: 'zone', 'c3-fire': 'zone', c4: 'zone', 'c4-drop': 'zone' };
    const R = {};
    const SHORT = new Set(['slant','hitch','curl','flat','stick','snag','speedOut','in5','out','checkdown','drag','dragHigh','shallow','swing']);
    for (const play of window.__plays) for (const pr of play.routes) {
      if (pr.route === 'block' || !SHORT.has(pr.route)) continue;
      for (const cid of calls) for (let n = 0; n < N; n++) {
        sim.forceCall = cid; g.match.offense = 'you'; g.match.drive.ballOn = 35; g.match.drive.down = 1; g.match.drive.ballX = 0; g.startHuddle(); g.pickPlay(play); sim.snap();
        const r = sim.receivers.find(a => a.id === pr.who);
        // throw when he finishes his first leg (the break), or at 1.6s at the latest
        let t = 0; while (sim.phase === 'live' && t < 3) { sim.update(1/60); t += 1/60; if (r.leg >= Math.min(1, r.path.length - 1) && t > 0.5) break; }
        if (sim.phase !== 'live') continue;
        const rd = window.__cpu.readReceiver(sim, r);
        sim.throwTo(rd.to);
        let k = 0; while (sim.phase !== 'done' && k < 2000) { sim.update(1/60); k++; }
        const key = `${pr.route}`; const f = fam[cid];
        const e = (R[key] ||= { man: { n: 0, c: 0, i: 0, y: 0 }, zone: { n: 0, c: 0, i: 0, y: 0 } })[f];
        e.n++; if (sim.result === 'catch') { e.c++; e.y += (210 - sim.spotY) / YD; } if (sim.result === 'int') e.i++;
      }
    }
    return R;
  }, N);
  const fmt = (e) => `${String(Math.round(100 * e.c / e.n)).padStart(3)}% cmp ${String(Math.round(100 * e.i / e.n)).padStart(2)}% int ${(e.y / e.n).toFixed(1).padStart(4)} y/a (n${e.n})`;
  console.log('route        vs MAN                         vs ZONE');
  for (const [k, v] of Object.entries(out).sort()) console.log(k.padEnd(12), fmt(v.man).padEnd(30), fmt(v.zone));
  await b.close();
})();
