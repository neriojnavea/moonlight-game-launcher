// Compact live resource readout (CPU / RAM / VRAM / GPU) for the library top
// bar and the overlay. Call renderResMon(el, stats) whenever stats change.

function bar(pct) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const hue = p < 60 ? 'ok' : p < 85 ? 'warn' : 'hot';
  return `<span class="rm-bar"><span class="rm-fill ${hue}" style="width:${p}%"></span></span>`;
}

function gb(mb) { return (mb / 1024).toFixed(1); }

export function renderResMon(el, stats) {
  if (!el) return;
  if (!stats) { el.innerHTML = '<span class="rm-item rm-dim">…</span>'; return; }
  const items = [];
  items.push(`<span class="rm-item"><span class="rm-label">CPU</span>${bar(stats.cpu)}<span class="rm-val">${stats.cpu}%</span></span>`);
  if (stats.mem) {
    items.push(`<span class="rm-item"><span class="rm-label">RAM</span>${bar(stats.mem.pct)}<span class="rm-val">${gb(stats.mem.usedMB)}/${gb(stats.mem.totalMB)}G</span></span>`);
  }
  if (stats.gpu) {
    items.push(`<span class="rm-item"><span class="rm-label">GPU</span>${bar(stats.gpu.utilPct)}<span class="rm-val">${stats.gpu.utilPct}%</span></span>`);
    items.push(`<span class="rm-item"><span class="rm-label">VRAM</span>${bar(stats.gpu.memPct)}<span class="rm-val">${gb(stats.gpu.memUsedMB)}/${gb(stats.gpu.memTotalMB)}G</span></span>`);
    if (Number.isFinite(stats.gpu.tempC)) {
      items.push(`<span class="rm-item rm-temp"><span class="rm-label">TEMP</span><span class="rm-val">${stats.gpu.tempC}°</span></span>`);
    }
  }
  el.innerHTML = items.join('');
}
