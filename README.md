# Hot100

LeetCode Hot 100 刷题台：**GitHub Pages 安全网页版 + Private Codespaces 完整 Judge**。

- 安全网页版：https://godblessren.github.io/Hot100/
- 完整 Judge：https://codespaces.new/GodBlessRen/Hot100?quickstart=1

## 推荐使用方式

| 模式 | Python | C/C++ | 执行位置 |
|---|---:|---:|---|
| GitHub Pages Safe Web | ✅ ACM | — | 浏览器 Web Worker + Pyodide/WASM |
| Private Codespaces | ✅ | ✅ | GitHub 云端开发环境 |
| 本地 Full Judge | ✅ | ✅ | 你的机器，仅运行可信代码 |

**原则：能在浏览器执行，就不碰宿主机；必须 native 执行，就放进私有 Codespace。**

## 内容

- Hot 100 全量 100 题
- ACM + 核心代码双模式
- Python3 / C / C++
- 959 组测试用例
- 题解、复杂度、CodeTop 高频信息
- 进度/收藏存浏览器 LocalStorage

## 本地

```bash
npm start
```

打开 `http://127.0.0.1:5173`。

停止：

```bash
npm run stop
```

开发前台模式：

```bash
npm run dev
```

## GitHub Pages

仓库已包含 `.github/workflows/pages.yml`。首次需要在：

**Settings → Pages → Build and deployment → Source → GitHub Actions**

启用后，push 到 `main` 会自动发布 `public/`。

## Codespaces

仓库包含 `.devcontainer/`，会准备 Node / Python / GCC / G++ 并启动 Judge。

**不要把 5173 端口改成 Public。**

## Security

Full Judge 会编译/执行代码，因此不是面向陌生用户的 hardened multi-tenant online judge。

本 fork 的加固包括：

- 默认绑定 `127.0.0.1`
- same-origin + POST + JSON
- 并发限制
- 子进程环境变量 allow-list，不继承 GitHub Token/API Key
- CPU/内存/文件/进程/FD/输出限制
- 超时杀整个进程组
- CSP / nosniff / frame / referrer 安全头
- Codespaces 启动器清洗环境

详见 [SECURITY.md](SECURITY.md)。
