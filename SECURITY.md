# Security model

## GitHub Pages / Safe Web

- 静态托管，没有公网 Node Judge API。
- Python ACM 在 Pyodide(WebAssembly) + Web Worker 中运行。
- Worker 无 DOM 权限。
- Pyodide 加载完成后关闭 Worker 网络 API。
- 每次执行有超时，超时销毁并重建 Worker。
- stdout/stderr 限制 64 KiB。
- C/C++ 以及核心代码模式建议使用 Private Codespaces。

## Codespaces / local Full Judge

- 默认绑定 127.0.0.1。
- API 仅 POST + application/json + same-origin。
- 并发 Judge 数有限制。
- 子进程环境变量使用 allow-list，不继承 GITHUB_TOKEN / API Key。
- CPU、虚拟内存、文件大小、进程数、FD、输出均有限制。
- 超时/输出超限会杀整个进程组。
- 临时目录执行结束后清理。
- Codespaces 转发端口应保持 Private。

## Boundary

Full Judge **不是 hardened multi-tenant online judge**。资源限制不等于 kernel sandbox。

推荐顺序：

1. GitHub Pages Safe Web：Python ACM。
2. Private GitHub Codespace：C/C++ 或完整 Judge。
3. 本地模式：仅运行自己信任的代码。
4. 不要把 /api/run、/api/check、/api/judge 暴露到公网。

本仓库基于 Hubert-hwk/hot100-judge 的 MIT License 改造。
