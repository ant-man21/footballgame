// Smoke test: loads the built game on an emulated phone and drives it with
// real touch events (Chrome DevTools): pick a play from the playbook, snap and
// throw in one touch (both aim modes), get sacked, run after the catch, punt on
// 4th down, play a defensive snap with the linebacker joystick, auto-play a
// whole game, and check every defensive call fields all 11 players.
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
  const phase = () => G(() => window.__game.sim.phase);
  const waitPhase = (ph, timeout = 10000) =>
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
    g.sim.forceCall = null; g.match.offense = 'you'; g.nextPlay();
    return out;
  });
  check(bad.length === 0, `all calls field 11 v 11 for all ${await G(() => window.__plays.length)} plays ${bad.join(' ')}`);

  // 2. Drive starts at our own 25, 1st & 10.
  check(await G(() => window.__game.match.drive.spotText === 'OWN 25' && window.__game.match.drive.downText === '1ST & 10' && window.__game.match.clockText === '3:00'), 'game starts Q1 3:00, 1ST & 10 at OWN 25');
  // keep the tests below on offense regardless of what happens (e.g. an interception)
  const offense = `const g = window.__game; g.match.offense = 'you'; g.match.drive.down = 1; g.match.drive.toGo = 10; g.match.drive.ballOn = 25;`;

  // 3. Playbook menu: opens on launch; switch tab and pick a play by touch.
  check(await G(() => window.__game.menuOpen), 'playbook menu opens on launch');
  await page.screenshot({ path: `${OUT}/smoke-menu.png` });
  const tabs = await G(() => window.__game.menu.layout(window.__game.view).tabs.map((t) => ({ id: t.cat.id, x: t.r.x + t.r.w / 2, y: t.r.y + t.r.h / 2 })));
  const crossers = tabs.find((t) => t.id === 'crossers');
  await tap(crossers); // CROSSERS tab
  await tap({ x: 47, y: 80 }); // first card
  check(await G(() => !window.__game.menuOpen && window.__game.play.id === 'mesh'), 'picked MESH from the CROSSERS tab');

  // 4. One touch snaps and starts the aim; release throws.
  async function throwPlay(mode, fromL, toL, shot) {
    await G(new Function('m', offense + " g.mode = m; g.sim.forceCall = 'c3'; g.nextPlay();"), mode);
    const a = await toScreen(fromL), b = await toScreen(toL);
    await touch('touchStart', [a]);
    check((await phase()) === 'live', `${mode}: the first touch snaps the ball`);
    for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }]);
    if (shot) await page.screenshot({ path: `${OUT}/${shot}` });
    check(!!(await G(() => window.__game.target())), `${mode}: same touch draws the aim arc`);
    await touch('touchEnd', []);
    await waitPhase('air', 2000);
    check(true, `${mode}: ball flies on release`);
    await page.waitForFunction(() => window.__game.screen === 'banner', null, { timeout: 10000 });
    const r = await G(() => ({ result: window.__game.sim.result, cov: window.__game.sim.call.coverage, s: window.__game.banner }));
    check(r.cov === 'COVER 3' && r.s, `${mode}: ${r.result} vs ${r.cov} -> "${r.s.headline} ${r.s.detail}"`);
  }
  await throwPlay('pull', { x: 90, y: 200 }, { x: 96, y: 230 }, 'smoke-pull.png');
  await page.screenshot({ path: `${OUT}/smoke-result.png` });
  await tap({ x: 90, y: 150 });
  check((await G(() => window.__game.screen)) === 'play', 'tap after the result goes to the next snap');
  await throwPlay('aim', { x: 90, y: 230 }, { x: 60, y: 160 }, 'smoke-aim.png');

  // 5. Run after the catch: the receiver keeps going until tackled, out, or in.
  const yac = await G(() => {
    const g = window.__game; g.paused = true; const sim = g.sim; g.match.offense = 'you'; g.match.drive.down = 1;
    sim.forceCall = 'c3'; g.nextPlay(); sim.snap();
    for (let i = 0; i < 60; i++) sim.update(1 / 60);
    const r = sim.receivers.find((x) => x.id === 'X');
    sim.throwTo({ x: r.x, y: r.y }, true);
    sim.ball.t = sim.ball.dur; // land it on him now
    const caughtAt = r.y;
    sim.ball.to = { x: r.x, y: r.y };
    const seenRun = [];
    for (let i = 0; i < 1200 && sim.phase !== 'done'; i++) { sim.update(1 / 60); seenRun.push(sim.phase); }
    g.paused = false;
    return { ran: seenRun.includes('run'), result: sim.result, yac: (caughtAt - sim.spotY) / 3.15, phase: sim.phase };
  });
  check(yac.ran && yac.phase === 'done', `run after catch: ${yac.result}, ${yac.yac.toFixed(1)} yds after the catch`);
  await G(() => window.__game.nextPlay());

  // 6. Hold the ball against an all-out blitz: should get sacked (a tap with no drag just snaps).
  const sacksBefore = await G(() => window.__game.match.stats.you.sacks);
  await G(new Function(offense + " g.mode = 'pull'; g.sim.forceCall = 'c0'; g.nextPlay();"));
  await tap({ x: 90, y: 150 });
  await waitPhase('done');
  const sackRes = await G(() => window.__game.sim.result + ' ' + window.__game.sim.call.id + ' ball:' + !!window.__game.sim.ball);
  check(sackRes.startsWith('sack'), 'tap without a drag snaps; holding vs COVER 0 ends in a sack (' + sackRes + ')');
  check(await G((n) => window.__game.match.stats.you.sacks === n + 1, sacksBefore), 'the sack counted in your stats');
  await page.waitForFunction(() => window.__game.screen === 'banner');
  await tap({ x: 90, y: 150 });

  // 7. Buttons: MODE toggles; PLAYS reopens the playbook between snaps.
  const before = await G(() => window.__game.mode);
  await tap({ x: 150, y: 310 });
  check((await G(() => window.__game.mode)) !== before, 'MODE button toggles aim mode');
  await G(new Function(offense + ' g.nextPlay();'));
  await tap({ x: 24, y: 310 });
  check(await G(() => window.__game.menuOpen), 'PLAYS button reopens the playbook');
  await tap({ x: 90, y: 309 }); // BACK

  // 8. 4th down: you choose GO FOR IT or PUNT.
  await G(new Function(offense + ' g.match.drive.down = 4; g.match.drive.toGo = 7; g.match.drive.ballOn = 30; g.nextPlay();'));
  check(await G(() => window.__game.fourth === 'ask'), '4th down asks GO FOR IT or PUNT');
  const pb = await G(() => window.__game.fourthButtons.punt);
  await tap({ x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 });
  const punt = await G(() => ({ kind: window.__game.banner && window.__game.banner.kind, head: window.__game.banner && window.__game.banner.headline, note: window.__game.banner && window.__game.banner.note, off: window.__game.match.offense }));
  check(punt.kind === 'punt' && punt.off === 'cpu', `punt: "${punt.head}" ${punt.note}, CPU ball`);

  // 9. Defense: the CPU snaps, its QB's eyes show, and you can take over the MIKE.
  await tap({ x: 90, y: 150 }); // past the punt banner -> CPU offense, you on defense
  check(await G(() => window.__game.match.offense === 'cpu' && !!window.__game.sim.user && window.__game.sim.user.id === 'MIKE'), 'defense: you are the MIKE linebacker');
  await page.screenshot({ path: `${OUT}/smoke-defense-presnap.png` });
  await page.waitForFunction(() => window.__game.sim.phase === 'live', null, { timeout: 5000 });
  check(await G(() => !!window.__game.cpuQb), 'defense: the CPU snapped the ball on its own');
  await page.waitForFunction(() => window.__game.cpuQb && window.__game.cpuQb.eyes, null, { timeout: 3000 });
  const start = await G(() => ({ x: window.__game.sim.user.x, y: window.__game.sim.user.y }));
  const s0 = await toScreen({ x: 90, y: 200 });
  await touch('touchStart', [s0]);
  for (let i = 1; i <= 5; i++) await touch('touchMove', [{ x: s0.x + i * 12, y: s0.y }]); // drag right
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/smoke-defense-live.png` });
  const moved = await G((s) => window.__game.sim.user.x - s.x, start);
  await touch('touchEnd', []);
  check(moved > 3, `defense: joystick moved your linebacker right (${moved.toFixed(1)}px)`);
  await page.waitForFunction(() => window.__game.screen === 'banner', null, { timeout: 15000 });
  check(true, `defense: CPU play resolved -> "${await G(() => window.__game.banner.headline)}"`);

  // 10. A whole game, auto-played: four quarters to a final score; tap starts a new game.
  const fg = await G(() => {
    const g = window.__game; g.sim.forceCall = null; g.autoplay = true; g.newGame(); g.autoplay = true;
    let n = 0; while (g.screen !== 'final' && n < 200000) { g.update(1 / 30); n++; }
    g.autoplay = false;
    const m = g.match;
    return { final: g.screen === 'final', q: m.quarter, score: `${m.score.you}-${m.score.cpu}`, plays: m.stats.you.plays + m.stats.cpu.plays };
  });
  check(fg.final && fg.q === 4, `full game: FINAL ${fg.score} after ${fg.plays} plays`);
  await page.screenshot({ path: `${OUT}/smoke-final.png` });
  await tap({ x: 90, y: 150 });
  check(await G(() => window.__game.screen === 'play' && window.__game.match.quarter === 1 && window.__game.match.score.you === 0), 'tap on the final screen starts a new game');

  // 8. Landscape: turn the phone sideways; same game, bigger field between side panels.
  const lctx = await browser.newContext({ ...devices['Pixel 7 landscape'] });
  const lp = await lctx.newPage();
  lp.on('pageerror', (e) => errors.push(e.message));
  await lp.goto(URL);
  const lcdp = await lctx.newCDPSession(lp);
  const LG = (fn, arg) => lp.evaluate(fn, arg);
  const ltouch = (type, pts) => lcdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  const lscreen = (q) => LG(({ x, y }) => {
    const r = document.getElementById('game').getBoundingClientRect(), v = window.__game.view;
    return { x: r.left + (x / v.w) * r.width, y: r.top + (y / v.h) * r.height };
  }, q);
  const lw = await LG(() => window.__game.view.landscape ? document.getElementById('game').width : 0);
  check(lw >= 320, `landscape: ${lw}x180 view (fills a ${(915/412).toFixed(2)}:1 phone) when the phone is sideways`);
  const card = await LG(() => { const g = window.__game; const c = g.menu.layout(g.view).cards[2]; return { x: c.r.x + c.r.w / 2, y: c.r.y + c.r.h / 2, id: c.play.id }; });
  const cp = await lscreen(card);
  await ltouch('touchStart', [cp]); await ltouch('touchEnd', []);
  check(await LG((id) => !window.__game.menuOpen && window.__game.play.id === id, card.id), `landscape: picked ${card.id} from a 3-column playbook`);
  await LG(() => { const g = window.__game; g.match.offense = 'you'; g.match.drive.down = 1; g.mode = 'pull'; g.sim.forceCall = 'c4'; g.nextPlay(); });
  const a = await lscreen({ x: 160, y: 110 }), b = await lscreen({ x: 160, y: 140 });
  await ltouch('touchStart', [a]);
  for (let i = 1; i <= 8; i++) await ltouch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }]);
  await lp.screenshot({ path: `${OUT}/smoke-landscape.png` });
  await ltouch('touchEnd', []);
  await lp.waitForFunction(() => window.__game.sim.phase === 'air', null, { timeout: 2000 });
  await lp.waitForFunction(() => window.__game.screen === 'banner', null, { timeout: 10000 });
  check(await LG(() => !!window.__game.banner), `landscape: touch-drag throw resolves (${await LG(() => window.__game.banner.headline)})`);
  await lp.setViewportSize({ width: 412, height: 915 });
  await lp.waitForTimeout(200);
  check(await LG(() => !window.__game.view.landscape && document.getElementById('game').width === 180), 'rotating back switches to portrait');

  await browser.close();
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
  console.log('SMOKE OK');
})().catch((e) => { console.error('SMOKE FAIL:', e.message); process.exit(1); });
