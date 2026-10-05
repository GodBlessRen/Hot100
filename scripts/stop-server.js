'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const pidFile = path.join(os.tmpdir(), 'hot100-judge-safe.pid');
let pid;
try { pid = Number(fs.readFileSync(pidFile, 'utf8').trim()); }
catch (_) { console.log('Hot100 Judge is not running.'); process.exit(0); }

try {
  process.kill(pid, 'SIGTERM');
  console.log(`Stopped Hot100 Judge (pid ${pid}).`);
} catch (error) {
  if (error.code !== 'ESRCH') throw error;
  console.log('Hot100 Judge was already stopped.');
}
try { fs.unlinkSync(pidFile); } catch (_) {}
