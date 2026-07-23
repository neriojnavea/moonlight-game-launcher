// Map lifecycle states to badge chips.
const BADGES = {
  RUNNING: { cls: 'running', label: 'Running' },
  SUSPENDED: { cls: 'suspended', label: 'Suspended' },
  FROZEN_EXTERN: { cls: 'suspended', label: 'Frozen' },
  STALE: { cls: 'stale', label: 'Stale' },
  LAUNCHING: { cls: 'busy', label: 'Launching' },
  SUSPENDING: { cls: 'busy', label: 'Suspending' },
  RESUMING: { cls: 'busy', label: 'Resuming' },
  CLOSING: { cls: 'busy', label: 'Closing' },
};

export const BUSY_STATES = ['LAUNCHING', 'SUSPENDING', 'RESUMING', 'CLOSING'];

export function badgeFor(state) {
  return BADGES[state] || null;
}

export function badgeHtml(state) {
  const b = badgeFor(state);
  if (!b) return '';
  const span = document.createElement('span');
  span.className = `badge ${b.cls}`;
  span.textContent = b.label;
  return span.outerHTML;
}
