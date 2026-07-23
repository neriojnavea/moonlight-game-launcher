// In-game overlay: opaque art-backed panel over the (still running) game.
import { badgeHtml } from '../components/badge.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/dialog.js';
import { renderResMon } from '../components/resmon.js';
import { startGame } from '../start-game.js';
import { sfx } from '../input/sfx.js';

const MENU = [
  { id: 'return', icon: '▶', label: 'Return to game' },
  { id: 'suspend', icon: '⏸', label: 'Suspend & go to Library' },
  { id: 'switch', icon: '⇄', label: 'Switch to…' },
  { id: 'close', icon: '✕', label: 'Close game', danger: true },
];

export class OverlayScreen {
  constructor({ el, store }) {
    this.el = el;
    this.store = store;
    this.appid = null;
    this.focused = 0;
    this.switchOpen = false;
    this.switchFocused = 0;
    this.el.innerHTML = `
      <div class="ov-art"></div>
      <div class="ov-grad"></div>
      <div class="ov-panel">
        <div class="ov-kicker">In game</div>
        <div class="ov-title"></div>
        <div class="ov-state"></div>
        <div class="resmon ov-resmon" id="ov-resmon"></div>
        <div class="ov-menu"></div>
      </div>
      <div class="ov-switch">
        <div class="ov-switch-title">Switch to</div>
        <div class="mini-rail"></div>
        <div class="mini-name"></div>
      </div>
      <div class="hints"></div>`;
  }

  game() { return this.store.library.games.find((g) => g.appid === this.appid) || null; }
  otherGames() { return this.store.library.games.filter((g) => g.appid !== this.appid); }
  gameState(appid) { return (this.store.game.games || {})[appid] || { state: 'NOT_RUNNING' }; }

  enter(appid) {
    this.appid = appid;
    this.focused = 0;
    this.switchOpen = false;
    sfx.open();
    this.render();
    const panel = this.el.querySelector('.ov-panel');
    panel.classList.remove('shown');
    void panel.offsetWidth;
    panel.classList.add('shown');
  }

  render() {
    const g = this.game();
    const st = this.gameState(this.appid);
    this.el.querySelector('.ov-art').style.backgroundImage =
      g && g.cover ? `url("file://${g.cover}")` : 'none';
    this.el.querySelector('.ov-title').textContent = g ? g.name : `App ${this.appid}`;
    this.el.querySelector('.ov-state').innerHTML = badgeHtml(st.state) || badgeHtml('RUNNING');

    const menuEl = this.el.querySelector('.ov-menu');
    menuEl.innerHTML = '';
    MENU.forEach((item, i) => {
      const el = document.createElement('div');
      el.className = 'ov-item' + (item.danger ? ' danger' : '');
      if (item.id === 'switch' && !this.otherGames().length) el.classList.add('disabled');
      el.classList.toggle('focused', !this.switchOpen && i === this.focused);
      el.innerHTML = `<span class="ov-icon">${item.icon}</span><span>${item.label}</span>`;
      menuEl.appendChild(el);
    });

    const sw = this.el.querySelector('.ov-switch');
    sw.classList.toggle('open', this.switchOpen);
    if (this.switchOpen) this.renderSwitch();
    this.renderStats();
    this.renderHints();
  }

  renderStats() {
    renderResMon(this.el.querySelector('#ov-resmon'), this.store.stats);
  }

  renderSwitch() {
    const others = this.otherGames();
    const railEl = this.el.querySelector('.mini-rail');
    railEl.innerHTML = '';
    others.forEach((g, i) => {
      const st = this.gameState(g.appid);
      const el = document.createElement('div');
      el.className = 'mini-card' + (i === this.switchFocused ? ' focused' : '');
      el.innerHTML = (g.cover ? `<img src="file://${g.cover}" draggable="false">` : '') + badgeHtml(st.state);
      railEl.appendChild(el);
    });
    const focused = others[this.switchFocused];
    this.el.querySelector('.mini-name').textContent = focused ? focused.name : '';
  }

  renderHints() {
    const gs = this.store.glyphs;
    const hints = this.switchOpen
      ? [[gs.confirm, 'Switch'], [gs.cancel, 'Back']]
      : [[gs.confirm, 'Select'], [gs.cancel, 'Return to game'], [gs.home, 'Return to game']];
    this.el.querySelector('.hints').innerHTML = hints.map(([glyph, label]) =>
      `<span class="hint"><span class="glyph ${glyph.cls}">${glyph.text}</span>${label}</span>`).join('');
  }

  async handleAction(action) {
    if (this.switchOpen) return this.handleSwitchAction(action);
    switch (action) {
      case 'up':
        this.focused = (this.focused + MENU.length - 1) % MENU.length;
        sfx.move(); this.render(); break;
      case 'down':
        this.focused = (this.focused + 1) % MENU.length;
        sfx.move(); this.render(); break;
      case 'confirm':
        await this.activate(MENU[this.focused].id); break;
      case 'cancel':
        sfx.cancel(); await window.launcher.nav.returnToGame(); break;
      default: break;
    }
  }

  async handleSwitchAction(action) {
    const others = this.otherGames();
    switch (action) {
      case 'left':
        if (this.switchFocused > 0) { this.switchFocused--; sfx.move(); this.renderSwitch(); }
        break;
      case 'right':
        if (this.switchFocused < others.length - 1) { this.switchFocused++; sfx.move(); this.renderSwitch(); }
        break;
      case 'confirm': {
        const target = others[this.switchFocused];
        if (!target) return;
        sfx.confirm();
        // startGame handles single-game mode (confirm + hard-close current)
        // or, when off, main auto-suspends the current game.
        await startGame({ store: this.store, appid: target.appid, name: target.name });
        break;
      }
      case 'cancel':
        sfx.cancel();
        this.switchOpen = false;
        this.render();
        break;
      default: break;
    }
  }

  async activate(id) {
    const g = this.game();
    switch (id) {
      case 'return':
        sfx.confirm();
        await window.launcher.nav.returnToGame();
        break;
      case 'suspend': {
        sfx.confirm();
        toast(`Suspending ${g ? g.name : this.appid}…`);
        const r = await window.launcher.game.suspend({ appid: this.appid });
        if (r && !r.ok) { sfx.error(); toast(`Suspend failed: ${r.error}`, 'error'); return; }
        toast(`${g ? g.name : this.appid} suspended`, 'ok');
        await window.launcher.nav.showLibrary();
        break;
      }
      case 'switch':
        if (!this.otherGames().length) return;
        sfx.confirm();
        this.switchOpen = true;
        this.switchFocused = 0;
        this.render();
        break;
      case 'close': {
        const choice = await confirmDialog({
          title: `Close ${g ? g.name : this.appid}?`,
          body: 'The game is force-closed immediately. Unsaved progress will be lost.',
          buttons: [{ label: 'Close game', value: 'close', danger: true }, { label: 'Cancel', value: null }],
        });
        if (choice !== 'close') { this.render(); return; }
        toast('Closing…');
        const r = await window.launcher.game.close({ appid: this.appid });
        if (r && r.needsKill) {
          const kill = await confirmDialog({
            title: 'Game is not responding',
            body: 'It ignored the quit request and SIGTERM. Force kill? Unsaved progress WILL be lost.',
            buttons: [{ label: 'Force kill', value: 'kill', danger: true }, { label: 'Leave it', value: null }],
          });
          if (kill === 'kill') await window.launcher.game.forceKill({ appid: this.appid });
        } else if (r && !r.ok) {
          sfx.error(); toast(`Close failed: ${r.error}`, 'error');
        }
        break;
      }
      default: break;
    }
  }
}
