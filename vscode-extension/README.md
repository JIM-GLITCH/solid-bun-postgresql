# DB Player - VSCode 扩展

一个直接在 VS Code 中运行的 PostgreSQL 数据库客户端，无需切换应用，在编辑器内完成数据库查询、数据编辑和 Schema 浏览。

### 设计理念：单 Webview，少打断

不少数据库类扩展会宣称「在 VS Code 里无缝浏览、编辑数据库」，但实际往往混合**原生侧栏、编辑器 Tab、独立 Webview 面板**等：窗口多、焦点在「侧栏 ↔ 编辑器 ↔ 浮层」之间来回切，**反而打断**原先写代码、看代码的主界面。

DB Player 选择把连接、Schema 浏览、SQL 编辑、结果与数据编辑**收进同一 Webview 视图**：进入后在一屏内走完主要工作流，**对 VS Code 主工作区的打断相对更小**（适合以「打开 DB Player 专注查库」为心智的用户）。若你更习惯只在普通 `.sql` 文件里随手改两行，也可按自己的工作区习惯选入口；本扩展侧重的是**单画布、少窗口**的一体化体验。

## 🎯 插件作用

DB Player 让你在 VS Code 工作区内实现完整的数据库操作流程：

### 核心功能
- **SQL 执行**：在编辑器集成的 SQL 编辑器中编写和执行查询，支持快捷键执行（Ctrl+Enter）
- **数据库浏览**：侧边栏展示 Schema、表、列、索引和外键关系，点击快速查询
- **结果展示**：表格化显示查询结果，支持流式加载大数据集，自动虚拟滚动
- **数据编辑**：直接在结果表格中编辑单元格，实时预览变更 SQL 语句，安全保存到数据库
- **连接管理**：保存常用数据库连接配置，快速切换连接

## 🚀 快速开始

### 1. 安装扩展
- 从 VS Code 扩展市场搜索并安装「DB Player」
- 或从源码运行开发版本（见[开发指南](#开发)）

### 2. 打开 DB Player
在命令面板中按下 `Ctrl+Shift+P`（Mac: `Cmd+Shift+P`），搜索并执行：
- **「Open DB Player」** 或
- **「DB Player: Hello World」**

### 3. 连接数据库
1. Webview 中点击「新建连接」或从已保存的连接列表选择
2. 填写 PostgreSQL 连接信息：
   - 主机地址（Host）
   - 端口（Port，默认 5432）
   - 数据库名称（Database）
   - 用户名和密码
3. 点击「连接」完成

### 4. 执行 SQL 和编辑数据
- 在 SQL 编辑器区域输入 SQL 语句，按 **Ctrl+Enter** 执行
- 查看结果表格，支持点击表名快速查询（侧边栏）
- 直接编辑表格单元格，查看生成的 UPDATE 语句
- 点击「保存」应用变更到数据库

## ⚙️ 系统要求

- **VS Code**：v1.109.0 或更新版本
- **运行环境**：Windows / macOS / Linux
- **依赖**：项目依赖需在仓库根目录安装（`bun install`）


## 💻 开发

### 环境设置
本扩展依赖在**仓库根目录**统一管理，先安装根目录依赖：

```bash
# 在仓库根目录执行
bun install
```

### 构建
```bash
bun run build-extension
```

这会执行 `vscode-extension/build.ts`，完成以下步骤：
1. 编译前端（Solid.js React 应用）→ `out/index-webview.js`
2. 复制 Monaco Editor 资源 → `out/vs/`
3. 编译 Extension Host Code → `out/extension.js`
4. 复制 HTML 模板 → `out/index.html`

### 调试
1. 用 VS Code 打开本仓库
2. 按 **F5** 启动「扩展开发主机」
3. 在新开的 VS Code 窗口中执行命令「Open DB Player」

### 查看日志
在 VS Code 的输出面板中，下拉菜单选择 **「DB Player」** 频道，可以看到：
- `[webview→ext]` 从前端发来的消息（JSON 日志）
- 连接信息、查询执行等调试信息
- **注意**：密码等敏感信息已自动脱敏（显示为 `<redacted>`）

## 📁 文件结构

```
vscode-extension/
├── src/
│   ├── extension.ts          # Extension Host 入口（Node.js 进程）
│   │                         # 职责：创建 Webview、处理后端 API 调用
│   ├── index.html            # Webview HTML 模板（带 {{}} 占位符）
│   │                         # 包含 Monaco Editor CSS、CSP 声明等
│   └── vsc-extension-quickstart.md
├── build.ts                  # 构建脚本（Bun）
├── package.json              # 扩展清单（无依赖，依赖在根目录）
└── README.md                 # 本文件
```

### 核心文件说明

#### `src/extension.ts`
- 运行在 **Extension Host**（Node.js 环境）
- 创建并管理 Webview 窗口
- 接收前端通过 `postMessage` 发送的 API 请求
- 调用 `backend/api-handlers-vscode` 处理请求，返回结果

#### `src/index.html`
- Webview 的 HTML 模板
- 包含必要的 CSP（内容安全策略）声明
- 显式加载 Monaco Editor CSS（关键！防止编辑器渲染错误）
- `{{CSP}}`、`{{SCRIPT_URI}}`、`{{MONACO_BASE_URI}}` 由 extension.ts 在运行时替换

#### `build.ts`
- 使用 Bun 完成构建流程
- 以 TSX 为入口编译前端
- 复制静态资源（Monaco 编辑器文件）
- 最终产物在 `out/` 目录可部署
## 🏗️ 架构概览

### 前后端通信流程

```
┌─────────────────────────────────────────────────────────┐
│ Webview (浏览器环境 - Solid.js)                          │
│ - 前端 UI 组件（SQL 编辑器、表格、侧边栏）              │
│ - VsCodeTransport（postMessage 通信客户端）            │
└────────────────────┬────────────────────────────────────┘
                     │ webview.postMessage({ ... })
                     │
┌────────────────────▼────────────────────────────────────┐
│ Extension Host (Node.js - TypeScript)                   │
│ - extension.ts 接收 postMessage                         │
│ - api-handlers-vscode 派发到业务逻辑层                  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│ 业务逻辑层 (共享 - backend/)                            │
│ - api-core: PostgreSQL 连接、SQL 执行、数据编辑        │
└─────────────────────────────────────────────────────────┘
```

### 代码共用策略

本扩展与仓库中的 **Standalone 版本** 共用：

| 部分 | 使用方式 |
|------|--------|
| **前端** | 同一套 Solid 应用，通过抽象的 `Transport` 接口在 HTTP 和 postMessage 间切换 |
| **后端业务逻辑** | `backend/api-core` 处理 PostgreSQL 操作，HTTP 和 postMessage 版本共用 |
| **API 处理** | `backend/api-core` 为共用逻辑，`api-handlers-http` / `api-handlers-vscode` 分别为 HTTP 与 VSCode 适配 |

这样设计保证了 Standalone 和 VSCode 两个版本功能一致，易于维护。

## 🔧 故障排查

### 编辑器渲染异常（显示黑框或光标位置错误）
**原因**：Monaco Editor CSS 未正确加载  
**解决**：确认 `src/index.html` 中有以下行，且 build.ts 正确复制了 `out/vs/` 目录
```html
<link rel="stylesheet" href="{{MONACO_BASE_URI}}/editor/editor.main.css" />
```

### Webview 无法连接数据库
**排查步骤**：
1. 打开 VS Code 输出面板，选择「DB Player」频道
2. 查看 `[webview→ext]` 的连接请求和错误消息
3. 检查 PostgreSQL 服务器是否运行，网络连接是否正常
4. 验证连接参数（主机、端口、用户名、数据库名）

### SQL 执行后无结果
- 检查 SQL 语法是否正确
- 查看输出面板是否有错误消息
- 尝试简单查询（如 `SELECT 1`）验证连接状态

## 📝 相关文档

- [Standalone 版本](../standalone/README.md)：独立应用版本
- [后端 API](../backend/)：PostgreSQL 连接和操作实现
