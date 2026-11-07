// Career "DEFENSE: SIMULATED": what the other team's simulated drives produce,
// by matchup (their offense minus your defense, before the SIM_DEF bonus) and
// by where the drive starts. Usage: node scripts/balance/simdefense.cjs [N] [bonus] [runoff]
const { chromium } = require('playwright');
const N = +(process.argv[2] || 3000);
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto(process.env.GAME_URL || 'http://localhost:4173/');
  console.log(await p.evaluate(({ N, bonus, runoff }) => {
    const Q = window.__quicksim, S = window.__simDef; const out = [];
    const B = isNaN(bonus) ? S.bonus : bonus, R = isNaN(runoff) ? S.runoff : runoff;
    out.push(`bonus ${B}, runoff ${R}s`);
    const Match = Q.simGame({ off: 0, def: 0 }, { off: 0, def: 0 }, 150).constructor;
    for (const edge of [-4, 0, 4, 8]) {
      const row = [];
      for (const start of [25, 50, 70]) {
        const r = { td: 0, punt: 0, int: 0, downs: 0, secs: 0, n: 0 };
        for (let k = 0; k < N; k++) {
          const m = new Match('cpu', 240); m.drive.ballOn = start; m.drive.toGo = 10;
          const d = Q.simDrive(m, { you: { off: 0, def: B }, cpu: { off: edge, def: 0 } }, { runoff: R });
          r.n++; if (d.end in r) r[d.end]++; r.secs += d.secs;
        }
        row.push(`from ${start === 50 ? 'midfield' : start < 50 ? `own ${start}` : `opp ${100 - start}`}: TD ${(100 * r.td / r.n).toFixed(0)}% (${(r.secs / r.n).toFixed(0)}s)`);
      }
      out.push(`their offense ${edge >= 0 ? '+' : ''}${edge} vs your defense: ` + row.join('   '));
    }
    return out.join('\n');
  }, { N, bonus: +process.argv[3], runoff: +process.argv[4] }));
  await b.close();
})();
