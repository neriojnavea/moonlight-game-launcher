'use strict';
// System resource sampler: CPU %, RAM, GPU util/VRAM/temp. Emits 'stats'
// on an interval. CPU is a delta between two /proc/stat reads; GPU comes from
// one nvidia-smi call (~50ms) which is fine at a 2s cadence.
const fs = require('fs');
const { EventEmitter } = require('events');
const { run } = require('./util');
const { log } = require('./logger');

class SysMon extends EventEmitter {
  constructor({ intervalMs = 2000 } = {}) {
    super();
    this.intervalMs = intervalMs;
    this.timer = null;
    this.prevCpu = null;
    this.last = null;
    this.gpuOk = true;
  }

  start() {
    const tick = async () => {
      try { this.last = await this.sample(); this.emit('stats', this.last); }
      catch (e) { log('sysmon', 'sample error:', e.message); }
      this.timer = setTimeout(tick, this.intervalMs);
    };
    tick();
  }

  stop() { clearTimeout(this.timer); }

  latest() { return this.last; }

  // ---- CPU ----
  readCpu() {
    // First line of /proc/stat: "cpu  user nice system idle iowait irq softirq steal ..."
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = parts[3] + (parts[4] || 0); // idle + iowait
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  }

  cpuPct() {
    const cur = this.readCpu();
    let pct = 0;
    if (this.prevCpu) {
      const dt = cur.total - this.prevCpu.total;
      const di = cur.idle - this.prevCpu.idle;
      pct = dt > 0 ? Math.max(0, Math.min(100, (100 * (dt - di)) / dt)) : 0;
    }
    this.prevCpu = cur;
    return Math.round(pct);
  }

  // ---- RAM ----
  readMem() {
    const info = {};
    for (const line of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) {
      const m = line.match(/^(\w+):\s+(\d+)/);
      if (m) info[m[1]] = Number(m[2]); // kB
    }
    const totalMB = Math.round(info.MemTotal / 1024);
    const availMB = Math.round((info.MemAvailable ?? info.MemFree) / 1024);
    const usedMB = totalMB - availMB;
    return { usedMB, totalMB, pct: Math.round((100 * usedMB) / totalMB) };
  }

  // ---- GPU ----
  async readGpu() {
    if (!this.gpuOk) return null;
    const r = await run('nvidia-smi', [
      '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,name',
      '--format=csv,noheader,nounits',
    ], { timeout: 4000 });
    if (r.code !== 0) {
      this.gpuOk = false; // stop retrying if no NVIDIA
      log('sysmon', 'nvidia-smi unavailable; GPU stats off');
      return null;
    }
    const [util, memUsed, memTotal, temp, ...nameParts] = r.stdout.trim().split(',').map((s) => s.trim());
    return {
      utilPct: Number(util),
      memUsedMB: Number(memUsed),
      memTotalMB: Number(memTotal),
      memPct: Math.round((100 * Number(memUsed)) / Number(memTotal)),
      tempC: Number(temp),
      name: nameParts.join(',').trim(),
    };
  }

  async sample() {
    const cpu = this.cpuPct();
    const mem = this.readMem();
    const gpu = await this.readGpu();
    return { cpu, mem, gpu, ts: Date.now() };
  }
}

module.exports = { SysMon };
