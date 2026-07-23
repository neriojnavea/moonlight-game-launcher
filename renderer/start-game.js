// Shared "start / resume / focus a game" entry point for the library rail and
// the overlay's Switch menu. Enforces single-game mode: if starting a FRESH
// game while another is active (running or suspended), confirm, then the main
// process hard-closes the other(s) before launching.
import { confirmDialog } from './components/dialog.js';
import { toast } from './components/toast.js';
import { sfx } from './input/sfx.js';

const ACTIVE = new Set(['RUNNING', 'SUSPENDED', 'FROZEN_EXTERN', 'STALE',
  'LAUNCHING', 'RESUMING', 'SUSPENDING', 'CLOSING']);

function stateOf(store, appid) {
  return (store.game.games || {})[appid]?.state || 'NOT_RUNNING';
}

function otherActive(store, appid) {
  const out = [];
  for (const [key, info] of Object.entries(store.game.games || {})) {
    if (key === String(appid)) continue;
    if (ACTIVE.has(info.state)) out.push(key);
  }
  return out;
}

function nameFor(store, appid) {
  const g = (store.library.games || []).find((x) => x.appid === String(appid));
  return g ? g.name : `App ${appid}`;
}

// Returns {ok} — resolves after the launch/resume op completes.
export async function startGame({ store, appid, name }) {
  appid = String(appid);
  const st = stateOf(store, appid);
  const single = store.config?.singleGameMode !== false;

  // Resuming/focusing the game that's already up never triggers single-game.
  const isFreshStart = st === 'NOT_RUNNING' || st === 'STALE';

  if (single && isFreshStart) {
    const others = otherActive(store, appid);
    if (others.length) {
      const list = others.map((id) => nameFor(store, id)).join(', ');
      const choice = await confirmDialog({
        title: `Close ${list} and start ${name}?`,
        body: `Single-game mode is on, so only one game runs at a time. ${list} will be force-closed (unsaved progress lost) before ${name} starts.`,
        buttons: [
          { label: `Close & start ${name}`, value: 'go', danger: true },
          { label: 'Cancel', value: null },
        ],
      });
      if (choice !== 'go') return { ok: false, cancelled: true };
    }
  }

  const r = await window.launcher.game.play({ appid });
  if (r && !r.ok && !r.cancelled) { sfx.error(); toast(`${name}: ${r.error}`, 'error'); }
  else if (r && r.warning) toast(r.warning, 'info');
  return r || { ok: false };
}
