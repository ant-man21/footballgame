// Smoke test: loads the built game on an emulated phone and drives it with
// real touch events (Chrome DevTools): call a play in the huddle, snap and
// throw in one touch (both aim modes), get sacked, run after the catch, punt on
// 4th down, call a defense and play a snap with the linebacker joystick, pause
// (timeout, settings, restart), the clock between plays and the two-minute
// warning, auto-play a whole game, and check every call fields 11 players.
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
    for (const call of ['c0', 'c1-blitz', 'c1', 'c2', 'c2-drop', 'c3', 'c3-fire', 'c4', 'c4-drop', 'c2-man', 'c6', 'tampa2', 'c1-press', 'c1-lurk', 'c3-buzz', 'nickel-fire', 'c4-blitz']) {
      for (const play of window.__plays) {
        g.sim.forceCall = call; g.sim.reset(play);
        const d = g.sim.defense;
        const n = d.filter((x) => ['rush', 'man', 'zone'].includes(x.job)).length;
        if (d.length !== 11 || n !== 11 || g.sim.offense.length !== 11) out.push(`${call}/${play.id}`);
      }
    }
    g.sim.forceCall = null; g.match.offense = 'you'; g.startHuddle();
    return out;
  });
  check(bad.length === 0, `all calls field 11 v 11 for all ${await G(() => window.__plays.length)} plays ${bad.join(' ')}`);

  // 1b. The defense adapts: after 8 straight Smash calls (built to beat Cover 2), it calls Cover 2 / Tampa 2 less.
  const adapt = await G(() => {
    const g = window.__game; const smash = window.__plays.find((p) => p.id === 'smash');
    const rate = (hist) => { let n = 0; g.history = hist; for (let i = 0; i < 400; i++) { g.match.offense = 'you'; g.match.drive.down = 1; g.startHuddle(); g.pickPlay(smash); if (['COVER 2', 'TAMPA 2'].includes(g.sim.call.coverage)) n++; } return n / 400; };
    const base = rate([]), seen = rate(Array(8).fill('smash'));
    g.history = []; g.lastPlayId = null; g.startHuddle();
    return { base, seen };
  });
  check(adapt.seen < adapt.base * 0.6, `defense adapts: Cover 2 looks vs Smash ${Math.round(adapt.base * 100)}% fresh -> ${Math.round(adapt.seen * 100)}% after 8 straight calls`);

  // 2. Drive starts at our own 25, 1st & 10.
  check(await G(() => window.__game.match.drive.spotText === 'OWN 25' && window.__game.match.drive.downText === '1ST & 10' && window.__game.match.clockText === '3:00'), 'game starts Q1 3:00, 1ST & 10 at OWN 25');
  // keep the tests below on offense regardless of what happens (e.g. an interception)
  const offense = `const g = window.__game; g.match.offense = 'you'; g.match.drive.down = 1; g.match.drive.toGo = 10; g.match.drive.ballOn = 25; g.match.clockRunning = false;`;

  // 3. Playbook menu: opens on launch; switch tab and pick a play by touch.
  check(await G(() => window.__game.screen === 'huddle' && window.__game.menuOpen), 'the game opens in the huddle: call a play');
  await page.screenshot({ path: `${OUT}/smoke-menu.png` });
  const tabs = await G(() => window.__game.menu.layout(window.__game.view).tabs.map((t) => ({ id: t.cat.id, x: t.r.x + t.r.w / 2, y: t.r.y + t.r.h / 2 })));
  const crossers = tabs.find((t) => t.id === 'crossers');
  await tap(crossers); // CROSSERS tab
  await tap({ x: 47, y: 80 }); // first card
  check(await G(() => !window.__game.menuOpen && window.__game.play.id === 'mesh'), 'picked MESH from the CROSSERS tab');

  // 4. One touch snaps and starts the aim; release throws.
  async function throwPlay(mode, fromL, toL, shot) {
    await G(new Function('m', offense + " g.mode = m; g.sim.forceCall = 'c3'; g.startHuddle(); g.pickPlay(g.play);"), mode);
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
  check((await G(() => window.__game.screen)) === 'huddle', 'tap after the result goes back to the huddle');
  const same = await G(() => { const q = window.__game.menu.layout(window.__game.view).quick.find((b) => b.type === 'same'); return q && { x: q.r.x + q.r.w / 2, y: q.r.y + q.r.h / 2 }; });
  await tap(same);
  check(await G(() => window.__game.screen === 'play' && window.__game.play.id === 'mesh'), 'SAME PLAY lines up the last call');
  await throwPlay('aim', { x: 90, y: 230 }, { x: 60, y: 160 }, 'smoke-aim.png');

  // 5. Run after the catch: the receiver keeps going until tackled, out, or in.
  const yac = await G(() => {
    const g = window.__game; g.paused = true; const sim = g.sim; g.match.offense = 'you'; g.match.drive.down = 1;
    sim.forceCall = 'c3'; g.startHuddle(); g.pickPlay(g.play); sim.snap();
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
  await G(() => window.__game.startHuddle());

  // 6. Hold the ball against an all-out blitz: should get sacked (a tap with no drag just snaps).
  const sacksBefore = await G(() => window.__game.match.stats.you.sacks);
  await G(new Function(offense + " g.mode = 'pull'; g.sim.forceCall = 'c0'; g.startHuddle(); g.pickPlay(g.play);"));
  await tap({ x: 90, y: 150 });
  await waitPhase('done');
  const sackRes = await G(() => window.__game.sim.result + ' ' + window.__game.sim.call.id + ' ball:' + !!window.__game.sim.ball);
  check(sackRes.startsWith('sack'), 'tap without a drag snaps; holding vs COVER 0 ends in a sack (' + sackRes + ')');
  check(await G((n) => window.__game.match.stats.you.sacks === n + 1, sacksBefore), 'the sack counted in your stats');
  await page.waitForFunction(() => window.__game.screen === 'banner');
  await tap({ x: 90, y: 150 });

  // 7. Buttons: MODE toggles; PLAYS reopens the playbook between snaps.
  await G(new Function(offense + ' g.startHuddle(); g.pickPlay(g.play);')); // at the line
  const before = await G(() => window.__game.mode);
  await tap({ x: 150, y: 310 });
  check((await G(() => window.__game.mode)) !== before, 'MODE button toggles aim mode');
  await G(new Function(offense + ' g.startHuddle(); g.pickPlay(g.play);'));
  await tap({ x: 24, y: 310 });
  check(await G(() => window.__game.screen === 'huddle'), 'PLAYS button goes back to the huddle before the snap');

  // 8. 4th down: you choose GO FOR IT or PUNT.
  await G(new Function(offense + ' g.match.drive.down = 4; g.match.drive.toGo = 7; g.match.drive.ballOn = 30; g.startHuddle();'));
  const pb = await G(() => { const q = window.__game.menu.layout(window.__game.view).quick.find((b) => b.type === 'punt'); return q && q.r; });
  check(!!pb, '4th down: the huddle offers PUNT (or pick a play to go for it)');
  await tap({ x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 });
  const punt = await G(() => ({ kind: window.__game.banner && window.__game.banner.kind, head: window.__game.banner && window.__game.banner.headline, note: window.__game.banner && window.__game.banner.note, off: window.__game.match.offense }));
  check(punt.kind === 'punt' && punt.off === 'cpu', `punt: "${punt.head}" ${punt.note}, CPU ball`);

  // 9. Defense: the CPU snaps, its QB's eyes show, and you can take over the MIKE.
  await tap({ x: 90, y: 150 }); // past the punt banner -> CPU offense: call your defense
  check(await G(() => window.__game.screen === 'huddle' && window.__game.match.offense === 'cpu'), 'defense: the huddle asks for a defensive call');
  const dcard = await G(() => { const g = window.__game; const t = g.menu.layout(g.view).tabs.find((x) => x.cat.id === 'blitz'); return { x: t.r.x + t.r.w / 2, y: t.r.y + t.r.h / 2 }; });
  await tap(dcard); // BLITZ tab
  const blitz = await G(() => { const g = window.__game; const c = g.menu.layout(g.view).cards[0]; return { x: c.r.x + c.r.w / 2, y: c.r.y + c.r.h / 2, name: c.it.call.name }; });
  await tap(blitz);
  check(await G((n) => window.__game.screen === 'play' && window.__game.sim.call.name === n && window.__game.sim.user.id === 'MIKE', blitz.name), `defense: called ${blitz.name}; you are the MIKE`);
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
  check(await G(() => window.__game.screen === 'huddle' && window.__game.match.quarter === 1 && window.__game.match.score.you === 0), 'tap on the final screen starts a new game');

  // 11. Pause: timeout, settings, restart.
  await G(new Function(offense + ' g.match.clockRunning = true; g.startHuddle();'));
  const pbtn = await G(() => window.__game.pauseButton);
  await tap({ x: pbtn.x + pbtn.w / 2, y: pbtn.y + pbtn.h / 2 });
  check(await G(() => window.__game.pauseOpen), 'pause button opens the pause menu');
  const pz = await G(() => window.__game.pauseButtons);
  const c = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  await tap(c(pz.timeout));
  check(await G(() => window.__game.match.timeouts.you === 2 && !window.__game.match.clockRunning && !window.__game.pauseOpen), 'TIMEOUT stops the clock (2 left)');
  await tap({ x: pbtn.x + pbtn.w / 2, y: pbtn.y + pbtn.h / 2 });
  await tap(c(pz.settings));
  check(await G(() => window.__game.menu && window.__game.menu.showSettings), 'SETTINGS opens from pause');
  const done = await G(() => window.__game.menu.settingsLayout(window.__game.view).done);
  await tap(c(done));
  check(await G(() => window.__game.screen === 'huddle' && !window.__game.menu.showSettings), 'DONE returns to the huddle');
  await tap({ x: pbtn.x + pbtn.w / 2, y: pbtn.y + pbtn.h / 2 });
  await tap(c(pz.restart));
  check(await G(() => window.__game.pauseOpen), 'RESTART asks for a second tap');
  await G(() => { window.__game.match.score.you = 7; });
  await tap(c(pz.restart));
  check(await G(() => !window.__game.pauseOpen && window.__game.match.score.you === 0 && window.__game.match.quarter === 1), 'second tap restarts the game');

  // 12. Clock: it runs between plays when it's running, and stops at the two-minute warning.
  const clk = await G(() => {
    const g = window.__game; g.match.quarter = 2; g.match.clock = 126; g.match.clockRunning = true; g.runoff = 0; g.startHuddle();
    for (let i = 0; i < 60; i++) g.update(1 / 30); // 2 real seconds in the huddle
    return { clock: g.match.clock, running: g.match.clockRunning, toast: g.toast && g.toast.text };
  });
  check(clk.clock === 120 && !clk.running && clk.toast === 'TWO-MINUTE WARNING', `clock ran in the huddle and stopped at the two-minute warning (${clk.clock}s, "${clk.toast}")`);

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
  const card = await LG(() => { const g = window.__game; const c = g.menu.layout(g.view).cards[2]; return { x: c.r.x + c.r.w / 2, y: c.r.y + c.r.h / 2, id: c.it.play.id }; });
  const cp = await lscreen(card);
  await ltouch('touchStart', [cp]); await ltouch('touchEnd', []);
  check(await LG((id) => !window.__game.menuOpen && window.__game.play.id === id, card.id), `landscape: picked ${card.id} from a 3-column playbook`);
  await LG(() => { const g = window.__game; g.match.offense = 'you'; g.match.drive.down = 1; g.mode = 'pull'; g.sim.forceCall = 'c4'; g.startHuddle(); g.pickPlay(g.play); });
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
