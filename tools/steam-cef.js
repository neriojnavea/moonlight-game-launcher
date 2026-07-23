#!/usr/bin/env node
'use strict';
// Evaluate a JS expression inside Steam's SharedJSContext via CEF remote
// debugging. Used one-shot to flip client settings that have no config-file
// representation (e.g. controller_guide_button_focus_steam, field 14002).
//
// Usage: node steam-cef.js [--port N] [--target NameSubstring] '<expression>'
// Steam must be running with remote debugging enabled on that port (see
// SETUP.md notes — normally requires the .cef-enable-remote-debugging flag
// file, plus a temporary steamwebhelper wrapper because port 8080 is taken
// on this host).
const http = require('http');
const path = require('path');
const WebSocket = require(path.join(__dirname, '..', 'node_modules', 'ws'));

const args = process.argv.slice(2);
let port = 9222, target = 'SharedJSContext';
for (let i = 0; i < args.length - 1; i++) {
  if (args[i] === '--port') { port = Number(args[i + 1]); args.splice(i, 2); i--; }
  else if (args[i] === '--target') { target = args[i + 1]; args.splice(i, 2); i--; }
}
const expression = args[0];
if (!expression) { console.error('usage: steam-cef.js [--port N] [--target substr] <expression>'); process.exit(2); }

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

(async () => {
  const tabs = await getJson(`http://127.0.0.1:${port}/json`);
  const tab = tabs.find((t) => (t.title || '').includes(target)) || tabs[0];
  if (!tab) { console.error('no debug targets'); process.exit(1); }
  console.error(`target: ${tab.title}`);
  const ws = new WebSocket(tab.webSocketDebuggerUrl, { perMessageDeflate: false });
  ws.on('open', () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }));
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data);
    if (msg.id === 1) {
      console.log(JSON.stringify(msg.result, null, 2));
      ws.close();
      process.exit(msg.result && msg.result.exceptionDetails ? 1 : 0);
    }
  });
  ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
  setTimeout(() => { console.error('timeout'); process.exit(1); }, 15000);
})().catch((e) => { console.error(e.message); process.exit(1); });
