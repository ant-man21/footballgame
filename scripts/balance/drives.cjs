// Plays N auto games and reports what drives turn into (TD / punt / INT /
// downs / end of half), plays, yards and clock per drive. The career quick-sim
// is calibrated against these numbers. Usage: node scripts/balance/drives.cjs N [quarterMinutes]
const { chromium } = require('playwright');
const N = +(process.argv[2] || 10);
const Q = process.argv[3] || '2.5';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  const out = await p.evaluate(({ N, Q }) => {
    const g = window.__game; g.settings.quarter = Q;
    const res = { drives: 0, td: 0, punt: 0, int: 0, downs: 0, half: 0, plays: 0, yards: 0, secs: 0, games: 0, pts: 0, att: 0, cmp: 0, py: 0, sacks: 0 };
    for (let k = 0; k < N; k++) {
      g.sim.forceCall = null; g.autoplay = true; g.newGame(); g.autoplay = true;
      const m = g.match;
      let cur = { off: m.offense, start: m.drive.ballOn, plays: 0, t0: (m.quarter - 1) * m.quarterSeconds + (m.quarterSeconds - m.clock) };
      const elapsed = () => (m.quarter - 1) * m.quarterSeconds + (m.quarterSeconds - m.clock);
      const close = (kind) => { res.drives++; res[kind]++; res.plays += cur.plays; res.secs += elapsed() - cur.t0; };
      const ap = m.afterPlay.bind(m), pu = m.punt.bind(m);
      const halfOf = (q) => (q <= 2 ? 1 : 2);
      // the half can also run out between plays: close that drive before the next play
      const checkHalf = () => { if (halfOf(m.quarter) !== cur.half) { close('half'); cur = { off: m.offense, start: m.drive.ballOn, plays: 0, t0: elapsed(), half: halfOf(m.quarter) }; } };
      cur.half = 1;
      m.afterPlay = (sim, s) => {
        checkHalf();
        const q = m.quarter; cur.plays++;
        const b = ap(sim, s);
        const h = b.headline;
        if (/TOUCHDOWN/.test(h)) close('td'); else if (/INTERCEPTED|PICKED/.test(h)) close('int'); else if (/DOWNS/.test(h)) close('downs');
        else if ((q === 2 && m.quarter === 3) || m.over) close('half');
        else return b;
        cur = { off: m.offense, start: m.drive.ballOn, plays: 0, t0: elapsed(), half: halfOf(m.quarter) };
        return b;
      };
      m.punt = () => { checkHalf(); close('punt'); const b = pu(); cur = { off: m.offense, start: m.drive.ballOn, plays: 0, t0: elapsed(), half: halfOf(m.quarter) }; return b; };
      let n = 0; while (g.screen !== 'final' && n < 300000) { g.update(1 / 30); n++; }
      if (cur.plays) close('half'); // the last drive of the game
      res.games++; res.pts += m.score.you + m.score.cpu;
      for (const s of ['you', 'cpu']) { res.yards += m.stats[s].yards; res.att += m.stats[s].att; res.cmp += m.stats[s].cmp; res.sacks += m.stats[s].sacks; }
    }
    return res;
  }, { N, Q });
  const r = out, d = r.drives;
  const pct = (x) => (100 * x / d).toFixed(0) + '%';
  console.log(`quarters ${Q} min, ${r.games} games: drives/game/team ${(d / r.games / 2).toFixed(1)}  pts/team ${(r.pts / r.games / 2).toFixed(1)}`);
  console.log(`drive ends: TD ${pct(r.td)}  punt ${pct(r.punt)}  INT ${pct(r.int)}  downs ${pct(r.downs)}  half ${pct(r.half)}`);
  console.log(`per drive: plays ${(r.plays / d).toFixed(1)}  yards ${(r.yards / d).toFixed(1)}  secs ${(r.secs / d).toFixed(0)}`);
  console.log(`per team-game: att ${(r.att / r.games / 2).toFixed(1)}  cmp ${(100 * r.cmp / r.att).toFixed(0)}%  yds ${(r.yards / r.games / 2).toFixed(0)}  sacks ${(r.sacks / r.games / 2).toFixed(1)}`, errs.length ? 'ERR ' + errs[0] : '');
  await b.close();
})();
