# Solid PostgreSQL 数据管理工具

一个基于 **SolidJS + Bun + PostgreSQL** 构建的轻量级数据库管理工具，支持 SQL 查询执行和表格数据的可视化编辑。

## ✨ 功能特性

- 🔌 **数据库连接** - 支持自定义 PostgreSQL 连接参数
- 📝 **SQL 查询** - 执行任意 SQL 语句并以表格形式展示结果
- ✏️ **可视化编辑** - 双击单元格直接编辑数据，自动生成 UPDATE SQL
- 📊 **智能列识别** - 自动检测可编辑列和主键/唯一键约束
- 🔄 **变更管理** - 预览待保存的 SQL 修改，支持撤销单条修改
- 📏 **列宽调整** - 拖拽调整列宽和表格总宽度
- ⚡ **热更新开发** - 基于 Bun 的热更新开发体验

## 🛠️ 技术栈

| 类别     | 技术                                                    |
| -------- | ------------------------------------------------------- |
| 前端     | [SolidJS](https://www.solidjs.com/) + TypeScript           |
| 后端     | [Bun](https://bun.sh/) 原生 HTTP 服务器                    |
| 数据库   | [PostgreSQL](https://www.postgresql.org/) (via `pg` 库)  |
| 构建工具 | [Vite](https://vitejs.dev/) + vite-plugin-solid            |
| 路由     | [@solidjs/router](https://github.com/solidjs/solid-router) |
| 容器化   | Docker Compose                                          |

## 📦 项目结构

```
solid-project/
├── frontend/                 # 前端源码
│   ├── index.tsx            # 应用入口与路由配置
│   ├── app.tsx              # 主应用组件
│   ├── login.tsx            # 数据库选择页面
│   ├── postgres.tsx         # PostgreSQL 连接表单
│   ├── query-interface.tsx  # SQL 查询与结果展示界面
│   └── editable-cell.tsx    # 可编辑单元格组件
├── backend/                  # 后端源码
│   ├── connect-postgres.ts  # PostgreSQL 连接逻辑
│   └── column-editable.ts   # 列可编辑性判断逻辑
├── server.ts                # Bun HTTP 服务器入口
├── dev.ts                   # 开发环境启动脚本
├── docker-compose.yml       # PostgreSQL Docker 配置
├── vite.config.ts           # Vite 构建配置
├── index.html               # HTML 入口文件
└── package.json             # 项目依赖配置
```

## 🚀 快速开始

### 前置条件

- [Bun](https://bun.sh/) v1.0+
- [Docker](https://www.docker.com/) (可选，用于本地数据库)

### 安装依赖

```bash
bun install
```

### 启动开发环境

**方式一：一键启动（推荐）**

此命令会同时启动 Docker PostgreSQL 数据库和开发服务器：

```bash
bun run dev.ts
```

**方式二：分步启动**

1. 启动 PostgreSQL 数据库（如果使用本地 Docker）：

```bash
docker compose up -d
```

2. 启动开发服务器：

```bash
bun run --hot server.ts
```

### 访问应用

浏览器打开 [http://localhost:3000](http://localhost:3000)

### 默认数据库配置

使用 Docker Compose 启动的 PostgreSQL 默认配置如下：

| 参数     | 值        |
| -------- | --------- |
| Host     | localhost |
| Port     | 5432      |
| Database | mydb      |
| Username | postgres  |
| Password | secret    |

## 📖 使用说明

### 1. 连接数据库

1. 打开应用首页
2. 点击 "postgres" 链接进入连接页面
3. 填写数据库连接参数
4. 点击 "连接" 按钮

### 2. 执行 SQL 查询

1. 在文本框中输入 SQL 语句
2. 点击 "执行" 按钮
3. 查看表格形式的查询结果

### 3. 编辑数据

1. **双击** 可编辑的单元格进入编辑模式
2. 修改数据后按 **Enter** 保存，按 **Esc** 取消
3. 修改后的单元格会显示黄色背景
4. 点击 "查看修改" 可预览待执行的 UPDATE SQL
5. 点击 "保存修改" 执行所有变更
6. 可点击单条 SQL 旁的 "删除" 按钮撤销修改

### 4. 调整列宽

- 拖动列头右侧边缘调整单列宽度
- 拖动表格右侧边缘调整整体宽度

## 🔧 API 接口

| 方法 | 路径                      | 说明           |
| ---- | ------------------------- | -------------- |
| POST | `/api/connect-postgres` | 建立数据库连接 |
| POST | `/api/postgres/query`   | 执行 SQL 查询  |
| GET  | `/api/hello`            | 健康检查接口   |

## 📝 开发相关

### 运行测试

```bash
bun test
```

### 构建生产版本

```bash
bun run build.ts
```

## 📄 License

MIT
