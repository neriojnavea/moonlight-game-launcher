// Debug screen: State / Logs / Input / Actions — fully controller-navigable.
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/dialog.js';
import { sfx } from '../input/sfx.js';

const TABS = ['State', 'Logs', 'Input', 'Actions'];
const MAX_EVENTS = 200;

export class DebugScreen {
  constructor({ el, store }) {
    this.el = el;
    this.store = store;
    this.tab = 0;
    this.actionFocused = 0;
    this.events = [];
    this.logLines = [];
    this.devices = [];
    this.unsubs = [];
    this.refreshTimer = null;

    this.el.innerHTML = `
      <div class="dbg-header">
        <div class="dbg-title">Debug</div>
        <div class="dbg-tabs">${TABS.map((t) => `<div class="dbg-tab">${t}</div>`).join('')}</div>
      </div>
      <div class="dbg-body">
        <div class="dbg-pane" data-pane="0">
          <div class="dbg-section-title">Reconciler state</div>
          <div class="dbg-scroll"><table class="dbg-table"><thead>
            <tr><th>App</th><th>State</th><th>Alive</th><th>Cond</th><th>Window</th><th>Warning</th></tr>
          </thead><tbody class="st-body"></tbody></table>
          <div class="dbg-section-title">Steam / meta</div>
          <pre class="dbg-pre st-meta"></pre>
          <div class="dbg-section-title">State files (/run/user/1000)</div>
          <pre class="dbg-pre st-files"></pre></div>
        </div>
        <div class="dbg-pane" data-pane="1">
          <div class="dbg-scroll log-scroll"></div>
        </div>
        <div class="dbg-pane" data-pane="2">
          <div class="dbg-section-title">Input devices (green = gamepad, has BTN_MODE)</div>
          <div class="dev-list"></div>
          <div class="dbg-section-title">Live events — press buttons to test</div>
          <div class="evt-stream"></div>
        </div>
        <div class="dbg-pane" data-pane="3">
          <div class="dbg-actions">
            <div class="dbg-action" data-act="resumeAll">Resume all frozen games<span class="sub">gamectl resume-all — the rescue hatch</span></div>
            <div class="dbg-action" data-act="resyncLibrary">Resync Steam library<span class="sub">re-enumerate installed games and fetch missing box art</span></div>
            <div class="dbg-action" data-act="restartLauncher">Restart launcher<span class="sub">full relaunch; games and parked state are untouched</span></div>
            <div class="dbg-action" data-act="quitLauncher">Quit launcher<span class="sub">exit the launcher; games keep running. Restart it from the desktop icon or the Sunshine app list</span></div>
          </div>
          <div class="dbg-section-title" style="margin-top:3vh">System</div>
          <pre class="dbg-pre sysinfo"></pre>
        </div>
      </div>
      <div class="dbg-footer"></div>`;
  }

  async enter() {
    this.renderChrome();
    this.renderAll();
    await window.launcher.debug.subscribeLogs();
    const { devices } = await window.launcher.debug.subscribeInput();
    this.devices = devices || [];
    this.unsubs = [
      window.launcher.debug.onLogData(({ name, lines }) => {
        for (const l of lines) this.logLines.push({ src: name, line: l });
        this.logLines = this.logLines.slice(-400);
        if (this.tab === 1) this.renderLogs();
      }),
      window.launcher.debug.onInputEvent((evt) => {
        this.events.push(evt);
        this.events = this.events.slice(-MAX_EVENTS);
        if (this.tab === 2) this.renderEvents();
      }),
      window.launcher.debug.onDevices((devices) => {
        this.devices = devices;
        if (this.tab === 2) this.renderDevices();
      }),
    ];
    // Seed logs.
    this.logLines = [];
    for (const name of ['launcher', 'suspend', 'sunshine']) {
      const r = await window.launcher.debug.logTail({ name, lines: 40 });
      if (r.ok) for (const l of r.lines) if (l) this.logLines.push({ src: name, line: l });
    }
    this.refreshTimer = setInterval(() => { if (this.tab === 0) this.renderState(); }, 2000);
    this.renderAll();
  }

  async exit() {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    clearInterval(this.refreshTimer);
    await window.launcher.debug.unsubscribeLogs();
    await window.launcher.debug.unsubscribeInput();
  }

  renderChrome() {
    this.el.querySelectorAll('.dbg-tab').forEach((t, i) => t.classList.toggle('active', i === this.tab));
    this.el.querySelectorAll('.dbg-pane').forEach((p, i) => p.classList.toggle('active', i === this.tab));
    const gs = this.store.glyphs;
    this.el.querySelector('.dbg-footer').innerHTML = [
      ['LB / RB', 'Switch tab'],
      [gs ? gs.cancel.text : 'B', 'Back to library'],
      this.tab === 3 ? [gs ? gs.confirm.text : 'A', 'Run action'] : ['↑↓', 'Scroll'],
    ].map(([k, v]) => `<span class="hint"><span class="glyph">${k}</span>${v}</span>`).join('');
  }

  renderAll() {
    this.renderChrome();
    this.renderState();
    this.renderLogs();
    this.renderDevices();
    this.renderEvents();
    this.renderActions();
    this.renderSysinfo();
  }

  async renderState() {
    const snap = this.store.game;
    const body = this.el.querySelector('.st-body');
    const rows = [];
    const names = Object.fromEntries((this.store.library.games || []).map((g) => [g.appid, g.name]));
    for (const [appid, info] of Object.entries(snap.games || {})) {
      rows.push(`<tr>
        <td>${esc(names[appid] || appid)} <span style="color:var(--fg-dim)">(${esc(appid)})</span></td>
        <td class="st-${esc(info.state)}">${esc(info.state)}</td>
        <td>${info.alive ?? ''}</td>
        <td>${esc(info.condition || '')}</td>
        <td>${info.hasWindow ? 'yes' : '—'}</td>
        <td style="color:var(--danger)">${esc(info.warning || '')}</td>
      </tr>`);
    }
    body.innerHTML = rows.join('') || '<tr><td colspan="6" style="color:var(--fg-dim)">no live or parked games</td></tr>';
    this.el.querySelector('.st-meta').textContent =
      `steam: running=${snap.steam?.running} frozen=${snap.steam?.frozen}\n` +
      `lastParked: ${snap.lastParked || '—'}   currentGame: ${snap.currentGame || '—'}\n` +
      `opInFlight: ${snap.opInFlight ? snap.opInFlight.label : '—'}`;
    const files = await window.launcher.debug.stateFiles();
    this.el.querySelector('.st-files').textContent =
      Object.entries(files).map(([f, c]) => `${f}:\n${c.split('\n').slice(0, 4).join(' ')}${c.split('\n').length > 4 ? ' …' : ''}`).join('\n\n') || '(none)';
  }

  renderLogs() {
    const el = this.el.querySelector('.log-scroll');
    el.innerHTML = this.logLines.map(({ src, line }) =>
      `<div class="log-line ${/error|fail|warn/i.test(line) ? 'hl' : ''}"><span class="log-src">[${esc(src)}]</span>${esc(line)}</div>`).join('');
    el.scrollTop = el.scrollHeight;
  }

  renderDevices() {
    this.el.querySelector('.dev-list').innerHTML = (this.devices || []).map((d) =>
      `<div class="dev-row ${d.hasBtnMode ? 'gamepad' : ''}">event${d.event}  ${esc(d.name)}  [${esc(d.vendor)}:${esc(d.product)}]${d.hasBtnMode ? '  ← gamepad' : ''}</div>`).join('') || '(no devices)';
  }

  renderEvents() {
    const el = this.el.querySelector('.evt-stream');
    el.innerHTML = [...this.events].reverse().map((e) => {
      const cls = e.type === 1 ? (e.code === 316 ? 'guide' : 'key') : '';
      return `<div class="evt-line ${cls}">${esc(e.device)}  type=${e.type} code=${e.code} value=${e.value}${e.code === 316 ? '  ← GUIDE' : ''}</div>`;
    }).join('');
  }

  renderActions() {
    this.el.querySelectorAll('.dbg-action').forEach((a, i) =>
      a.classList.toggle('focused', i === this.actionFocused));
  }

  async renderSysinfo() {
    const info = await window.launcher.system.info();
    this.el.querySelector('.sysinfo').textContent =
      `display: ${info.display.width}x${info.display.height}@${info.display.rate || '?'}\n` +
      `electron ${info.versions.electron} / node ${info.versions.node}\n` +
      `control socket: ${info.socket}\npid: ${info.pid}`;
  }

  async handleAction(action) {
    switch (action) {
      case 'lb':
        this.tab = (this.tab + TABS.length - 1) % TABS.length;
        sfx.move(); this.renderAll(); break;
      case 'rb':
        this.tab = (this.tab + 1) % TABS.length;
        sfx.move(); this.renderAll(); break;
      case 'up': case 'down': {
        if (this.tab === 3) {
          const n = this.el.querySelectorAll('.dbg-action').length;
          this.actionFocused = (this.actionFocused + (action === 'down' ? 1 : n - 1)) % n;
          sfx.move(); this.renderActions();
        } else {
          const pane = this.el.querySelector(`.dbg-pane[data-pane="${this.tab}"] .dbg-scroll, .dbg-pane[data-pane="${this.tab}"] .evt-stream`);
          if (pane) pane.scrollBy({ top: (action === 'down' ? 1 : -1) * pane.clientHeight * 0.35, behavior: 'smooth' });
        }
        break;
      }
      case 'confirm': {
        if (this.tab !== 3) break;
        const act = this.el.querySelectorAll('.dbg-action')[this.actionFocused].dataset.act;
        sfx.confirm();
        if (act === 'quitLauncher') {
          const c = await confirmDialog({
            title: 'Quit the launcher?',
            body: 'The launcher exits. Any running games keep running. Restart it from the "Game Launcher" desktop icon or the Sunshine app list.',
            buttons: [{ label: 'Quit launcher', value: 'go', danger: true }, { label: 'Cancel', value: null }],
          });
          if (c !== 'go') break;
        }
        toast(`Running ${act}…`);
        const r = await window.launcher.debug.action({ action: act });
        if (r && r.ok === false) { sfx.error(); toast(`${act} failed: ${r.error}`, 'error'); }
        else toast(`${act} done`, 'ok');
        break;
      }
      default: break;
    }
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
