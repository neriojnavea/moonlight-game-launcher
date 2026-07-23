// Controller-navigable modal confirm. While open it takes input priority
// (app.js routes actions here first).
import { sfx } from '../input/sfx.js';

let state = null; // { buttons:[{label,value,danger}], focused, resolve }

const root = () => document.getElementById('dialog-root');

export function dialogOpen() { return state !== null; }

export function confirmDialog({ title, body, buttons }) {
  return new Promise((resolve) => {
    state = { buttons, focused: buttons.length - 1, resolve };
    const r = root();
    r.innerHTML = `
      <div class="dialog">
        <h2></h2>
        <p></p>
        <div class="dialog-buttons"></div>
      </div>`;
    r.querySelector('h2').textContent = title;
    r.querySelector('p').textContent = body || '';
    const btnRow = r.querySelector('.dialog-buttons');
    buttons.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'dialog-btn' + (b.danger ? ' danger' : '');
      el.textContent = b.label;
      el.dataset.i = i;
      btnRow.appendChild(el);
    });
    r.classList.add('open');
    render();
    sfx.open();
  });
}

function render() {
  root().querySelectorAll('.dialog-btn').forEach((el, i) => {
    el.classList.toggle('focused', i === state.focused);
  });
}

function close(value) {
  const { resolve } = state;
  state = null;
  root().classList.remove('open');
  root().innerHTML = '';
  resolve(value);
}

// Returns true if the action was consumed.
export function dialogHandle(action) {
  if (!state) return false;
  switch (action) {
    case 'left': case 'up':
      state.focused = (state.focused + state.buttons.length - 1) % state.buttons.length;
      sfx.move(); render(); break;
    case 'right': case 'down':
      state.focused = (state.focused + 1) % state.buttons.length;
      sfx.move(); render(); break;
    case 'confirm':
      sfx.confirm(); close(state.buttons[state.focused].value); break;
    case 'cancel':
      sfx.cancel(); close(null); break;
    default: break;
  }
  return true;
}
