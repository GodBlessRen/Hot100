'use strict';

(function initHot100Runtime(global) {
  const q = new URLSearchParams(location.search);
  const serverHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname) ||
    location.hostname.endsWith('.app.github.dev');
  const mode = q.get('runtime') === 'browser' ? 'browser' :
    q.get('runtime') === 'server' ? 'server' :
    serverHost ? 'server' : 'browser';

  const RUN_TIMEOUT = 4500;
  const READY_TIMEOUT = 90000;

  function normalize(text) {
    return String(text || '').replace(/\r\n/g, '\n').trimEnd();
  }

  function equalOutput(a, b) {
    const x = normalize(a);
    const y = normalize(b);
    if (x === y) return true;
    const ax = x.split('\n'), ay = y.split('\n');
    if (ax.length !== ay.length) return false;
    const num = s => /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s.trim());
    if (!ax.every(num) || !ay.every(num)) return false;
    return ax.every((v, i) => {
      const p = Number(v), q = Number(ay[i]);
      return Math.abs(p - q) <= 1e-6 * Math.max(1, Math.abs(p), Math.abs(q));
    });
  }

  function runtimeFailure(error) {
    const message = error && error.message ? error.message : String(error || '未知错误');
    return {
      ok: false,
      phase: 'runtime',
      stdout: '',
      stderr: message,
      error: message,
    };
  }

  class PythonWorker {
    constructor() {
      this.generation = 0;
      this.spawn();
    }

    spawn() {
      this.generation += 1;
      const generation = this.generation;
      if (this.worker) this.worker.terminate();

      for (const task of (this.pending || new Map()).values()) {
        clearTimeout(task.timer);
        task.resolve(runtimeFailure(new Error('Python Worker 已重启，请重新运行')));
      }
      this.pending = new Map();

      const workerUrl = new URL('./pyodide-worker.js', document.baseURI);
      this.worker = new Worker(workerUrl, { type: 'module', name: 'hot100-python' });

      this.ready = new Promise((resolve, reject) => {
        let settled = false;
        const finishReject = (error) => {
          if (settled || generation !== this.generation) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        };
        const finishResolve = () => {
          if (settled || generation !== this.generation) return;
          settled = true;
          clearTimeout(timer);
          resolve();
        };

        const timer = setTimeout(() => {
          finishReject(new Error('Python WebAssembly 运行时加载超时（90 秒）。请检查网络/CDN 后刷新页面。'));
        }, READY_TIMEOUT);

        this.worker.onmessage = event => {
          const msg = event.data || {};
          if (msg.kind === 'ready') {
            finishResolve();
            return;
          }
          if (msg.kind === 'fatal') {
            const detail = [msg.error, msg.stack].filter(Boolean).join('\n');
            finishReject(new Error(detail || 'Pyodide 加载失败'));
            return;
          }
          if (msg.kind === 'result') {
            const task = this.pending.get(msg.id);
            if (!task) return;
            clearTimeout(task.timer);
            this.pending.delete(msg.id);
            task.resolve(msg.result);
          }
        };

        this.worker.onerror = event => {
          const where = event.filename
            ? ` @ ${event.filename}:${event.lineno || 0}:${event.colno || 0}`
            : '';
          const detail = event.message || (event.error && event.error.message) || '模块 Worker 无法启动';
          finishReject(new Error(`Python Worker 启动失败：${detail}${where}`));
        };

        this.worker.onmessageerror = () => {
          finishReject(new Error('Python Worker 消息解析失败'));
        };
      });
    }

    async call(action, code, input) {
      try {
        await this.ready;
      } catch (error) {
        return runtimeFailure(error);
      }

      const id = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      return new Promise(resolve => {
        const timer = setTimeout(() => {
          this.pending.delete(id);
          this.spawn();
          resolve({
            ok: false,
            phase: 'run',
            timedOut: true,
            stdout: '',
            stderr: '',
            error: '运行超时，Worker 已销毁并重建',
          });
        }, RUN_TIMEOUT);
        this.pending.set(id, { resolve, timer });
        this.worker.postMessage({ id, action, code, input: input || '' });
      });
    }
  }

  let py = null;
  function runner() {
    if (!py) py = new PythonWorker();
    return py;
  }

  async function serverRequest(action, payload) {
    const body = action === 'judge'
      ? { problemId: payload.problemId, mode: payload.mode, language: payload.language, code: payload.code }
      : payload;
    const res = await fetch('/api/' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  async function browserRequest(action, payload) {
    if (payload.language !== 'python3') {
      return { ok: false, phase: 'runtime', error: 'GitHub Pages 安全模式只在浏览器执行 Python；C/C++ 请使用完整 Judge / Codespaces。' };
    }
    if (action === 'check') return runner().call('check', payload.code, '');
    if (action === 'run') return runner().call('run', payload.code, payload.input || '');
    if (action !== 'judge') return { ok: false, phase: 'runtime', error: '未知操作' };

    if (payload.mode !== 'acm') {
      return { ok: false, phase: 'runtime', error: '浏览器安全模式当前只执行 Python ACM；核心代码模式请使用完整 Judge / Codespaces。' };
    }

    const cases = (payload.tests && payload.tests.acm) || [];
    if (!cases.length) return { ok: false, phase: 'runtime', error: '该题暂无 ACM 测试用例' };

    const results = [];
    for (let i = 0; i < cases.length; i++) {
      const t = cases[i];
      const started = performance.now();
      const r = await runner().call('run', payload.code, t.input || '');
      const got = r.stdout || '';
      const ok = !!r.ok && !r.timedOut && equalOutput(t.output, got);
      results.push({
        index: i,
        input: t.input,
        expected: t.output,
        got,
        ok,
        ms: Math.round(performance.now() - started),
        timedOut: !!r.timedOut,
        error: ok ? '' : (r.error || r.stderr || (r.ok ? '输出不一致' : '运行失败')),
      });

      if (r.phase === 'runtime') {
        return { ...r, results, passed: 0, total: cases.length, allPassed: false };
      }
    }
    const passed = results.filter(x => x.ok).length;
    return { ok: true, passed, total: results.length, allPassed: passed === results.length, results };
  }

  global.Hot100Runtime = {
    mode,
    isBrowserMode: mode === 'browser',
    canExecute(language) { return mode === 'server' || language === 'python3'; },
    request(action, payload) {
      return mode === 'browser' ? browserRequest(action, payload) : serverRequest(action, payload);
    },
    warmup() {
      if (mode === 'browser') runner().ready.catch(() => {});
    },
    resetPython() {
      if (py) py.spawn();
    },
  };
})(window);
