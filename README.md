# Solid 数据库管理工具

一个基于 **SolidJS + Bun** 构建的轻量级数据库管理工具，支持 **PostgreSQL** 与 **MySQL** 连接、SQL 查询执行和表格数据的可视化编辑。

## ✨ 功能特性

- 🔌 **数据库连接** - PostgreSQL / MySQL，连接参数与 `dbType` 约定见 `shared/src/types.ts`
- 📝 **SQL 查询** - 执行任意 SQL 语句并以表格形式展示结果
- ✏️ **可视化编辑** - 双击单元格直接编辑数据，自动生成 UPDATE SQL
- 📊 **智能列识别** - 自动检测可编辑列和主键/唯一键约束
- 🔄 **变更管理** - 预览待保存的 SQL 修改，支持撤销单条修改
- 📏 **列宽调整** - 拖拽调整列宽和表格总宽度
- 🌐 **双运行模式** - 支持 **Standalone（Node + Hono）** 与 **VSCode 扩展**，同一套前端通过传输层切换
- ⚡ **热更新开发** - 基于 Vite 的前端 HMR 开发体验

## 🛠️ 技术栈

| 类别     | 技术                                                                 |
| -------- | -------------------------------------------------------------------- |
| 前端     | [SolidJS](https://www.solidjs.com/) + TypeScript                     |
| 后端     | [Hono](https://hono.dev/) + Node.js（Standalone 单可执行用 Node SEA） |
| 数据库   | [PostgreSQL](https://www.postgresql.org/)（`pg`）、[MySQL](https://www.mysql.com/)（`mysql2`） |
| 构建工具 | [Vite](https://vitejs.dev/) + vite-plugin-solid，Bun 用于打包          |
| 路由     | [@solidjs/router](https://github.com/solidjs/solid-router)           |
| 容器化   | Docker Compose                                                       |

## 📦 项目结构

```
solid-project/
├── frontend/                    # 前端源码
│   ├── api.ts                  # API 封装（连接、查询等）
│   ├── transport/              # 传输层：HTTP / VSCode postMessage
│   │   ├── http-transport.ts   # Web 环境：fetch + SSE
│   │   └── vscode-transport.ts # 扩展环境：postMessage
│   ├── connection-form.tsx   # 多库连接表单（dbType）
│   ├── query-interface.tsx     # SQL 查询与结果展示
│   └── ...
├── backend/                     # 后端业务逻辑（与传输无关）
│   ├── api-core.ts             # API 核心：handleApiRequest、session
│   ├── connect-postgres.ts     # PostgreSQL 会话
│   ├── connect-mysql.ts        # MySQL 会话
│   ├── api-handlers-http.ts    # 仅保留 keepalive 断开端点（Standalone）
│   └── ...
├── shared/src/                  # 前后端共享类型与 API 约定
│   ├── types.ts                # PostgresLoginParams、ConnectPostgresRequest 等
│   └── transport.ts            # ApiMethod、ApiRequestPayload、IApiTransport
├── standalone/                  # Standalone 构建与开发
│   ├── server-node.ts          # Node + Hono 服务（支持 SEA）
│   ├── build-sea-win.ts        # 前端 Bun 构建 + Node SEA 打包
│   ├── ARCHITECTURE.md         # 架构说明与 Bun→Node 变更记录
│   └── ...
├── vscode-extension/            # VSCode 扩展
│   └── src/extension.ts        # 扩展入口、Webview、消息日志（DB Player 输出）
├── docker-compose.yml
├── vite.config.ts
└── package.json
```

## 🚀 快速开始

### 前置条件

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/)（可选，用于本地数据库）

### 安装依赖

```bash
bun install
```

### 方式一：Standalone 开发（推荐）

同时启动 Docker PostgreSQL 与开发服务器：

```bash
bun run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

### 方式二：VSCode 扩展

1. 构建扩展与前端 webview：

```bash
bun run build-extension
```

2. 在 VS Code 中按 F5 启动扩展开发主机，运行命令 **「DB Player: Hello World」** 打开 Webview。
3. 调试 Webview 与扩展间消息：打开 **输出** 面板，选择 **「DB Player」** 通道，可看到 `[webview→ext]` 的请求日志（密码等已脱敏）。

### 默认数据库配置（Docker）

| 参数     | 值        |
| -------- | --------- |
| Host     | localhost |
| Port     | 5432      |
| Database | mydb      |
| Username | postgres  |
| Password | secret    |

## 📖 使用说明

### 1. 连接数据库

1. 打开应用首页，选择数据库类型并进入连接页。
2. 填写 host、port、database、username、password。
3. 点击「连接」建立数据库连接。

### 2. 执行 SQL 查询

1. 在文本框输入 SQL，点击「执行」。
2. 结果以表格展示，支持流式加载更多。

### 3. 编辑数据

1. **双击** 可编辑单元格进入编辑，Enter 保存，Esc 取消。
2. 修改后单元格高亮，点击「查看修改」预览 UPDATE SQL。
3. 点击「保存修改」执行变更，可对单条 SQL 撤销。

### 4. 调整列宽

- 拖动列头右侧边缘调整单列宽度。
- 拖动表格右侧边缘调整整体宽度。

## 🔧 API 接口（Standalone）

业务请求统一走 **tRPC**（`/api/trpc/*`）：前端 `trpc.db.*` / `trpc.connections.*` / `trpc.ai.*` 直达各 router。旧有的 `POST /api/db/${method}` HTTP RPC 分发与 `GET /api/events` SSE 已移除。

唯一保留的裸 HTTP 端点是 **tRPC 无法表达**的场景——页面卸载时的 keepalive 断开（普通请求会在关页时被浏览器取消，只有 keepalive fetch 能活到发送完成）：

| 方法 | 路径 | 说明 |
| ---- | ---- | ---- |
| POST | `/api/db/disconnect` | keepalive fetch 断开会话（见 `backend/api-handlers-http.ts`；响应无人消费，失败不重试） |

事件订阅改用 tRPC subscription **`db.onConnectionEvents`**（`/api/events` 的替代）：Web 端经 SSE 承载，VSCode / Electrobun 端经宿主 link 转发。

VSCode 扩展下，webview 内经 `vscode-messenger` 桥接：**业务 procedure 直达服务端 `appRouter`**，宿主专属 path（`host.*`）由扩展侧 override 实现。

**扩展第三方言**：连接层策略位于 `backend/db-handlers/strategies/*-strategy-effect.ts`（SQL 模板 / 连接器装配 / 监控诊断），设计背景见 [docs/db-connection-effect-refactor.md](docs/db-connection-effect-refactor.md)。**能力字段与侧栏/API 对照**：[docs/database-capabilities-matrix.md](docs/database-capabilities-matrix.md)。

## 📝 开发相关

### 运行测试

```bash
bun test
```

### 构建

- **Standalone 生产**：`bun run build:sea`（Node SEA 单可执行，需 Node 20+，25.5+ 推荐）
- **VSCode 扩展**：`bun run build-extension`

> Standalone 架构说明（Bun→Node 变更背景）见 [standalone/ARCHITECTURE.md](standalone/ARCHITECTURE.md)

## 📄 License

MIT
