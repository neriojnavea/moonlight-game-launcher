// Renderer entry: store, screen router, input routing, ambient background.
import { InputManager } from './input/gamepad.js';
import { glyphSet } from './input/brand.mjs';
import { setSfxEnabled } from './input/sfx.js';
import { dialogOpen, dialogHandle } from './components/dialog.js';
import { LibraryScreen } from './screens/library.js';
import { OverlayScreen } from './screens/overlay.js';
import { DebugScreen } from './screens/debug.js';

const store = {
  library: { games: [] },
  game: { games: {}, steam: {}, lastParked: null, currentGame: null },
  config: null,
  stats: null,
  glyphs: glyphSet('generic'),
  screen: 'library',
  prevScreen: 'library',
};

const input = new InputManager();

const screens = {
  library: new LibraryScreen({ el: document.getElementById('screen-library'), store }),
  overlay: new OverlayScreen({ el: document.getElementById('screen-overlay'), store }),
  debug: new DebugScreen({ el: document.getElementById('screen-debug'), store }),
};

// ---- ambient background (cross-fading pair of layers) ----
let ambientCurrent = 'a';
let ambientUrl = null;
function setAmbient(url) {
  if (url === ambientUrl) return;
  ambientUrl = url;
  const next = ambientCurrent === 'a' ? 'b' : 'a';
  const nextEl = document.getElementById(`ambient-${next}`);
  const curEl = document.getElementById(`ambient-${ambientCurrent}`);
  nextEl.style.backgroundImage = url ? `url("file://${url}")` : 'none';
  nextEl.classList.add('visible');
  curEl.classList.remove('visible');
  ambientCurrent = next;
}

function refreshAmbient() {
  if (!store.config || store.config.animations.ambientBackground === false) return;
  let g = null;
  if (store.screen === 'overlay') g = store.library.games.find((x) => x.appid === screens.overlay.appid);
  else g = store.library.games[screens.library.focused];
  setAmbient(g && g.cover ? g.cover : null);
}

// ---- screen routing ----
async function switchScreen(name, arg) {
  if (store.screen === name) return;
  if (store.screen === 'debug') await screens.debug.exit();
  store.prevScreen = store.screen;
  store.screen = name;
  for (const [n, s] of Object.entries(screens)) {
    s.el.classList.toggle('active', n === name);
  }
  if (name === 'overlay') screens.overlay.enter(arg);
  if (name === 'debug') await screens.debug.enter();
  if (name === 'library') screens.library.update();
  refreshAmbient();
}

// ---- input routing ----
input.onAction(async (action) => {
  if (document.hidden) return;
  if (dialogOpen()) { dialogHandle(action); return; }
  if (action === 'debug') {
    if (store.screen === 'debug') await switchScreen(store.prevScreen === 'debug' ? 'library' : store.prevScreen);
    else await switchScreen('debug');
    return;
  }
  if (store.screen === 'debug' && action === 'cancel') {
    await switchScreen(store.prevScreen === 'debug' ? 'library' : store.prevScreen);
    return;
  }
  await screens[store.screen].handleAction(action);
  if (store.screen === 'library') refreshAmbient();
});

input.onBrand((brand) => {
  store.glyphs = glyphSet(brand);
  screens.library.renderHints();
  if (store.screen === 'overlay') screens.overlay.renderHints();
});

// Controller events arrive from the main process's evdev reader — the web
// Gamepad API is unreliable here once Steam Input attaches to the pad.
window.launcher.input.onAction((action) => input.feedAction(action));
window.launcher.input.onDirs((dirs) => input.feedDirs(dirs));
window.launcher.input.onBrand((brand) => input.setDetectedBrand(brand));

// ---- main-process events ----
window.launcher.nav.onVisibility(async ({ visible, mode, appid }) => {
  document.body.classList.toggle('paused', !visible);
  if (!visible) { input.stop(); return; }
  input.start();
  if (mode === 'overlay') await switchScreen('overlay', appid);
  else await switchScreen('library');
  refreshAmbient();
});

window.launcher.library.onUpdated((snap) => {
  store.library = snap;
  screens.library.rebuild();
  if (store.screen === 'overlay') screens.overlay.render();
  refreshAmbient();
});

window.launcher.state.onUpdated((snap) => {
  store.game = snap;
  screens.library.update();
  if (store.screen === 'overlay') screens.overlay.render();
});

window.launcher.config.onUpdated((cfg) => applyConfig(cfg));

window.launcher.sys.onStats((stats) => {
  store.stats = stats;
  if (store.screen === 'library') screens.library.renderStats();
  else if (store.screen === 'overlay') screens.overlay.renderStats();
});

function applyConfig(cfg) {
  store.config = cfg;
  document.body.classList.toggle('no-ambient', cfg.animations.ambientBackground === false);
  document.body.classList.toggle('reduced-motion', cfg.animations.enabled === false);
  setSfxEnabled(cfg.animations.enabled !== false);
  input.setBrandOverride(cfg.glyphs);
}

// ---- boot ----
(async function boot() {
  applyConfig(await window.launcher.config.get());
  store.library = await window.launcher.library.get();
  store.game = await window.launcher.state.get();
  store.stats = await window.launcher.sys.stats();
  screens.library.rebuild();
  document.getElementById('screen-library').classList.add('active');
  input.start();
  refreshAmbient();
})();
