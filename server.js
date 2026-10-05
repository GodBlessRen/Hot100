'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { checkCode, runCode } = require('./judge/runner');
const { judgeACM, judgeCore, summarize } = require('./judge/judge');

const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';
const MAX_ACTIVE_JOBS = Number(process.env.MAX_ACTIVE_JOBS || 2);
let activeJobs = 0;
const ROOT = path.join(__dirname, 'public');
const MAX_BODY = 512 * 1024;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/** 读取数据文件（problems / tests / solutions），带内存缓存。 */
const dataCache = new Map();
function loadData(name) {
  if (dataCache.has(name)) return dataCache.get(name);
  const file = path.join(ROOT, 'data', `${name}.json`);
  let parsed = {};
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    parsed = {};
  }
  dataCache.set(name, parsed);
  return parsed;
}
function invalidateData() {
  dataCache.clear();
}

function securityHeaders(contentType) {
  return {
    'content-type': contentType,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'cross-origin-resource-policy': 'same-origin',
  };
}

function sendJson(res, status, data) {
  res.writeHead(status, securityHeaders('application/json; charset=utf-8'));
  res.end(JSON.stringify(data));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch (_) { return false; }
}

function isComputeApi(url) {
  return url === '/api/check' || url === '/api/run' || url === '/api/judge';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (e) {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(ROOT, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      ...securityHeaders(mime[path.extname(filePath)] || 'application/octet-stream'),
      'cache-control': pathname.startsWith('/vendor/') ? 'public, max-age=86400' : 'no-cache',
      'content-security-policy': "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'; form-action 'none'",
    });
    res.end(data);
  });
}

async function handleApi(req, res, body) {
  const { url } = req;
  if (url === '/api/check') {
    const payload = JSON.parse(body || '{}');
    if (typeof payload.code !== 'string') return sendJson(res, 400, { ok: false, error: '参数错误' });
    const result = await checkCode({ language: payload.language, code: payload.code, mode: payload.mode || 'acm' });
    return sendJson(res, 200, result);
  }

  if (url === '/api/run') {
    const payload = JSON.parse(body || '{}');
    if (typeof payload.code !== 'string' || typeof payload.input !== 'string') {
      return sendJson(res, 400, { ok: false, error: '参数错误' });
    }
    const result = await runCode({ language: payload.language, code: payload.code, input: payload.input });
    return sendJson(res, 200, result);
  }

  if (url === '/api/judge') {
    const payload = JSON.parse(body || '{}');
    const { problemId, mode, language, code } = payload;
    if (typeof code !== 'string' || !problemId || !mode) return sendJson(res, 400, { ok: false, error: '参数错误' });

    const problems = loadData('problems');
    const tests = loadData('tests');
    const problem = (Array.isArray(problems) ? problems : []).find((p) => p && p.id === Number(problemId));
    if (!problem) return sendJson(res, 404, { ok: false, error: '题目不存在' });

    if (mode === 'core') {
      const core = problem.core;
      if (!core || !core.kind) return sendJson(res, 400, { ok: false, error: '该题目暂无核心代码模式数据' });
      if (language !== 'python3' && language !== 'cpp') {
        return sendJson(res, 400, { ok: false, error: '核心代码模式仅支持 Python3 与 C++' });
      }
      const caseList = (tests[problemId] && tests[problemId].core) || [];
      if (!caseList.length) return sendJson(res, 400, { ok: false, error: '该题目暂无核心代码测试用例' });
      const outcome = await judgeCore({ language, code, core, tests: caseList });
      if (outcome.error) {
        return sendJson(res, 200, { ok: false, phase: outcome.phase || 'run', error: outcome.error, compileError: outcome.compileError });
      }
      const summary = summarize(outcome.results, mode);
      return sendJson(res, 200, { ok: true, ...summary, results: outcome.results });
    }

    // acm
    const caseList = (tests[problemId] && tests[problemId].acm) || [];
    if (!caseList.length) return sendJson(res, 400, { ok: false, error: '该题目暂无 ACM 测试用例' });
    const outcome = await judgeACM({ language, code, tests: caseList });
    if (outcome.error) {
      return sendJson(res, 200, { ok: false, phase: outcome.phase || 'run', error: outcome.error });
    }
    const summary = summarize(outcome.results, mode);
    return sendJson(res, 200, { ok: true, ...summary, results: outcome.results });
  }

  if (url === '/api/reload') {
    invalidateData();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { ok: false, error: '接口不存在' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (url.startsWith('/api/')) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'API 仅接受 POST 请求' });
    if (!sameOrigin(req)) return sendJson(res, 403, { ok: false, error: '跨站请求已拒绝' });
    const contentType = String(req.headers['content-type'] || '').toLowerCase();
    if (!contentType.startsWith('application/json')) return sendJson(res, 415, { ok: false, error: 'Content-Type 必须为 application/json' });
    if (isComputeApi(url) && activeJobs >= MAX_ACTIVE_JOBS) return sendJson(res, 429, { ok: false, error: '评测器正忙，请稍后重试' });
    let counted = false;
    try {
      if (isComputeApi(url)) { activeJobs++; counted = true; }
      const raw = await readBody(req);
      await handleApi({ ...req, url }, res, raw);
    } catch (error) {
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: error.message });
    } finally {
      if (counted) activeJobs = Math.max(0, activeJobs - 1);
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, securityHeaders('text/plain; charset=utf-8'));
    res.end('Method not allowed');
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`Hot100 Judge running at http://${HOST}:${PORT}`);
  console.log('Security: keep this port private; use GitHub Pages or a private Codespace for browser access.');
});
