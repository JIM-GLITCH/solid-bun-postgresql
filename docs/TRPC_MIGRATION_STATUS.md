# tRPC 迁移状态报告

## 概述

项目已成功将前后端接口从 JSON-RPC 迁移到 tRPC，实现了以下目标：

✅ **后端使用 tRPC 作为唯一 API 定义源**  
✅ **前端通过 tRPC client 调用后端**  
✅ **两种传输层实现：Web (HTTP) 和 VSCode (vscode-messenger)**  
✅ **完全的类型安全**  

---

## 架构设计

### 核心原则

1. **tRPC router 为唯一 API 定义源**：所有 API 方法定义在 `backend/trpc/server.ts` 中
2. **vscode-messenger 作为纯传输层**：只负责消息传输，不涉及业务逻辑
3. **统一的多环境支持**：Web/VSCode/Electrobun 使用不同传输层，但共享相同的 API 定义

### 目录结构

```
backend/trpc/
├── server.ts              # tRPC router 定义（唯一 API 定义源）
└── http-adapter.ts        # Web 环境的 HTTP 适配器

frontend/trpc/
├── client.ts              # tRPC client 工厂（自动环境检测）
├── vscode-messenger-link.ts  # VSCode 环境的 messenger 传输层
├── example.ts             # 使用示例
├── test.ts                # 单元测试
└── test-integration.ts    # 集成测试

shared/src/
└── trpc-types.ts          # 共享类型定义

backend/
└── api-handlers-vscode.ts # VSCode 环境的 tRPC handler

vscode-extension/src/
└── extension.ts           # VSCode 扩展入口（注册 messenger）
```

---

## 实现细节

### 1. 后端 tRPC Router

**文件**: `backend/trpc/server.ts`

- 使用 `@trpc/server` 的 `initTRPC` 初始化
- 集成现有的 Effect 框架处理器
- 支持运行时切换（Web 和 VSCode 使用不同的运行时）
- 包含所有数据库、连接、AI、订阅等 API

**关键 API 组**:
- `db.*` - 数据库操作（连接、查询、DDL 等）
- `connections.*` - 连接管理
- `ai.*` - AI 功能
- `vscode.*` - VSCode 特定功能
- `queryHistory.*` - 查询历史
- `subscription.*` - 订阅功能

### 2. Web 传输层（HTTP）

**文件**: `backend/trpc/http-adapter.ts`

```typescript
export function trpcMiddleware() {
  return (c: any) =>
    fetchRequestHandler({
      endpoint: '/api/trpc',
      req: c.req.raw,
      router: appRouter,
      createContext: () => ({}),
    });
}
```

**集成位置**: `standalone/server-node.ts`

```typescript
app.all('/api/trpc', trpcMiddleware());
```

### 3. VSCode 传输层（vscode-messenger）

#### 前端 Link

**文件**: `frontend/trpc/vscode-messenger-link.ts`

- 实现 tRPC 自定义 link
- 使用 `vscode-messenger-webview` 的全局单例
- 通过 `messenger.sendRequest({ method: 'trpc' }, { path, input })` 发送请求
- 返回 Observable 供 tRPC 消费

#### 后端 Handler

**文件**: `backend/api-handlers-vscode.ts`

```typescript
export function registerTrpcHandler(
  messenger: Messenger,
  options: VscodeMessengerOptions = {}
) {
  messenger.onRequest({ method: 'trpc' }, async (params: { path: string; input: any }) => {
    // 使用 tRPC 的 fetchRequestHandler 处理请求
    const response = await fetchRequestHandler({
      endpoint: '/api/trpc',
      req: request,
      router: appRouter,
      createContext: () => ({}),
    });
    return result[0]; // 返回 tRPC batch 结果的第一项
  });
}
```

#### VSCode Extension 注册

**文件**: `vscode-extension/src/extension.ts`

```typescript
// 1. 在 activate 中注册全局 tRPC handler
const messenger = new Messenger();
registerTrpcHandler(messenger, {
  assertLicensed,
  shouldAssertLicensed: (method) => method === 'subscription/assert',
});

// 2. 为每个 webview panel 注册到 messenger
async function openDbPlayerWebview(context, deps) {
  const panel = vscode.window.createWebviewPanel(...);
  
  // ⭐ 关键：将 webview panel 注册到 messenger
  messenger.registerWebviewPanel(panel);
}
```

### 4. 前端 Client

**文件**: `frontend/trpc/client.ts`

- 自动检测运行环境（VSCode / Web / Electrobun）
- 根据环境选择合适的传输层
- 提供单例 `getTrpcClient()` 和工厂 `createTrpcClient()`

**环境检测逻辑**:

```typescript
function detectEnvironment(): TrpcClientEnvironment {
  // 检测 VSCode 环境
  if (typeof window !== 'undefined' && getVsCodeWebviewApi()) {
    return 'vscode';
  }
  
  // 检测 Electrobun 环境
  if (typeof window !== 'undefined' && (window as any).__electrobunApiRequest) {
    return 'electrobun';
  }
  
  // 默认为 Web 环境
  return 'web';
}
```

### 5. 前端入口初始化

#### Web 环境
**文件**: `frontend/index.tsx`

```typescript
createTrpcClient({
  environment: 'web',
  httpOptions: {
    baseUrl: '',
    getBearerToken: getBrowserJwt,
  },
});
```

#### VSCode 环境
**文件**: `frontend/index-webview.tsx`

```typescript
createTrpcClient({
  environment: 'vscode',
});
```

---

## 关键优势

### 1. 完全的类型安全

```typescript
// ✅ TypeScript 自动推断输入和输出类型
const trpc = getTrpcClient();

const result = await trpc.db.connect.mutate({
  connectionId: 'test',
  dbType: 'postgres',  // 类型检查：只能是 'postgres' | 'mysql' | 'mariadb' | 'sqlserver'
  host: 'localhost',
  port: '5432',
  database: 'mydb',
  username: 'user',
  password: 'pass',
});

// result 类型自动推断为: { success: boolean; error?: string; dbType?: string }
if (result.success) {
  console.log('Connected to:', result.dbType);
}
```

### 2. 自动补全

IDE 会提供完整的 API 方法自动补全：
- `trpc.db.` → 所有数据库方法
- `trpc.connections.` → 所有连接管理方法
- `trpc.ai.` → 所有 AI 相关方法

### 3. 单一 API 定义源

不需要在多个地方重复定义 API：
- ❌ 旧方式：在后端定义 handler + 在前端定义类型 + 在传输层定义消息格式
- ✅ 新方式：在 `backend/trpc/server.ts` 中定义一次，类型自动传播到前端

### 4. vscode-messenger 职责清晰

- **旧方式**：每个 API 都需要单独注册 `messenger.onRequest('api-name', handler)`
- **新方式**：只注册一个统一的 `trpc` handler，所有请求都通过它处理

### 5. 多环境统一

同一套 API 定义，自动适配不同环境：
- Web: 使用 HTTP + fetch
- VSCode: 使用 vscode-messenger + postMessage
- Electrobun: 使用 HTTP + fetch（可扩展为自定义 IPC）

---

## 使用方式

### 基本用法

```typescript
import { getTrpcClient } from './trpc/client';

const trpc = getTrpcClient();

// 查询操作（GET）
const connections = await trpc.connections.list.query();
const capabilities = await trpc.db.capabilities.query({
  connectionId: 'my-conn',
  dbType: 'postgres',
});

// 修改操作（POST）
const connectResult = await trpc.db.connect.mutate({
  connectionId: 'my-conn',
  dbType: 'postgres',
  host: 'localhost',
  port: '5432',
  database: 'mydb',
  username: 'user',
  password: 'pass',
});

const saveResult = await trpc.connections.save.mutate({
  id: 'conn-1',
  name: 'My Connection',
  host: 'localhost',
  port: '5432',
  database: 'mydb',
  username: 'user',
  password: 'pass',
});
```

### 指定环境

```typescript
import { createTrpcClient } from './trpc/client';

// Web 环境
const webClient = createTrpcClient({
  environment: 'web',
  httpOptions: {
    baseUrl: 'https://api.example.com',
    getBearerToken: () => localStorage.getItem('token'),
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

---

## 测试

### 单元测试
**文件**: `frontend/trpc/test.ts`

### 集成测试
**文件**: `frontend/trpc/test-integration.ts`

运行集成测试：
```typescript
// 在浏览器控制台中
window.__runTrpcTests()
```

---

## 迁移指南

### 旧代码（使用 frontend/api.ts）

```typescript
import { connectPostgres, disconnectPostgres } from './api';

const result = await connectPostgres(connectionId, params, dbType);
await disconnectPostgres(connectionId);
```

### 新代码（使用 tRPC）

```typescript
import { getTrpcClient } from './trpc/client';

const trpc = getTrpcClient();

const result = await trpc.db.connect.mutate({
  connectionId,
  ...params,
  dbType,
});

await trpc.db.disconnect.mutate({
  connectionId,
  dbType,
});
```

---

## 依赖版本

```json
{
  "@trpc/client": "^11.13.0",
  "@trpc/server": "^11.13.0",
  "vscode-messenger": "^0.7.0",
  "vscode-messenger-webview": "^0.7.0",
  "zod": "^4.6.5"
}
```

---

## 注意事项

### 1. vscode-messenger 单例

前端和后端都只有一个全局的 messenger 实例：

**前端**: `frontend/trpc/vscode-messenger-link.ts`
```typescript
let messengerSingleton: Messenger | null = null;
```

**后端**: `vscode-extension/src/extension.ts`
```typescript
const messenger = new Messenger(); // 文件顶层
```

### 2. Webview Panel 注册

每个 webview panel 都必须注册到 messenger：
```typescript
messenger.registerWebviewPanel(panel);
```

### 3. 订阅功能保留

SSE 订阅功能暂时保留使用旧的 transport 系统（`getTransport()`）

---

## 下一步计划

1. ✅ 完成核心 tRPC 迁移
2. ✅ Web 和 VSCode 两种传输层
3. ✅ 类型安全验证
4. ⬜ 逐步迁移所有 API 调用到 tRPC
5. ⬜ 移除旧的 JSON-RPC 相关代码
6. ⬜ 添加更多集成测试
7. ⬜ 性能优化和监控

---

## 故障排查

### VSCode 环境不工作

**检查清单**：
1. ✅ `vscode-messenger-webview` 已安装
2. ✅ Extension 中创建了全局 Messenger 实例
3. ✅ 调用了 `registerTrpcHandler(messenger, options)`
4. ✅ Webview panel 已注册：`messenger.registerWebviewPanel(panel)`
5. ✅ 前端使用了正确的环境：`createTrpcClient({ environment: 'vscode' })`

**调试日志**：
```typescript
// 前端
console.log('[frontend] Sending tRPC request:', path, input);

// 后端
console.log('[backend] Received tRPC request:', params);
console.log('[backend] tRPC response:', result);
```

### Web 环境不工作

**检查清单**：
1. ✅ 后端服务器正在运行
2. ✅ tRPC 路由已注册：`app.all('/api/trpc', trpcMiddleware())`
3. ✅ tRPC 路由在 `/api/*` 通配符之前注册
4. ✅ CORS 设置正确（如果跨域）

### 类型错误

**检查清单**：
1. ✅ 前后端使用相同版本的共享类型
2. ✅ TypeScript 配置正确
3. ✅ 重新构建项目：`pnpm install && pnpm build`

---

## 总结

✅ **架构清晰**：tRPC 为唯一 API 定义源，vscode-messenger 作为纯传输层  
✅ **类型安全**：完全的端到端类型安全  
✅ **多环境支持**：Web/VSCode/Electrobun 统一 API  
✅ **易于维护**：单一 API 定义，自动类型传播  
✅ **渐进式迁移**：新旧 API 可以共存  

迁移成功！🎉
