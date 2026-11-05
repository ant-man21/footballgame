// Smoke test: loads the built game on an emulated phone and drives it with
// real touch events (Chrome DevTools): pick a play from the playbook, snap,
// throw in both aim modes, get sacked, and check every defensive call fields
// all 11 players.
// Usage: npm run build && npx vite preview --port 4173 &  then  npm run test:smoke
const { chromium, devices } = require('playwright');

const URL = process.env.GAME_URL || 'http://localhost:4173/';
const OUT = process.env.SHOT_DIR || '.';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL);
  const cdp = await context.newCDPSession(page);

  const G = (fn, arg) => page.evaluate(fn, arg);
  const toScreen = (p) => G(({ x, y }) => {
    const r = document.getElementById('game').getBoundingClientRect();
    return { x: r.left + (x / 180) * r.width, y: r.top + (y / 320) * r.height };
  }, p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const tap = async (p) => { await touch('touchStart', [await toScreen(p)]); await touch('touchEnd', []); };
  const waitPhase = (ph, timeout = 8000) =>
    page.waitForFunction((ph) => window.__game.sim.phase === ph, ph, { timeout });
  const check = (cond, msg) => { if (!cond) throw new Error(msg); console.log('ok  ' + msg); };

  // 1. Every defensive call accounts for all 11 defenders, for every play.
  const bad = await G(() => {
    const g = window.__game; const out = [];
    for (const call of ['c0', 'c1-blitz', 'c1', 'c2', 'c2-drop', 'c3', 'c3-fire', 'c4', 'c4-drop']) {
      for (const play of window.__plays) {
        g.sim.forceCall = call; g.sim.reset(play);
        const d = g.sim.defense;
        const n = d.filter((x) => ['rush', 'man', 'zone'].includes(x.job)).length;
        if (d.length !== 11 || n !== 11 || g.sim.offense.length !== 11) out.push(`${call}/${play.id}`);
      }
    }
    g.sim.forceCall = null; g.sim.reset(g.play);
    return out;
  });
  check(bad.length === 0, `all calls field 11 v 11 ${bad.join(' ')}`);

  // 2. Playbook menu: opens on launch; switch tab and pick a play by touch.
  check(await G(() => window.__game.menuOpen), 'playbook menu opens on launch');
  await page.screenshot({ path: `${OUT}/smoke-menu.png` });
  await tap({ x: 90, y: 34 }); // CORE tab
  await tap({ x: 47, y: 100 }); // first card
  check(await G(() => !window.__game.menuOpen && window.__game.play.id === 'mesh'), 'picked MESH from the CORE tab');

  // 3. Tap to snap, then throw (pull mode).
  async function throwPlay(mode, fromL, toL, shot) {
    await G((m) => { window.__game.mode = m; window.__game.sim.forceCall = 'c3'; window.__game.sim.reset(window.__game.play); }, mode);
    await tap({ x: 90, y: 150 });
    await waitPhase('live');
    const a = await toScreen(fromL), b = await toScreen(toL);
    await touch('touchStart', [a]);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }]);
    if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
    check(!!(await G(() => window.__game.target())), `${mode}: aim arc while dragging`);
    await touch('touchEnd', []);
    check((await G(() => window.__game.sim.phase)) === 'air', `${mode}: ball flies on release`);
    await waitPhase('done');
    const r = await G(() => ({ result: window.__game.sim.result, cov: window.__game.sim.call.coverage }));
    check(r.cov === 'COVER 3', `${mode}: throw resolved as ${r.result} vs ${r.cov}`);
  }
  await throwPlay('pull', { x: 90, y: 200 }, { x: 96, y: 240 }, 'smoke-pull.png');
  await page.screenshot({ path: `${OUT}/smoke-result.png` });
  await tap({ x: 90, y: 150 }); // tap past the result
  check((await G(() => window.__game.sim.phase)) === 'presnap', 'tap after result goes to next snap');
  await throwPlay('aim', { x: 90, y: 250 }, { x: 60, y: 170 }, 'smoke-aim.png');

  // 4. Hold the ball against an all-out blitz: should get sacked.
  await G(() => { window.__game.sim.forceCall = 'c0'; window.__game.sim.reset(window.__game.play); });
  await tap({ x: 90, y: 150 });
  await waitPhase('done', 10000);
  check((await G(() => window.__game.sim.result)) === 'sack', 'holding the ball vs COVER 0 ends in a sack');

  // 5. Buttons: MODE toggles; PLAYS reopens the playbook between snaps.
  const before = await G(() => window.__game.mode);
  await tap({ x: 150, y: 310 });
  check((await G(() => window.__game.mode)) !== before, 'MODE button toggles aim mode');
  await G(() => window.__game.sim.reset(window.__game.play));
  await tap({ x: 24, y: 310 });
  check(await G(() => window.__game.menuOpen), 'PLAYS button reopens the playbook');

  await browser.close();
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  console.log('SMOKE OK');
})().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
