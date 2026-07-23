'use strict';
// Shared helpers for main-process modules.
const { execFile } = require('child_process');

const RUN = '/run/user/1000';
const HOME = '/home/nerio';
const MOON = `${HOME}/moonlight`;

// Every child process gets the X env explicitly: the launcher may be started
// from SSH during development where DISPLAY/XAUTHORITY are absent (CLAUDE.md §2.4).
const XENV = {
  ...process.env,
  DISPLAY: process.env.DISPLAY || ':0',
  XAUTHORITY: process.env.XAUTHORITY || `${RUN}/gdm/Xauthority`,
};

// execFile (never shell) so zsh word-splitting can't bite (CLAUDE.md §2.2).
// Resolves {stdout, stderr, code}; never rejects on non-zero exit — callers
// inspect `code` because tools like pgrep exit 1 on "no match".
function run(cmd, args = [], opts = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: XENV, timeout: 30000, ...opts }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code === undefined || typeof err.code === 'string' ? 127 : err.code) : 0,
        stdout: stdout ?? '',
        stderr: stderr ?? '',
        error: err && (err.killed || typeof err.code === 'string') ? err : null,
      });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { RUN, HOME, MOON, XENV, run, sleep };
