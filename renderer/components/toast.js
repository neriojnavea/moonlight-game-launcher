const root = () => document.getElementById('toast-root');

export function toast(message, kind = 'info', ms = 4200) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root().appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 400);
  }, ms);
}
