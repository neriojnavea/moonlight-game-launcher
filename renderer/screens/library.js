// Library screen: hero + horizontal card rail.
import { badgeHtml, BUSY_STATES } from '../components/badge.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/dialog.js';
import { renderResMon } from '../components/resmon.js';
import { startGame } from '../start-game.js';
import { sfx } from '../input/sfx.js';

export class LibraryScreen {
  constructor({ el, store }) {
    this.el = el;
    this.store = store;
    this.focused = 0;
    this.firstShow = true;
    this.el.innerHTML = `
      <div class="lib-top">
        <div class="lib-brand">Library</div>
        <div class="lib-status">
          <span class="resmon" id="lib-resmon"></span>
          <span class="lib-steam"></span>
          <span class="lib-clock"></span>
        </div>
      </div>
      <div class="hero">
        <div class="hero-title"></div>
        <div class="hero-meta"></div>
      </div>
      <div class="rail-viewport"><div class="rail"></div></div>
      <div class="lib-empty" style="display:none">
        <div>No Steam games found.</div>
        <div style="font-size:0.8em">Check the Debug screen (View+Menu) → Actions → Resync library.</div>
      </div>
      <div class="hints"></div>`;
    this.rail = this.el.querySelector('.rail');
    this.hero = this.el.querySelector('.hero');
    this.clockEl = this.el.querySelector('.lib-clock');
    setInterval(() => this.tickClock(), 20000);
    this.tickClock();
    window.addEventListener('resize', () => this.layout());
  }

  tickClock() {
    this.clockEl.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  renderStats() {
    renderResMon(this.el.querySelector('#lib-resmon'), this.store.stats);
  }

  games() { return this.store.library.games || []; }
  gameState(appid) {
    return (this.store.game.games || {})[appid] || { state: 'NOT_RUNNING' };
  }

  // ---- rendering ----

  rebuild() {
    const games = this.games();
    this.el.querySelector('.lib-empty').style.display = games.length ? 'none' : 'flex';
    this.rail.innerHTML = '';
    games.forEach((g, i) => {
      const card = document.createElement('div');
      card.className = 'card';
      card.dataset.appid = g.appid;
      const art = g.cover
        ? `<img src="file://${g.cover}" alt="" draggable="false">`
        : `<div class="card-fallback">${escapeHtml(g.name)}</div>`;
      card.innerHTML = `<div class="card-art">${art}</div><span class="badge-slot"></span>`;
      this.rail.appendChild(card);
      if (this.firstShow) {
        card.classList.add('entering');
        card.style.animationDelay = `${i * 55}ms`;
        card.addEventListener('animationend', () => {
          card.classList.remove('entering');
          card.classList.add('entered');
        }, { once: true });
      } else {
        card.classList.add('entered');
      }
    });
    this.firstShow = false;
    if (this.focused >= games.length) this.focused = Math.max(0, games.length - 1);
    this.update();
  }

  // Cheap per-state refresh: badges, focus ring, hero.
  update() {
    const games = this.games();
    const cards = this.rail.children;
    for (let i = 0; i < cards.length; i++) {
      const g = games[i];
      const st = this.gameState(g.appid);
      cards[i].classList.toggle('focused', i === this.focused);
      cards[i].classList.toggle('busy', BUSY_STATES.includes(st.state));
      cards[i].querySelector('.badge-slot').innerHTML = badgeHtml(st.state);
    }
    this.layout();
    this.renderHero();
    this.renderSteam();
    this.renderStats();
    this.renderHints();
  }

  layout() {
    const games = this.games();
    if (!games.length) return;
    const card = this.rail.children[0];
    if (!card) return;
    const w = card.getBoundingClientRect().width || 1;
    const gap = parseFloat(getComputedStyle(this.rail).gap) || 0;
    const x = window.innerWidth / 2 - (this.focused * (w + gap) + w / 2);
    this.rail.style.transform = `translateX(${x}px)`;
  }

  renderHero() {
    const g = this.games()[this.focused];
    if (!g) { this.hero.classList.remove('shown'); return; }
    const st = this.gameState(g.appid);
    this.hero.querySelector('.hero-title').textContent = g.name;
    const meta = this.hero.querySelector('.hero-meta');
    const sub = {
      RUNNING: 'Running — press to jump back in',
      SUSPENDED: 'Suspended — resume exactly where you left off',
      FROZEN_EXTERN: 'Frozen outside the launcher',
      STALE: 'Stale state — game exited while parked',
      LAUNCHING: 'Launching…', RESUMING: 'Resuming…',
      SUSPENDING: 'Suspending…', CLOSING: 'Closing…',
    }[st.state] || 'Ready to play';
    meta.innerHTML = `${badgeHtml(st.state)}<span class="hero-sub">${escapeHtml(sub)}</span>` +
      (st.warning ? `<span class="badge warn">!</span><span class="hero-sub">${escapeHtml(st.warning)}</span>` : '');
    // retrigger entrance animation on selection change
    this.hero.classList.remove('shown');
    void this.hero.offsetWidth;
    this.hero.classList.add('shown');
  }

  renderSteam() {
    const s = this.store.game.steam || {};
    const el = this.el.querySelector('.lib-steam');
    el.innerHTML = !s.running
      ? '<span class="badge stale">Steam off</span>'
      : s.frozen ? '<span class="badge suspended">Steam frozen</span>' : '';
  }

  renderHints() {
    const g = this.games()[this.focused];
    const st = g ? this.gameState(g.appid).state : 'NOT_RUNNING';
    const gs = this.store.glyphs;
    const hints = [];
    const verb = st === 'RUNNING' ? 'Back to game' : st === 'SUSPENDED' || st === 'FROZEN_EXTERN' ? 'Resume' : 'Play';
    hints.push([gs.confirm, verb]);
    if (st === 'RUNNING') hints.push([gs.alt, 'Suspend']);
    if (['RUNNING', 'SUSPENDED', 'FROZEN_EXTERN', 'STALE'].includes(st)) hints.push([gs.alt2, st === 'STALE' ? 'Clear' : 'Close']);
    hints.push([{ text: '⧉+≡', cls: '' }, 'Debug']);
    this.el.querySelector('.hints').innerHTML = hints.map(([glyph, label]) =>
      `<span class="hint"><span class="glyph ${glyph.cls}">${glyph.text}</span>${label}</span>`).join('');
  }

  // ---- input ----

  async handleAction(action) {
    const games = this.games();
    if (!games.length) return;
    const g = games[this.focused];
    const st = this.gameState(g.appid);
    switch (action) {
      case 'left':
        if (this.focused > 0) { this.focused--; sfx.move(); this.update(); }
        break;
      case 'right':
        if (this.focused < games.length - 1) { this.focused++; sfx.move(); this.update(); }
        break;
      case 'confirm': {
        sfx.confirm();
        await startGame({ store: this.store, appid: g.appid, name: g.name });
        break;
      }
      case 'alt': // suspend
        if (st.state === 'RUNNING') {
          sfx.confirm();
          toast(`Suspending ${g.name}…`);
          const r = await window.launcher.game.suspend({ appid: g.appid });
          if (r && !r.ok) { sfx.error(); toast(`Suspend failed: ${r.error}`, 'error'); }
          else toast(`${g.name} suspended`, 'ok');
        }
        break;
      case 'alt2': // close / clear stale
        if (st.state === 'STALE') {
          await window.launcher.game.clearStale({ appid: g.appid });
          toast('Stale state cleared', 'ok');
        } else if (['RUNNING', 'SUSPENDED', 'FROZEN_EXTERN'].includes(st.state)) {
          await this.closeFlow(g);
        }
        break;
      default: break;
    }
  }

  async closeFlow(g) {
    const choice = await confirmDialog({
      title: `Close ${g.name}?`,
      body: 'The game is force-closed immediately. Unsaved progress will be lost.',
      buttons: [{ label: 'Close game', value: 'close', danger: true }, { label: 'Cancel', value: null }],
    });
    if (choice !== 'close') return;
    toast(`Closing ${g.name}…`);
    const r = await window.launcher.game.close({ appid: g.appid });
    if (r && r.needsKill) {
      const kill = await confirmDialog({
        title: `${g.name} is not responding`,
        body: 'It ignored the quit request and SIGTERM. Force kill? Unsaved progress WILL be lost.',
        buttons: [{ label: 'Force kill', value: 'kill', danger: true }, { label: 'Leave it', value: null }],
      });
      if (kill === 'kill') {
        await window.launcher.game.forceKill({ appid: g.appid });
        toast(`${g.name} force-killed`, 'ok');
      }
    } else if (r && !r.ok) {
      sfx.error(); toast(`Close failed: ${r.error}`, 'error');
    } else {
      toast(`${g.name} closed`, 'ok');
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
