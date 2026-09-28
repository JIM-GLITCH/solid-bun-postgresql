# tRPC 迁移指南

## 概述

我们已经成功将 tRPC 集成到项目中，提供了更好的类型安全性和开发体验。这个指南帮助你理解和使用新的 tRPC 系统。

## 新架构设计

### 核心原则

1. **tRPC router 为唯一 API 定义源**: 所有 API 方法定义在 `shared/src/trpc/router.ts` 中
2. **vscode-messenger 作为纯传输层**: 不涉及具体业务逻辑，只负责数据传输
3. **统一的多环境支持**: Web/VSCode/Electrobun 使用不同的传输层，但共享相同的 API 定义

### 架构概览

```
shared/src/trpc/
└── router.ts                 # 唯一的 API 定义源（tRPC router）

frontend/trpc/
├── client.ts                # tRPC client 工厂（自动环境检测）
├── http-link.ts             # Web 环境的 HTTP 传输层
├── vscode-messenger-link.ts # VSCode 环境的 messenger 传输层
├── example.ts               # 使用示例
└── test.ts                  # 测试文件

backend/trpc/
├── server.ts                # tRPC 服务器实现（集成现有 Effect 框架）
└── http-adapter.ts          # HTTP 适配器（Web 环境）

backend/api-handlers-vscode.ts  # VSCode 环境的统一 tRPC handler
```

## 使用方式

### 前端使用

#### 1. 获取 tRPC Client

```typescript
import { getTrpcClient } from './trpc/client';

// 自动检测环境并创建 client
const trpc = getTrpcClient();
```

#### 2. 发起 API 调用（完全类型安全）

```typescript
// 数据库连接
const result = await trpc.db.connect.mutate({
  connectionId: 'my-connection',
  dbType: 'postgres',
  host: 'localhost',
  port: '5432',
  database: 'mydb',
  username: 'user',
  password: 'pass',
});

// 获取连接列表
const connections = await trpc.connections.list.query();

// 获取数据库能力
const capabilities = await trpc.db.capabilities.query({
  connectionId: 'my-connection',
  dbType: 'postgres',
});
```

#### 3. 指定环境

```typescript
import { createTrpcClient } from './trpc/client';

// Web 环境
const webClient = createTrpcClient({
  environment: 'web',
  httpOptions: {
    baseUrl: '',
    getBearerToken: () => localStorage.getItem('token') || null,
  },
});

// VSCode 环境
const vscodeClient = createTrpcClient({
  environment: 'vscode',
  vscodeOptions: {
    timeout: 60000,
  },
});
```

### 后端使用

#### 1. VSCode 环境

```typescript
import { Messenger } from 'vscode-messenger';
import { registerTrpcHandler } from '../backend/api-handlers-vscode';

// 创建 messenger 实例
const messenger = new Messenger();
messenger.registerWebviewPanel(webviewPanel);

// 注册统一的 tRPC handler（只有一个 handler 处理所有请求）
registerTrpcHandler(messenger, {
  assertLicensed: async () => {
    // 订阅校验逻辑
  },
  shouldAssertLicensed: (method) => method === 'subscription/assert',
});
```

#### 2. Web 环境

tRPC 路由已自动集成到 Hono 服务器中：

```typescript
import { trpcMiddleware } from '../backend/trpc/http-adapter';

// 在 server-node.ts 中已添加
app.all("/api/trpc/*", trpcMiddleware());
```

## 关键变化

### 1. 移除了 vscode-messenger 的业务逻辑

**旧方式**:
```typescript
// 为每个 API 方法注册单独的 handler
messenger.onRequest('db/connect', handler1);
messenger.onRequest('db/disconnect', handler2);
// ... 每个方法都需要单独注册
```

**新方式**:
```typescript
// 只注册一个统一的 tRPC handler
messenger.onRequest('trpc', unifiedHandler);
// 所有 tRPC 请求都通过这个 handler 处理
```

### 2. vscode-messenger 作为纯传输层

**前端**:
```typescript
// vscode-messenger-link.ts
const promise = messenger.sendRequest('trpc', {
  path: tprocPath,  // tRPC 路径
  input: op.input, // tRPC 输入
});
```

**后端**:
```typescript
// api-handlers-vscode.ts
messenger.onRequest('trpc', async (params: { path: string; input: any }) => {
  const { path, input } = params;
  // 使用 tRPC 的 fetch handler 处理请求
  const response = await fetchRequestHandler({
    endpoint: '/api/trpc',
    req: request,
    router: appRouter,
    createContext: () => ({}),
  });
  return result;
});
```

## 渐进式迁移

### 旧 API 方式（仍然可用）

```typescript
import { connectPostgres } from './api';

const result = await connectPostgres(connectionId, params, dbType);
```

### 新 tRPC 方式（推荐）

```typescript
import { getTrpcClient } from './trpc/client';

const trpc = getTrpcClient();
const result = await trpc.db.connect.mutate({
  connectionId,
  ...params,
  dbType,
});
```

### 迁移建议

1. **新功能**: 直接使用 tRPC
2. **现有功能**: 逐步迁移，保持向后兼容
3. **测试**: 充分测试类型安全性和多环境支持

## 类型安全优势

### 1. 完全的类型推断

```typescript
// TypeScript 自动推断输入类型
const result = await trpc.db.connect.mutate({
  connectionId: 'test',      // ✅ 类型检查
  dbType: 'postgres',       // ✅ 类型检查
  host: 'localhost',        // ✅ 类型检查
  // port: 5432,            // ❌ 编译错误：应为 string
});

// TypeScript 自动推断返回类型
if (result.success) {
  console.log(result.dbType); // ✅ 类型安全
}
```

### 2. 自动补全

IDE 会提供完整的 API 自动补全：

- `trpc.db.` → 显示所有数据库相关方法
- `trpc.connections.` → 显示所有连接管理方法
- `trpc.ai.` → 显示所有 AI 相关方法

## 故障排除

### 1. VSCode 环境不工作

确保：
- `vscode-messenger-webview` 已安装
- Messenger 实例正确注册
- 统一的 tRPC handler 已注册

### 2. Web 环境不工作

确保：
- 后端服务器正在运行
- `/api/trpc/*` 路由正确配置
- CORS 设置正确

### 3. 类型错误

确保：
- 前后端使用相同版本的共享类型
- TypeScript 配置正确
- 重新构建项目

## 下一步

1. **扩展 API**: 在 `shared/src/trpc/router.ts` 中添加更多 API
2. **完善类型**: 定义更精确的输入输出类型
3. **添加测试**: 扩展测试覆盖范围
4. **性能优化**: 监控和优化 tRPC 性能

## 总结

新的 tRPC 系统提供了：

- ✅ **tRPC 为唯一 API 定义源**: 简化架构，避免重复定义
- ✅ **vscode-messenger 作为纯传输层**: 关注点分离，职责清晰
- ✅ **完全的类型安全**: TypeScript 自动推断输入输出类型
- ✅ **更好的开发体验**: IDE 自动补全，减少错误
- ✅ **多环境支持**: Web/VSCode/Electrobun 统一 API 定义
- ✅ **渐进式迁移**: 新旧 API 可以共存

享受更好的类型安全性和开发体验！