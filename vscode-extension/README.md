# DB Player（VSCode 扩展）

在 VS Code 内以 Webview 形式运行的 PostgreSQL 客户端，与仓库中的 Standalone 版本共用同一套前端与后端逻辑。

## 功能

- 连接 PostgreSQL（host / port / database / 用户名 / 密码，密码经 RSA 加密后传输）
- SQL 查询与结果表格展示、流式加载
- 表格单元格可视化编辑、变更预览与保存
- 侧边栏 schema / 表 / 列 / 索引 / 外键浏览

## 要求

- VS Code `^1.109.0`
- 项目依赖在**仓库根目录**安装（见下方「开发」）

## 使用

1. 安装并启用本扩展（或从源码运行，见「开发」）。
2. 命令面板（`Ctrl+Shift+P` / `Cmd+Shift+P`）输入 **「Open DB Player」** 或 **「DB Player: Hello World」**。
3. 在打开的 Webview 中填写数据库连接信息并连接，即可执行 SQL 与编辑数据。

## 开发

依赖与构建均在**仓库根目录**完成，本目录仅保留扩展清单与源码。

```bash
# 在仓库根目录
bun install
bun run build-extension
```

- **调试扩展**：在 VS Code 中打开本仓库，按 **F5** 启动扩展开发主机，再执行命令「Open DB Player」。
- **查看 Webview 消息**：输出面板 → 下拉选择 **「DB Player」**，可看到 `[webview→ext]` 的请求日志（密码等已脱敏）。

## 目录说明

| 路径                 | 说明                                       |
| -------------------- | ------------------------------------------ |
| `src/extension.ts` | 扩展入口、Webview 创建与消息派发           |
| `src/index.html`   | Webview 的 HTML 模板                       |
| `build.ts`         | 构建脚本：打包前端与 extension 到 `out/` |
| `package.json`     | 扩展清单（无依赖，依赖在根 package.json）  |

## 与 Standalone 的关系

- 前端：同一套 Solid 应用，通过 `transport` 在 **HTTP（Standalone）** 与 **postMessage（本扩展）** 间切换。
- 后端：扩展侧使用 `backend/api-handlers-vscode` 接收 Webview 消息并调用 `api-core`，与 HTTP 版共用业务逻辑。
