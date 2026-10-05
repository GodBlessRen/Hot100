'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const pidFile = path.join(os.tmpdir(), 'hot100-judge-safe.pid');
const logFile = path.join(os.tmpdir(), 'hot100-judge-safe.log');

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
}

try {
  const oldPid = Number(fs.readFileSync(pidFile, 'utf8').trim());
  if (alive(oldPid)) {
    console.log(`Hot100 Judge already running (pid ${oldPid}).`);
    console.log(`Open http://${process.env.HOST || '127.0.0.1'}:${process.env.PORT || 5173}`);
    process.exit(0);
  }
} catch (_) {}

const out = fs.openSync(logFile, 'a');
const safeEnv = {
  PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
  HOME: process.env.HOME || os.tmpdir(),
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  HOST: process.env.HOST || '127.0.0.1',
  PORT: String(process.env.PORT || 5173),
  MAX_ACTIVE_JOBS: String(process.env.MAX_ACTIVE_JOBS || 2),
};

const child = spawn(process.execPath, [path.join(root, 'server.js')], {
  cwd: root,
  env: safeEnv,
  detached: true,
  stdio: ['ignore', out, out],
});
child.unref();
fs.writeFileSync(pidFile, String(child.pid));

console.log(`Hot100 Judge started safely (pid ${child.pid}).`);
console.log(`Open http://${safeEnv.HOST}:${safeEnv.PORT}`);
console.log(`Log: ${logFile}`);
console.log('Stop: npm run stop');
