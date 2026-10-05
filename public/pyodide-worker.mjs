import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';

const MAX_OUTPUT = 64 * 1024;

function lockNetwork() {
  const deny = () => Promise.reject(new Error('Network disabled in Hot100 Safe Web runtime'));
  try { Object.defineProperty(globalThis, 'fetch', { value: deny, writable: false }); } catch (_) {}
  for (const name of ['XMLHttpRequest', 'WebSocket', 'EventSource', 'WebTransport']) {
    try {
      Object.defineProperty(globalThis, name, {
        value: class { constructor() { throw new Error('Network disabled in Hot100 Safe Web runtime'); } },
        writable: false,
      });
    } catch (_) {}
  }
}

const WRAPPER = [
  'import io, json, sys, traceback',
  'class _Cap(io.StringIO):',
  '    def __init__(self, n): super().__init__(); self.n=n; self.size=0',
  '    def write(self, s):',
  '        s=str(s); self.size += len(s.encode("utf-8", errors="replace"))',
  '        if self.size > self.n: raise RuntimeError("OUTPUT_LIMIT")',
  '        return super().write(s)',
  '_in=io.StringIO(__h_input); _out=_Cap(__h_max); _err=_Cap(__h_max)',
  '_oi,_oo,_oe=sys.stdin,sys.stdout,sys.stderr',
  'sys.stdin,sys.stdout,sys.stderr=_in,_out,_err',
  '_ok=True; _error=""; _phase="run"',
  'try:',
  '    if __h_action == "check":',
  '        compile(__h_code, "<hot100>", "exec"); _phase="syntax"',
  '    else:',
  '        g={"__name__":"__main__","__file__":"<hot100>"}',
  '        exec(compile(__h_code, "<hot100>", "exec"), g, g)',
  'except SyntaxError as e:',
  '    _ok=False; _phase="syntax"; _error="".join(traceback.format_exception_only(type(e),e)).strip()',
  'except SystemExit as e:',
  '    if e.code not in (None,0): _ok=False; _error="SystemExit: %s" % e.code',
  'except BaseException as e:',
  '    _ok=False; _error="输出超出大小限制（64KB）" if str(e)=="OUTPUT_LIMIT" else "".join(traceback.format_exception(type(e),e,e.__traceback__)).strip()',
  'finally:',
  '    sys.stdin,sys.stdout,sys.stderr=_oi,_oo,_oe',
  'json.dumps({"ok":_ok,"phase":_phase,"stdout":_out.getvalue(),"stderr":_err.getvalue(),"error":_error}, ensure_ascii=False)',
].join('\n');

let pyodide;
try {
  pyodide = await loadPyodide();
  lockNetwork();
  self.postMessage({ kind: 'ready' });
} catch (error) {
  self.postMessage({ kind: 'fatal', error: String(error && error.message || error) });
}

self.onmessage = async event => {
  const { id, action, code, input = '' } = event.data || {};
  if (!id || !pyodide) return;
  try {
    pyodide.globals.set('__h_action', String(action || 'run'));
    pyodide.globals.set('__h_code', String(code || ''));
    pyodide.globals.set('__h_input', String(input || ''));
    pyodide.globals.set('__h_max', MAX_OUTPUT);
    const raw = await pyodide.runPythonAsync(WRAPPER);
    self.postMessage({ kind: 'result', id, result: JSON.parse(String(raw)) });
  } catch (error) {
    self.postMessage({ kind: 'result', id, result: { ok: false, phase: 'run', stdout: '', stderr: '', error: String(error && error.message || error) } });
  } finally {
    for (const key of ['__h_action','__h_code','__h_input','__h_max']) {
      try { pyodide.globals.delete(key); } catch (_) {}
    }
  }
};
