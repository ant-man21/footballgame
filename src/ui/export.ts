// EXPORT SAVE: copies the career save (plus settings and the build) as text, so
// the player can paste it into a chat for a look at their actual career.
// Clipboard writes need a "user activation"; on a phone a touch only grants one
// when the finger lifts, so the copy runs from the pointerup handler (see
// Game.afterTap). If the clipboard is unavailable, the text is shown in a box
// to select and copy by hand.
import { CAREER_KEY } from '../career/save';

/** The text that gets copied: a small header and the raw saves. */
export function exportText(): string {
  const read = (k: string) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  return JSON.stringify({
    game: 'footballgame', build: __BUILD__, exported: new Date().toISOString(),
    settings: read('footballgame.settings'), career: read(CAREER_KEY),
  });
}

/** Copies the text; resolves true if it went to the clipboard, false if the fallback box was shown. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* no clipboard: show it */ }
  showBox(text);
  return false;
}

function showBox(text: string): void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(17,29,43,0.96);display:flex;flex-direction:column;'
    + 'padding:16px;gap:10px;z-index:10;font:14px monospace;color:#fff1e8';
  const msg = document.createElement('div');
  msg.textContent = 'Select all of this text, copy it, and paste it in your chat.';
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.style.cssText = 'flex:1;width:100%;font:11px monospace;background:#1d2b53;color:#fff1e8;border:1px solid #c2c3c7';
  const done = document.createElement('button');
  done.textContent = 'DONE';
  done.style.cssText = 'padding:10px;font:16px monospace;background:#111d2b;color:#00e436;border:1px solid #00e436';
  done.onclick = () => wrap.remove();
  wrap.append(msg, ta, done);
  document.body.append(wrap);
  ta.focus();
  ta.select();
}
