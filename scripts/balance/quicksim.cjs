// The career quick-sim vs auto-played games: runs N quick-simmed games at
// auto-play's pace (runoff 6.5 s) with even teams and with +-6 rating edges,
// and prints the same drive/stat lines as drives.cjs, so the two can be compared.
// Usage: node scripts/balance/quicksim.cjs [N] [runoff]
const { chromium } = require('playwright');
const N = +(process.argv[2] || 2000);
const RUNOFF = +(process.argv[3] || 6.5);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  const out = await p.evaluate(({ N, RUNOFF }) => {
    const Q = window.__quicksim; const lines = [];
    for (const edge of [0, 6, -6]) {
      const r = { drives: 0, td: 0, punt: 0, int: 0, downs: 0, half: 0, end: 0, plays: 0, yards: 0, secs: 0, pts: 0, att: 0, cmp: 0, sacks: 0 };
      for (let k = 0; k < N; k++) {
        const m = new (Q.simGame({ off: 0, def: 0 }, { off: 0, def: 0 }, 150).constructor)(Math.random() < 0.5 ? 'you' : 'cpu', 150);
        const u = { you: { off: edge, def: 0 }, cpu: { off: 0, def: 0 } }; // edge: the 'you' offense vs an average defense
        while (!m.over) {
          const d = Q.simDrive(m, u, { runoff: RUNOFF });
          if (d.team !== 'you') continue;
          r.drives++; r[d.end]++; r.plays += d.plays; r.yards += d.yards; r.secs += d.secs;
        }
        r.pts += m.score.you; r.att += m.stats.you.att; r.cmp += m.stats.you.cmp; r.sacks += m.stats.you.sacks;
      }
      const d = r.drives, pct = (x) => (100 * x / d).toFixed(0) + '%';
      lines.push(`edge ${edge >= 0 ? '+' : ''}${edge}: drives/team ${(d / N).toFixed(1)}  pts ${(r.pts / N).toFixed(1)}  TD ${pct(r.td)} punt ${pct(r.punt)} INT ${pct(r.int)} downs ${pct(r.downs)} half ${pct(r.half + r.end)}`
        + `  | plays ${(r.plays / d).toFixed(1)} yds ${(r.yards / d).toFixed(1)} secs ${(r.secs / d).toFixed(0)}  | ypp ${(r.yards / r.plays).toFixed(1)} plays/TD ${(r.plays / r.td).toFixed(1)} cmp ${(100 * r.cmp / r.att).toFixed(0)}% att ${(r.att / N).toFixed(1)} sacks ${(r.sacks / N).toFixed(1)}`);
    }
    return lines.join('\n');
  }, { N, RUNOFF });
  console.log(out, errs.length ? '\nERR ' + errs[0] : '');
  await b.close();
})();
