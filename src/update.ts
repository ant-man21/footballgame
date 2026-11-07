// Keeps a home-screen install up to date. iPhone home-screen apps hold on to
// the old page, so when the app opens or comes back to the foreground it asks
// the server for index.html (bypassing the cache) and compares the game script
// it names with the one running. If a newer build is deployed, it reloads, but
// only when that's safe (canReload: on a menu, never mid-game).

const SCRIPT = /assets\/index-[\w-]+\.js/;

export function watchForUpdates(canReload: () => boolean): void {
  const running = [...document.scripts].map((s) => s.src).find((src) => SCRIPT.test(src));
  if (!running) return; // the dev server: nothing to compare
  let pending = false;
  const check = async () => {
    if (pending) { if (canReload()) location.reload(); return; }
    try {
      const res = await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' });
      const latest = (await res.text()).match(SCRIPT)?.[0];
      if (latest && !running.includes(latest)) {
        pending = true;
        if (canReload()) location.reload();
      }
    } catch { /* offline: keep playing */ }
  };
  check();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  setInterval(() => { if (pending && canReload()) location.reload(); }, 2000); // a newer build is waiting: reload once back on a menu
}
