'use strict';
// The SINGLE driver of suspend/resume (QUICK-RESUME invariant 1, enforced
// structurally): every suspend/resume/close from any surface — UI, overlay,
// control socket, tests — funnels through this one FIFO queue, one op in
// flight globally. It shells out to the existing, tested scripts UNCHANGED so
// their pid-set math (subtract ALL games from Steam's tree; grep -vxF, never
// comm) stays the single implementation.
const { MOON, run } = require('./util');
const { log } = require('./logger');

let chain = Promise.resolve();
let inFlight = null; // { label, startedAt }

function enqueue(label, fn) {
  const task = chain.then(async () => {
    inFlight = { label, startedAt: Date.now() };
    log('op', 'start', label);
    try {
      return await fn();
    } finally {
      log('op', 'done', label);
      inFlight = null;
    }
  });
  // Keep the chain alive even when a task rejects.
  chain = task.catch(() => {});
  return task;
}

const current = () => inFlight;

async function runScript(script, args) {
  const r = await run(`${MOON}/${script}`, args, { timeout: 60000 });
  if (r.code !== 0) {
    // The scripts are exit-0 by design; non-zero means something environmental.
    throw new Error(`${script} exited ${r.code}: ${r.stderr.trim() || r.stdout.trim()}`);
  }
  return r.stdout;
}

const suspendScript = (appid) => runScript('suspend-game.sh', appid ? [String(appid)] : []);
const resumeScript = (appid) => runScript('resume-game.sh', appid ? [String(appid)] : []);
const resumeAllScript = () => runScript('gamectl', ['resume-all']);

module.exports = { enqueue, current, suspendScript, resumeScript, resumeAllScript };
