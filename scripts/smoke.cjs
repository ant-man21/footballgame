// Smoke test: loads the built game on an emulated phone, does real touch
// drags (via Chrome DevTools touch events) in both aim modes, and checks that
// each throw resolves to a catch, interception or incompletion.
// Usage: npm run build && npx vite preview --port 4173 & npm run test:smoke
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

  const toScreen = (p) => page.evaluate(({ x, y }) => {
    const r = document.getElementById('game').getBoundingClientRect();
    return { x: r.left + (x / 180) * r.width, y: r.top + (y / 320) * r.height };
  }, p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const waitPhase = (ph) => page.waitForFunction((ph) => window.__game.phase === ph, ph, { timeout: 5000 });
  const total = () => page.evaluate(() => { const s = window.__game.stats; return s.cmp + s.int + s.inc; });

  async function throwPlay(mode, fromL, toL, shot) {
    await waitPhase('live');
    await page.evaluate((m) => { window.__game.mode = m; }, mode);
    const a = await toScreen(fromL), b = await toScreen(toL);
    await touch('touchStart', [a]);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }]);
    }
    if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
    const target = await page.evaluate(() => window.__game.target());
    if (!target) throw new Error(`${mode}: no aim target while dragging`);
    const before = await total();
    await touch('touchEnd', []);
    if ((await page.evaluate(() => window.__game.phase)) !== 'air') throw new Error(`${mode}: ball did not fly on release`);
    await waitPhase('done');
    if ((await total()) !== before + 1) throw new Error(`${mode}: throw did not resolve`);
    const msg = await page.evaluate(() => window.__game.message);
    console.log(`${mode}: target=(${target.x.toFixed(0)},${target.y.toFixed(0)}) -> ${msg}`);
  }

  // Pull mode: drag down from mid-field, ball goes up-field.
  await throwPlay('pull', { x: 90, y: 200 }, { x: 100, y: 250 }, 'shot-pull.png');
  // Aim mode: the finger is the landing spot.
  await throwPlay('aim', { x: 90, y: 260 }, { x: 40, y: 140 }, 'shot-aim.png');

  // Tapping the MODE button toggles the mode and does not start a throw.
  await waitPhase('live');
  const before = await page.evaluate(() => window.__game.mode);
  const btn = await toScreen({ x: 150, y: 310 });
  await touch('touchStart', [btn]); await touch('touchEnd', []);
  const after = await page.evaluate(() => window.__game.mode);
  if (before === after) throw new Error('mode button did not toggle');
  console.log(`mode button: ${before} -> ${after}`);

  await browser.close();
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  console.log('SMOKE OK');
})().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
