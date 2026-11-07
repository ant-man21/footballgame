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

  // 0. Title screen: PLAY NOW / CAREER / TEAM / SETTINGS; the game options live in SETTINGS.
  const mid = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  check(await G(() => window.__game.screen === 'title' && !window.__game.menu.showSettings), 'the game opens on the title screen (no settings on it)');
  const tt = await G(() => { const g = window.__game; return g.menu.titleLayout(g.view); });
  await page.screenshot({ path: `${OUT}/smoke-title.png` });
  await tap(mid(tt.settings));
  const tl = await G(() => { const g = window.__game; const L = g.menu.settingsLayout(g.view); const q = L.rows.find((r) => r.row.key === 'quarter'); return q && { right: q.right, done: L.done, open: g.menu.showSettings }; });
  check(tl && tl.open, 'SETTINGS opens the settings menu, with the quarter length');
  check(await G(() => window.__game.settings.quarter === '2.5'), 'settings: quarters default to 2:30');
  await tap(mid(tl.right)); // 2:30 -> 3:00
  check(await G(() => window.__game.settings.quarter === '3' && JSON.parse(localStorage.getItem('footballgame.settings')).quarter === '3'), 'settings: quarter length steps by 30 seconds (3:00) and saves');
  await tap(mid(tl.done));
  check(await G(() => window.__game.screen === 'title' && !window.__game.menu.showSettings), 'DONE goes back to the title screen');
  // TEAM: your roster, NEW TEAM rolls a fresh one (tap twice), BACK returns
  const tb = tt.team;
  await tap({ x: tb.x + tb.w / 2, y: tb.y + tb.h / 2 });
  const rv = await G(() => { const g = window.__game; return g.rosterView && { ...g.rosterView.layout(g.view), n: g.team.players.length, first: g.team.players[0].name }; });
  check(!!rv && rv.n === 24, `TEAM shows your roster (${rv && rv.n} players)`);
  await tap({ x: rv.fresh.x + rv.fresh.w / 2, y: rv.fresh.y + rv.fresh.h / 2 });
  await tap({ x: rv.fresh.x + rv.fresh.w / 2, y: rv.fresh.y + rv.fresh.h / 2 });
  check(await G(() => window.__game.team.players.length === 24 && JSON.parse(localStorage.getItem('footballgame.roster')).players.length === 24), 'NEW TEAM (tap twice) rolls and saves a new roster');
  await page.screenshot({ path: `${OUT}/smoke-roster.png` });
  await tap({ x: rv.back.x + rv.back.w / 2, y: rv.back.y + rv.back.h / 2 });
  check(await G(() => !window.__game.rosterView && window.__game.screen === 'title'), 'BACK returns to the title screen');
  await tap(mid(tt.play));
  check(await G(() => window.__game.screen === 'huddle' && window.__game.match.clockText === '3:00'), 'PLAY NOW starts a game with 3:00 quarters');
  check(await G(() => { const g = window.__game; g.pickPlay(window.__plays[0]); const ok = g.sim.actors.every((a) => a.pl && a.pl.ovr > 0); g.startHuddle(); return ok; }), 'every player on the field has ratings');

  // 1. Every defensive call accounts for all 11 defenders, for every play.
  const bad = await G(() => {
    const g = window.__game; const out = [];
    for (const call of ['c0', 'c1-blitz', 'c1', 'c2', 'c2-drop', 'c3', 'c3-fire', 'c4', 'c4-drop', 'c2-man', 'c6', 'tampa2', 'c1-press', 'c1-lurk', 'c3-buzz', 'nickel-fire', 'c4-blitz', 'c1-spy', 'sim-pressure']) {
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
  check(await G(() => window.__game.match.drive.spotText === 'OWN 25' && window.__game.match.drive.downText === '1ST & 10' && window.__game.match.quarter === 1), 'game starts in Q1, 1ST & 10 at OWN 25');
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
  // (if that throw happened to be picked off, the CPU has the ball: put us back on offense)
  await G(new Function(offense + ' g.startHuddle();'));
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

  // 5b. Hashes: a play that ends wide spots the next snap on the hash; strength goes to the field; FLIP mirrors it.
  const hashes = await G(() => {
    const g = window.__game; g.paused = true; const sim = g.sim;
    g.match.offense = 'you'; g.match.drive.down = 1; g.match.drive.ballOn = 30; g.match.drive.ballX = 0;
    g.startHuddle(); g.pickPlay(window.__plays.find((x) => x.id === 'flood')); sim.snap();
    for (let i = 0; i < 30; i++) sim.update(1 / 60);
    const r = sim.receivers.find((x) => x.id === 'Y');
    r.x = 90 + 22 * 3.15; // catch it out wide on the right
    sim.throwTo({ x: r.x, y: r.y }, true); sim.ball.to = { x: r.x, y: r.y }; sim.ball.t = sim.ball.dur;
    g.paused = false;
    for (let i = 0; i < 3000 && g.screen !== 'banner'; i++) g.update(1 / 60); // the game sees the play end
    const spot = g.match.offense === 'you' ? g.match.drive.ballX : null;
    g.match.offense = 'you'; g.match.drive.ballX = 6.67; g.startHuddle(); g.pickPlay(window.__plays.find((x) => x.id === 'flood'));
    const toField = g.sim.mirror, call = g.sim.call.id, qbX = Math.round((g.sim.qb.x - 90) / 3.15 * 10) / 10;
    return { spot, toField, call, qbX };
  });
  check(hashes.spot === 6.67, `a catch out wide spots the next snap on the hash (${hashes.spot})`);
  check(hashes.toField && hashes.qbX === 6.7, `on the right hash the QB lines up there and Flood goes to the field (mirrored=${hashes.toField})`);
  const fb = await G(() => window.__game.flipButton);
  await tap({ x: fb.x + fb.w / 2, y: fb.y + fb.h / 2 });
  check(await G((c) => !window.__game.sim.mirror && window.__game.flipped && window.__game.sim.call.id === c, hashes.call), 'FLIP mirrors the play at the line (same defensive look)');
  await G(new Function(offense + ' g.match.drive.ballX = 0; g.startHuddle();'));

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
    return { final: g.screen === 'final', q: m.quarter, ot: m.ot, score: `${m.score.you}-${m.score.cpu}`, plays: m.stats.you.plays + m.stats.cpu.plays };
  });
  check(fg.final && (fg.q === 4 || fg.ot > 0), `full game: FINAL ${fg.score}${fg.ot ? ' (OT)' : ''} after ${fg.plays} plays`); // a tie goes to overtime
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
  await tap({ x: pbtn.x + pbtn.w / 2, y: pbtn.y + pbtn.h / 2 });
  await tap(c(pz.title));
  check(await G(() => window.__game.screen === 'title'), 'MAIN MENU goes back to the title screen');
  await tap({ x: tl.done.x + tl.done.w / 2, y: tl.done.y + tl.done.h / 2 });

  // 12. Clock: it runs between plays when it's running, and stops at the two-minute warning.
  const clk = await G(() => {
    const g = window.__game; g.match.quarter = 2; g.match.clock = 126; g.match.clockRunning = true; g.runoff = 0; g.startHuddle();
    for (let i = 0; i < 90; i++) g.update(1 / 30); // 3 real seconds in the huddle (clock runs 2.5x)
    return { clock: g.match.clock, running: g.match.clockRunning, toast: g.toast && g.toast.text };
  });
  check(clk.clock === 120 && !clk.running && clk.toast === 'TWO-MINUTE WARNING', `clock ran in the huddle and stopped at the two-minute warning (${clk.clock}s, "${clk.toast}")`);

  // 8b. Overtime: tied after four quarters -> possessions from the 25, no clock, no punting, until someone wins
  const ot = await G(() => {
    const g = window.__game, Q = window.__quicksim;
    g.autoplay = false; g.newGame();
    const m = g.match;
    m.quarter = 4; m.clock = 2; m.score = { you: 14, cpu: 14 }; m.offense = 'you'; m.drive.down = 1;
    m.afterPlay({ result: 'inc', yards: 0, touchdown: false, outOfBounds: false }, 4); // the clock runs out, tied
    const start = { ot: m.ot, period: m.periodText, ballOn: m.drive.ballOn, over: m.over };
    // 4th down in overtime: no PUNT in your huddle
    m.offense = 'you'; m.drive.down = 4; g.startHuddle();
    const punt = g.menu ? g.menu.layout(g.view).quick.some((q) => q.type === 'punt') : null;
    // first possession ends on downs: the other team gets its turn at the 25
    const first = m.offense; m.drive.down = 4; m.drive.toGo = 10;
    m.afterPlay({ result: 'inc', yards: 0, touchdown: false, outOfBounds: false }, 4);
    const second = { off: m.offense, ballOn: m.drive.ballOn, over: m.over };
    // second team scores: game over
    m.afterPlay({ result: 'catch', yards: 25, touchdown: true, outOfBounds: false }, 4);
    const end = { over: m.over, you: m.score.you, cpu: m.score.cpu };
    // and the quick-sim always finishes overtime with a winner
    let ties = 0, ots = 0, maxOt = 0;
    for (let i = 0; i < 400; i++) {
      const q = new m.constructor('you', 150); q.quarter = 4; q.clock = 1; q.score = { you: 7, cpu: 7 };
      Q.simToEnd(q, { you: { off: 0, def: 0 }, cpu: { off: 0, def: 0 } });
      if (q.ot) ots++; if (q.score.you === q.score.cpu) ties++; maxOt = Math.max(maxOt, q.ot);
    }
    // simulated defense (career): an even opponent's drive from its 25 scores at a football rate
    const S = window.__simDef; let td = 0;
    for (let i = 0; i < 600; i++) {
      const q = new m.constructor('cpu', 240); q.drive.ballOn = 25;
      if (Q.simDrive(q, { you: { off: 0, def: S.bonus }, cpu: { off: 0, def: 0 } }, { runoff: S.runoff }).end === 'td') td++;
    }
    const simTd = Math.round((100 * td) / 600);
    g.newGame();
    return { start, punt, first, second, end, ties, ots, maxOt, simTd };
  });
  check(ot.start.ot === 1 && ot.start.period === 'OT' && ot.start.ballOn === 75 && !ot.start.over, `tied after four quarters: overtime from the 25 (${ot.start.period})`);
  check(ot.punt === false, 'no PUNT on 4th down in overtime');
  check(ot.second.off !== ot.first && ot.second.ballOn === 75 && !ot.second.over, 'a stop on downs: the other team gets its turn at the 25');
  check(ot.end.over && ot.end.you !== ot.end.cpu, `a score on the second possession wins it (${ot.end.you}-${ot.end.cpu})`);
  check(ot.ots >= 380 && ot.ties === 0 && ot.maxOt <= 30, `quick-simmed overtimes always end with a winner (${ot.ots}/400 went to OT, ${ot.ties} ties, longest OT${ot.maxOt})`);
  check(ot.simTd >= 15 && ot.simTd <= 40, `simulated defense: an even opponent scores a TD on ${ot.simTd}% of drives from its 25 (target ~27%)`);

  // 9. Career: create a QB from the title screen, the hub, a backup scenario played on the field (coach calls the
  // plays), the save round-trip, simulated defense, a full season into the playoffs and the next season.
  await G(() => { const g = window.__game; g.autoplay = false; g.showTitle(); localStorage.removeItem('footballgame.career.v1'); });
  const cb = await G(() => { const g = window.__game; return g.menu.titleLayout(g.view).career; });
  await tap({ x: cb.x + cb.w / 2, y: cb.y + cb.h / 2 });
  check(await G(() => window.__game.screen === 'career' && window.__careerUI.screen === 'create'), 'CAREER on the title screen opens character creation');
  const cl = await G(() => { const ui = window.__careerUI; return ui.createLayout(window.__game.view); });
  await tap({ x: cl.archR.x + 5, y: cl.archR.y + 5 }); // gunslinger
  await tap({ x: cl.start.x + cl.start.w / 2, y: cl.start.y + cl.start.h / 2 });
  const made = await G(() => { const c = window.__careerUI.career; return c && { scr: window.__careerUI.screen, arch: c.player.archetype, games: c.s.games.length, role: c.s.role, saved: !!localStorage.getItem('footballgame.career.v1') }; });
  check(made && made.scr === 'hub' && made.arch === 'gunslinger' && made.games === 80 && made.role === 'backup' && made.saved,
    `START CAREER: a sophomore backup gunslinger, an 80-game schedule, saved (${JSON.stringify(made)})`);
  await page.screenshot({ path: `${OUT}/smoke-career-hub.png` });
  // practice focus from the hub
  const hl = await G(() => window.__careerUI.hubLayout(window.__game.view));
  await tap({ x: hl.focusR.x + 5, y: hl.focusR.y + 5 });
  check(await G(() => window.__careerUI.career.s.focus === 'arm' && JSON.parse(localStorage.getItem('footballgame.career.v1')).focus === 'arm'), 'practice focus steps (ARM) and saves');
  // game day as the backup: sit until a scenario comes up (forcing one if needed)
  const sc = await G(() => {
    const ui = window.__careerUI; let sat = 0;
    for (let i = 0; i < 6 && ui.career.s.phase === 'season'; i++) {
      ui.career.s.dry = 2; ui.gameDay();
      if (ui.screen === 'gameday') return { label: ui.plan.label, sat, week: ui.career.s.week };
      sat++; ui.screen = 'hub';
    }
    return { label: null, sat };
  });
  check(!!sc.label, `a backup sits (${sc.sat} weeks) until a scenario snap: ${sc.label}`);
  const go = await G(() => window.__careerUI.gamedayLayout(window.__game.view).go);
  await tap({ x: go.x + go.w / 2, y: go.y + go.h / 2 });
  const cg = await G(() => { const g = window.__game; return { career: !!g.careerGame, screen: g.screen, you: g.match.names.you, team: g.yourTeam.tier, qb: g.yourTeam.players.find((p) => p.slot === 'QB').name, me: window.__careerUI.career.player.last }; });
  check(cg.career && cg.screen !== 'huddle' && cg.team === -16 && cg.qb.endsWith(cg.me), `TAKE THE FIELD: no huddle (coach calls), high school tier, you at QB (${cg.qb}) for ${cg.you}`);
  // on offense: the coach's call is lined up, one touch snaps and throws
  const off = await G(() => { const g = window.__game; g.match.offense = 'you'; g.startHuddle(); return { screen: g.screen, phase: g.sim.phase, toast: g.toast && g.toast.text }; });
  check(off.screen === 'play' && off.phase === 'presnap' && /^COACH: /.test(off.toast || ''), `the coach calls the play (${off.toast})`);
  const c0 = await toScreen({ x: 90, y: 230 }), c1 = await toScreen({ x: 90, y: 262 });
  await touch('touchStart', [c0]);
  for (let i = 1; i <= 6; i++) await touch('touchMove', [{ x: c0.x, y: c0.y + ((c1.y - c0.y) * i) / 6 }]);
  await touch('touchEnd', []);
  await page.waitForFunction(() => window.__game.screen === 'banner' || window.__game.screen === 'final' || !window.__game.careerGame, null, { timeout: 15000 });
  check(true, `a career snap resolves (${await G(() => window.__game.banner ? window.__game.banner.headline : window.__game.screen)})`);
  // finish the game (auto-play the rest), tap the final screen, see the result
  const res = await G(() => {
    const g = window.__game, ui = window.__careerUI, wk = ui.career.s.week; g.autoplay = true; let n = 0;
    while (g.careerGame && g.screen !== 'final' && n++ < 300000) g.update(1 / 30);
    g.autoplay = false;
    if (g.screen === 'final') g.pointerDown({ x: 5, y: 300 });
    const c = ui.career, l = ui.lastLog;
    const weekGames = c.s.games.filter((x) => x.week === l.week);
    return { scr: ui.screen, kind: l.kind, line: l.line, grade: l.grade, battle: l.battle, adv: c.s.week === wk + 1, allPlayed: weekGames.every((x) => x.hs !== undefined), logs: c.s.log.length };
  });
  check(res.scr === 'result' && res.kind === 'scenario' && res.grade !== null && res.battle !== null && res.adv && res.allPlayed,
    `the week's result: your line ${res.line.cmp}/${res.line.att} grade ${res.grade}, QB battle ${res.battle}; the whole week was played`);
  await page.screenshot({ path: `${OUT}/smoke-career-result.png` });
  // save round-trip: reload the page, CONTINUE lands on the same week
  const saved0 = await G(() => JSON.stringify(window.__careerUI.career.s));
  await page.reload();
  await G(() => { window.__game.onCareer(); });
  // EXPORT SAVE copies the whole save as text (the copy runs when the finger lifts)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new globalThis.URL(URL).origin });
  const exb = await G(() => window.__careerUI.startLayout(window.__game.view).exp);
  await tap({ x: exb.x + exb.w / 2, y: exb.y + exb.h / 2 });
  await page.waitForFunction(() => window.__careerUI.exportNote, null, { timeout: 5000 });
  const ex = await G(async () => { const t = await navigator.clipboard.readText(); const j = JSON.parse(t);
    return { game: j.game, build: j.build, same: JSON.stringify(j.career) === localStorage.getItem('footballgame.career.v1'), kb: Math.ceil(t.length / 1024), note: window.__careerUI.exportNote.text }; });
  check(ex.game === 'footballgame' && ex.same && !!ex.build, `EXPORT SAVE copies the whole save (${ex.kb} KB, build ${ex.build}): "${ex.note}"`);
  await page.screenshot({ path: `${OUT}/smoke-career-export.png` });
  const cont = await G(() => window.__careerUI.startLayout(window.__game.view).cont);
  await tap({ x: cont.x + cont.w / 2, y: cont.y + cont.h / 2 });
  check(await G((b) => window.__careerUI.screen === 'hub' && JSON.stringify(window.__careerUI.career.s) === b, saved0), 'the career save round-trips through a page reload (CONTINUE)');
  // simulated defense: as the starter, the other team's drive is simulated
  const simd = await G(() => {
    const ui = window.__careerUI, c = ui.career, g = window.__game;
    c.s.role = 'starter'; c.s.defense = 'sim';
    ui.gameDay(); ui.play();
    g.match.offense = 'cpu'; g.startHuddle();
    const b = g.banner;
    const out = { kind: ui.plan ? ui.plan.kind : null, banner: b && b.headline, detail: b && b.detail, now: g.match.offense };
    g.simRestOfCareerGame();
    return { ...out, scr: ui.screen };
  });
  check(simd.kind === 'full' && / DRIVE$/.test(simd.banner || '') && simd.scr === 'result', `DEFENSE: SIMULATED: ${simd.banner} (${simd.detail}); SIM REST OF GAME finishes it`);
  // PLAYS: YOU CALL: a career game runs like an exhibition, with your own calls in the huddle on both sides
  const ycl = await G(() => { const ui = window.__careerUI; ui.screen = 'hub'; window.__game.showCareer(ui); return ui.hubLayout(window.__game.view).calls; });
  await tap({ x: ycl.x + ycl.w / 2, y: ycl.y + ycl.h / 2 });
  check(await G(() => window.__careerUI.career.s.calls === 'you' && JSON.parse(localStorage.getItem('footballgame.career.v1')).calls === 'you'), 'PLAYS: YOU CALL toggles on the hub and saves');
  const own = await G(() => {
    const ui = window.__careerUI, g = window.__game, c = ui.career;
    c.s.role = 'starter'; c.s.defense = 'play';
    ui.gameDay(); ui.play();
    g.match.offense = 'you'; g.startHuddle();
    const offHuddle = g.screen === 'huddle' && g.menu && g.menu.layout(g.view).cards.length > 0;
    const card = g.menu.layout(g.view).cards[1];
    return { offHuddle, card: { x: card.r.x + card.r.w / 2, y: card.r.y + card.r.h / 2, id: card.it.play.id } };
  });
  check(own.offHuddle, 'with YOU CALL, a career game opens the huddle on offense');
  await tap({ x: own.card.x, y: own.card.y });
  const own2 = await G((id) => {
    const g = window.__game; const ok = g.screen === 'play' && g.play.id === id && g.sim.phase === 'presnap';
    g.match.offense = 'cpu'; g.match.drive.down = 1; g.startHuddle();
    const def = g.screen === 'huddle' && g.menu && g.menu.layout(g.view).cards.some((c) => c.it.call);
    g.simRestOfCareerGame(); window.__careerUI.career.s.calls = 'coach';
    return { ok, def };
  }, own.card.id);
  check(own2.ok && own2.def, `...your pick (${own.card.id}) lines up, and you call the defense too`);
  // the rest of the season (quick-simmed stints), the playoffs, the summary, the junior year
  const season = await G(() => {
    const ui = window.__careerUI, c = ui.career, Q = window.__quicksim; let n = 0;
    while (c.s.phase === 'season' && n++ < 20) { const p = c.prepareGame(); if (p.kind !== 'none') Q.simToEnd(p.match, p.units); c.finishGame(p); }
    const rounds = ['QF', 'SF', 'F'].map((r) => c.s.games.filter((g) => g.round === r).length);
    const out = { phase: c.s.phase, rounds, finish: c.finish(), champ: c.champion && c.champion.name, seasons: c.player.seasons.length };
    ui.screen = 'summary';
    return out;
  });
  check(season.phase === 'summary' && season.rounds.join() === '4,2,1' && !!season.champ && season.seasons === 1,
    `a full season into an 8-team playoff (${season.finish}; state champion ${season.champ})`);
  await page.screenshot({ path: `${OUT}/smoke-career-summary.png` });
  await tap({ x: 90, y: 312 }); // OFF-SEASON
  const jr = await G(() => { const c = window.__careerUI.career; return { yr: c.s.year, wk: c.s.week, games: c.s.games.filter((g) => g.hs === undefined).length, scr: window.__careerUI.screen }; });
  check(jr.yr === 1 && jr.wk === 1 && jr.games === 80 && jr.scr === 'hub', 'OFF-SEASON: on to the junior year with a new schedule');
  // Recruiting: stars move week to week, colleges offer, commit from the board, signing day after the senior year
  const jrRec = await G(() => {
    const ui = window.__careerUI, c = ui.career, Q = window.__quicksim; const scores = []; let n = 0;
    while (c.s.phase === 'season' && n++ < 20) { const p = c.prepareGame(); if (p.kind !== 'none') Q.simToEnd(p.match, p.units); c.finishGame(p); scores.push(c.s.recruit.score); }
    return { scores, watching: Object.values(c.s.recruit.interest).filter((v) => v >= 5).length, stars: c.s.recruit.stars };
  });
  check(new Set(jrRec.scores).size > 3 && jrRec.watching > 0, `junior year: the recruiting score moves every week (${jrRec.scores.slice(0, 4).join(', ')}...), ${jrRec.watching} colleges watching, ${jrRec.stars} stars`);
  const rb = await G(() => { const ui = window.__careerUI; ui.career.nextSeason(); ui.screen = 'hub'; window.__game.showCareer(ui); return ui.hubLayout(window.__game.view).recruiting; });
  await tap({ x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 });
  const row = await G(() => {
    const ui = window.__careerUI, rs = ui.career.s.recruit;
    const rows = ui.recruitRows(window.__game.view);
    if (!rows.length) return null;
    if (!rs.offers.includes(rows[0].c.id)) rs.offers.push(rows[0].c.id); // make sure there's an offer to commit to
    const rr = ui.recruitRows(window.__game.view).find((x) => rs.offers.includes(x.c.id));
    return { id: rr.c.id, x: rr.r.x + rr.r.w / 2, y: rr.r.y + rr.r.h / 2, scr: ui.screen, offers: rs.offers.length };
  });
  check(row && row.scr === 'recruiting', `RECRUITING opens the board (${row && row.offers} offers)`);
  await page.screenshot({ path: `${OUT}/smoke-career-recruiting.png` });
  await tap({ x: row.x, y: row.y }); await tap({ x: row.x, y: row.y }); // tap twice to commit
  check(await G((id) => window.__careerUI.career.s.recruit.committed === id && JSON.parse(localStorage.getItem('footballgame.career.v1')).recruit.committed === id, row.id), `tap an offer twice: committed to ${row.id} (saved)`);
  // lots of offers: the board pages through all of them with < >
  const pg = await G(() => {
    const ui = window.__careerUI, rs = ui.career.s.recruit, C = window.__recruiting;
    for (const c of C.COLLEGES.slice(0, 30)) { if (!rs.offers.includes(c.id)) rs.offers.push(c.id); rs.interest[c.id] = Math.max(rs.interest[c.id] || 0, 70); }
    const v = window.__game.view; return { pages: ui.recruitPages(v), first: ui.recruitRows(v)[0].c.id, next: ui.pagerLayout(v).next, offers: rs.offers.length };
  });
  await tap(mid(pg.next));
  const pg2 = await G(() => { const ui = window.__careerUI; return { page: ui.listPage, first: ui.recruitRows(window.__game.view)[0].c.id }; });
  check(pg.pages >= 3 && pg2.page === 1 && pg2.first !== pg.first, `${pg.offers} offers page through the board (${pg.pages} pages, > shows the next page)`);
  await page.screenshot({ path: `${OUT}/smoke-career-recruiting-pages.png` });
  const sr = await G(() => {
    const ui = window.__careerUI, c = ui.career, Q = window.__quicksim; let n = 0;
    while (c.s.phase === 'season' && n++ < 20) { const p = c.prepareGame(); if (p.kind !== 'none') Q.simToEnd(p.match, p.units); c.finishGame(p); }
    const summary = c.s.phase; c.nextSeason(); ui.toHubForTest();
    return { summary, phase: c.s.phase, scr: ui.screen, year: c.s.year };
  });
  check(sr.summary === 'summary' && sr.phase === 'signing' && sr.scr === 'signing' && sr.year === 2, 'after the senior season: SIGNING DAY');
  await page.screenshot({ path: `${OUT}/smoke-career-signing.png` });
  const spg = await G(() => { const ui = window.__careerUI, v = window.__game.view; return { pages: ui.signingPages(v), n: ui.career.s.recruit.offers.length }; });
  check(spg.pages >= 2, `signing day pages through all ${spg.n} offers (${spg.pages} pages)`);
  const sg = await G(() => { const ui = window.__careerUI, rr = ui.signingRows(window.__game.view)[0]; return { id: rr.c.id, x: rr.r.x + rr.r.w / 2, y: rr.r.y + rr.r.h / 2 }; });
  await tap({ x: sg.x, y: sg.y }); await tap({ x: sg.x, y: sg.y });
  check(await G((id) => { const c = window.__careerUI.career; return c.s.phase === 'done' && c.s.recruit.signed === id && window.__careerUI.screen === 'done'; }, sg.id), `signed with ${sg.id}: high school is done`);
  await page.screenshot({ path: `${OUT}/smoke-career-done.png` });
  // a save from before recruiting (v1, mid senior year) is upgraded and caught up
  await G(() => {
    const s = JSON.parse(localStorage.getItem('footballgame.career.v1'));
    delete s.recruit; delete s.recruitFeed; s.v = 1; s.phase = 'season'; s.week = 6;
    s.player.awards = s.player.awards.filter((a) => !a.startsWith('SIGNED'));
    localStorage.setItem('footballgame.career.v1', JSON.stringify(s));
  });
  await page.reload();
  await G(() => { window.__game.onCareer(); });
  const mig = await G(() => { const ui = window.__careerUI, c = ui.career, s = JSON.parse(localStorage.getItem('footballgame.career.v1'));
    return c && { v: c.s.v, saved: s.v, stars: c.s.recruit.stars, watching: Object.values(c.s.recruit.interest).filter((x) => x >= 5).length, offers: c.s.recruit.offers.length }; });
  check(mig && mig.v === 2 && mig.saved === 2 && mig.stars >= 1 && mig.watching > 0, `an old (v1) save mid senior year gets recruiting caught up: ${mig && mig.stars} stars, ${mig && mig.offers} offers`);
  await G(() => { window.__game.showTitle(); });

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
  const ldone = await LG(() => { const g = window.__game; return g.menu.titleLayout(g.view).play; });
  const ld = await lscreen({ x: ldone.x + ldone.w / 2, y: ldone.y + ldone.h / 2 });
  await ltouch('touchStart', [ld]); await ltouch('touchEnd', []); // KICKOFF
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
