# 数据库连接层 Effect 重构 · 详细设计（方案 B）

> 目标：把「数据库连接处理」与「业务代码」在**模块边界**上完全隔离。
> 连接层用 Effect TS 实现（生命周期 / 重连 / keepalive / 流式资源 / 取消 / 错误分类），
> 业务 handler **保持现有 `switch` + async 风格不变**，只依赖一个 `DbConnector` 接口。
>
> 状态：设计已定，待实施。本文档为实施依据。
> 基线：`effect@4.0.2`（**已在 dependencies 且已安装，当前全仓库 0 处 import**）

---

## 0. 已实测验证的 Effect v4 关键事实

设计中的写法已在 `effect@4.0.2` 上跑过最小实验（临时文件已删除），以下是**实测结论**，不是记忆：

| # | 事实 | 影响 |
|---|---|---|
| 1 | `Context.Service` 在 v4 是**两段式泛型**：`class X extends Context.Service<X, Shape>()("X") {}` | 服务声明方式 |
| 2 | `Layer.effect(DbSessions, effect)` **自带 scope**，可直接 `yield* FiberMap.make()`；**不能再套 `Effect.scoped`**（会报 `Service not found: effect/Scope`） | 服务级 scope 来源 |
| 3 | 手动 `Scope.make()` 后，`Effect.acquireRelease` **不会**把 finalizer 注册进该 scope，手动 `Scope.close` **不会**触发 release（实测 `closed=false`）。必须 `Scope.provide(effect, scope)` | **每条连接一个可独立关闭的 scope 的唯一可行写法** |
| 4 | `Scope.provide(Effect.acquireRelease(...), scope)` + `Scope.close(scope, Exit)` ⇒ release 正确执行；release 内部可跑 `Effect.tryPromise`（异步 `pool.end()`、`.close()`） | 三条 teardown 路径成立 |
| 5 | `Effect.forkChild` 的 fiber 随 `runPromise` 结束被杀；跨多次 `runPromise` 存活的 keepalive 必须 `Effect.forkIn(fiber, serviceScope)` | keepalive 实现方式 |
| 6 | `FiberMap.set(map, key, fiber)` 收的是**已 fork 的 fiber**，不是 `Effect`（传 Effect 会 `fiber.addObserver is not a function`） | keepalive 登记方式 |
| 7 | `Scope.close` 后 `FiberMap` 条目按 key 移除；`disconnect` 幂等（第二次返回 `false`） | 幂等断开 |
| 8 | `Data.TaggedError<Tag>(tag)` 为 v4 错误构造方式；`Effect.retry` 支持 `{ schedule, times }` | 错误分类 / 重连 |
| 9 | `ManagedRuntime.make(layer)` → `runPromise(effect)`；`dispose()` 触发 layer 内 `acquireRelease` 的 release | 进程退出统一收口 |

---

## 1. 架构总览与模块边界

```
backend/db/                          ← 唯一允许 import 驱动（pg / mysql2 / mssql / ssh2）的区域
  contract.ts        纯接口与类型：DbConnector、ConnectionSpec、DbError、列/流元数据（零驱动 import）
  errors.ts          DbError 分类 + 死连接判定（替代正则嗅探）
  connector-pg.ts    PgConnector 实现（pg / pg-cursor / SSH 隧道）
  connector-mysql.ts MysqlConnector 实现（mysql2 / 协议层行流）
  connector-mssql.ts MssqlConnector 实现（mssql / TDS 流 / 事务）
  schema-context.ts  三方言的 AI Schema 上下文采集（从 api-core 搬入）
  sessions.ts        DbSessions 服务：注册表 + per-connection Scope + keepalive + 事件 PubSub
  layers.ts          Layer 组装（DbSessionsLive）
  runtime.ts         ManagedRuntime 单例 + Promise 门面（业务层唯一入口）
  legacy.ts          【迁移期】getSession / subscribeSessionEvents / SessionConnection 兼容适配器

backend/api-core.ts                  ← 瘦身：method → 业务分发（connections/history/ai/subscription）+ db 路由
backend/postgres-db-handlers.ts      ← 业务：只依赖 ctx.connector，零 session.* 直写
backend/mysql-db-handlers.ts         ← 同上
backend/sqlserver-db-handlers.ts     ← 同上
backend/session-connection.ts        ← 迁移期保留为「连接层内部表示」，外层逐步停用
transport (trpc / standalone / electrobun / vscode)  ← 完全不动
```

**边界不变量（可加 lint 规则强制）**

1. `backend/db/contract.ts` 之外，任何业务文件不得 `import` `pg` / `mysql2` / `mssql` / `pg-cursor` / `ssh2`（类型 import 也禁止）。
2. 业务 handler 不得出现 `userUsedClient` / `backGroundPool` / `dbForReconnect` / `cursor` / `sqlServerRowStream` / `mysqlRowStream` / `keepAliveTimer` / `closeTunnel`。
3. 业务层不得直接 `import { getDbConfig | createMysqlPool | openSqlServerPool }`；这些只允许出现在 `backend/db/connector-*.ts`。
4. `sendSSEMessage` 不再被连接层直接调用——连接层只 `PubSub.publish` 事件，传输语义归业务/传输层。

---

## 2. 类型设计

### 2.1 `contract.ts`（零驱动依赖）

```ts
/** 连接标识：现有语义是 `${storedId}-${sessionId}` */
export type ConnectionId = string;
export type DbKind = "postgres" | "mysql" | "mariadb" | "sqlserver";

export interface ConnectionSpec {
  connectionId: ConnectionId;
  dbKind: DbKind;
  login: PostgresLoginParams; // 复用 shared/src，含 ssh* 字段
}

/** 方言无关的查询结果：贴近现状，业务改动最小 */
export interface QueryResult<Row = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number;
  fields?: unknown;              // 原始字段元数据（方言私有的类型用 unknown 挡住）
}

export interface StreamPlan {
  /** 原始 SQL 或已拆分语句；传 statements 时连接层不再拆分 */
  sql?: string;
  statements?: string[];
  batchSize: number;
  defaultSchema?: string;
}

export interface StreamBatch {
  rows: unknown[][];
  hasMore: boolean;
  columns?: ColumnEditableInfo[];
  fields?: unknown;
}

export interface SessionInfo {
  connectionId: ConnectionId;
  dbKind: DbKind;
  /** mysql 家族当前选中的库（供 AI / 元数据使用） */
  currentDatabase?: string;
}

export interface DbConnector {
  readonly connectionId: ConnectionId;
  readonly dbKind: DbKind;
  readonly databaseCapabilities: DatabaseCapabilities;

  // —— 元数据通道：后台池（每请求 acquire/release）——
  //    与 queryAsUser 必须可并行；禁止用 withClient 实现本方法（会嵌套借还 → 自锁）
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>>;

  // —— 会话专用通道（轨道 B，已确认保留）——
  //    会话生命周期内独占一条连接，承担：Monaco 长查询 / 游标流式 / 取消时登记 pid|threadId。
  //    该连接**不从池按次借还**，因此池容量不需要为它预留；它正忙时其他请求走 query()。
  queryAsUser<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>>;

  // —— 需要真正「一个连接」的场景（DDL 事务、dump、会话级 SET）——
  withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;

  // —— 流式 ——
  stream(plan: StreamPlan): Promise<StreamBatch>;
  streamMore(opts: { batchSize: number; defaultSchema?: string }): Promise<StreamBatch>;
  teardownStream(): Promise<void>;

  // —— 生命周期 / 控制 ——
  cancelCurrentQuery(): Promise<{ cancelled: boolean; message?: string }>;
  /** 会话控制：cancel 当前语句 / terminate 连接（三方言内部映射 pid / threadId / request.cancel） */
  controlSession(target: number, action: "cancel" | "terminate"): Promise<{ success: boolean }>;
  sessionInfo(): Promise<SessionInfo>;

  // —— 事件：只发数据，不管传输 ——
  watch(): AsyncIterable<SSEMessage>;

  // —— AI schema 上下文（把 buildXMysqlSchemaContext 从 api-core 搬进连接层）——
  buildSchemaContext(schema?: string): Promise<{ context: string; injected: string[] }>;
}

/** 交给业务的连接句柄：只暴露 query / 状态，不暴露池 */
export interface DbClient {
  query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<QueryResult<Row>>;
  readonly database?: string;
  /** pg 的 processID / mysql 的 threadId，供 cancel 关联 */
  readonly nativeId?: number;
}
```

> **刻意不做的事**：不把 `pg.Pool` / `PoolConnection` / `mssql.ConnectionPool` 出现在接口上。
> 现状 `db/schema-dump`、`db/database-dump`、`db/execute-ddl`、`db/import-rows` 需要裸 client／事务，
> 用 `withClient(fn)` 覆盖，既满足需求又不泄漏池对象。

### 2.2 `errors.ts`（替代字符串正则嗅探）

```ts
export type DbErrorKind =
  | "connect-failed"      // 建连失败（含隧道）→ 可重试
  | "connection-lost"     // 连接断开 → 可重连
  | "query-failed"        // SQL 执行失败 → 不可重试
  | "cancelled"           // 被取消
  | "timeout"             // 超时 → 可重试
  | "no-session"          // 会话不存在 → 不可重试
  | "unsupported";        // 方言不支持

export class DbError extends Error {
  readonly kind: DbErrorKind;
  readonly dbKind?: DbKind;
  readonly cause?: unknown;
}
```

**必须行为等价**：`DbError.message` 保留现有原文（例如 `"SSH 隧道连接超时，请检查跳板机地址、端口及网络"`、`"未配置 AI API Key"`、`"当前 MySQL/MariaDB 连接尚不支持该操作（${method}）…"`），因为前端/tRPC 只是把它当字符串抛出。新增 `kind` 供连接层内部决策（是否重连）。

死连接判定（现 `isPgUserClientDeadError` 等三个函数）移入各 connector，作为 `isConnectionLost(e)` 实现，保留现有正则作为**兜底**，优先用类型判断（`pg` 的 `Connection terminated`、mysql2 的 `PROTOCOL_CONNECTION_LOST`）。

---

## 3. 会话生命周期设计（核心）

### 3.1 状态模型

```
ManagedRuntime
└── Layer.effect(DbSessions)            ← 服务级 scope（自带，勿再 Effect.scoped）
    ├── entries: Ref<Map<ConnectionId, Entry>>
    ├── keepalives: FiberMap<ConnectionId, void, never>
    └── events: Ref<Map<ConnectionId, PubSub<SSEMessage>>>

Entry = {
  spec: ConnectionSpec
  connector: DbConnector        // 方言实现
  scope: Scope.Closeable        // ★ 该连接独占的 scope
}
```

### 3.2 连接建立（已验证写法）

```ts
const openScoped = (spec: ConnectionSpec) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make("sequential");
    const connector = yield* Scope.provide(
      Effect.acquireRelease(
        openConnector(spec),                       // 方言建连（隧道 → 池 → 用户连接）
        (c) => Scope.provide(closeConnector(c), scope)  // 释放链放入同一 scope（事实 #4）
      ),
      scope
    );
    return { connector, scope };
  });
```

`closeConnector(c)` 内部**顺序保证与现状一致**（关键，不能反）：
PG：`userUsedClient.end()` → `backGroundPool.end()` → `closeTunnel()`
MySQL：`teardownStreaming()` → `userUsedClient.release()` → `backGroundPool.end()` → `closeTunnel()`
MSSQL：`teardownRowStream()` → `userUsedClient.close()` → `closeTunnel()`

> 现状注释已指出「必须先关 pg 连接再关隧道，否则 `server.close` 死锁」——释放链顺序必须回归验证。

### 3.3 keepalive（已验证写法）

```ts
const startKeepalive = (spec, connector) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkIn(          // ★ 必须 forkIn 服务级 scope（事实 #5）
      Effect.forever(
        Effect.gen(function* () {
          yield* Effect.sleep(KEEPALIVE_INTERVAL);       // 60s
          yield* connector.keepaliveProbe();              // SELECT 1
        }).pipe(
          Effect.catchTag("DbError", (e) =>
            e.kind === "connection-lost" || e.kind === "timeout"
              ? Effect.gen(function* () {
                  yield* sessions.reconnect(spec.connectionId);   // 统一重连
                  yield* connector.publish({ type: "INFO", message: "查询专用连接已自动重建", timestamp: Date.now() });
                })
              : Effect.void)
        )
      ),
      serviceScope
    );
    yield* FiberMap.set(keepalives, spec.connectionId, fiber);   // ★ 传已 fork 的 fiber（事实 #6）
  });
```

替代现状：`startUserClientKeepalive` / `startMysqlUserClientKeepalive`（后者只是别名，删除）
→ 保留**行为等价**：pg 在有 cursor 时跳过探测、mssql 在有 rowStream 时跳过（改写为 connector 内的 `keepaliveProbe` 自己判断并返回 `skipped`）。

### 3.4 重连（三份合一份）

```ts
reconnect(cid) = Effect.gen(function* () {
  const entry = yield* getEntry(cid);
  // 1) 中断旧 keepalive（FiberMap.remove 自动 interrupt）
  // 2) 打开新 scope + 新 connector（Effect.retry + Schedule.exponential 兜底）
  // 3) 原子替换 entries[cid]；关闭旧 scope（触发旧池释放）
  // 4) 重新启动 keepalive；PubSub 保持不变（订阅者不感知重连）
});
```

替代现状：`recreateUserUsedClient` / `recreateMysqlUserUsedClient` / `recreateSqlServerPool`（3 个函数，约 50 行）。

### 3.5 断开（统一收口）

```ts
disconnect(cid) = Effect.gen(function* () {
  const entry = yield* Ref.modify(entries, take(cid));   // 先摘除
  if (!entry) return false;                              // 幂等（事实 #7）
  yield* FiberMap.remove(keepalives, cid);               // 中断 keepalive
  yield* PubSub.shutdown?.(events);                      // 关闭事件通道 → 订阅者收到结束
  yield* Scope.close(entry.scope, Exit.void);            // ★ 所有资源在此释放，不可能漏
  return true;
});
```

替代现状：`disconnectConnection`（29 行、三分支手写 teardown）+ 三个 handler 里 `db/connect` 的旧连接清理（各 ~19 行、共 57 行重复代码）。

> **顺带修掉的行为缺陷**：现状先 `map.delete` 再异步 teardown，teardown 期间到达的请求会报「未找到数据库连接」；新设计 `Ref.modify` 原子摘除 + `Scope.close` 一次性释放，不再有中间态。

### 3.6 事件推送（解耦传输）

- 每条连接一个 `PubSub<SSEMessage>`（bounded，容量建议 256，`PubSub.publishing` 溢出策略 = `dropping`，与现状无界 `Set<fn>` 不同但更安全）。
- 连接层只 `PubSub.publish`（此前由 `attachPostgresClientHandlers` 直接调 `sendSSEMessage` 的位置）。
- 业务/传输层通过 `watch(cid)` 拿到 `AsyncIterable<SSEMessage>`，在 [backend/trpc/router/db.ts](backend/trpc/router/db.ts) 的 `onConnectionEvents` 里 `for await` 后 `emit.next`。
- **行为等价点**：现状 `subscribeSessionEvents` 会立刻推一条「事件订阅已建立」，这条现在由业务层（`db.ts`）负责发（它已经在发，见 db.ts:351），连接层不需要知道。

---

## 4. Promise 门面与集成（`runtime.ts`）

业务保持 async，因此连接层对外只暴露 Promise。**tRPC / Electrobun / VSCode 零改动**。

```ts
const layer = DbSessionsLive;                 // Layer<DbSessions>
const runtime = ManagedRuntime.make(layer);   // 模块级单例

export const connect    = (spec: ConnectionSpec) => runtime.runPromise(connectEff(spec));
export const disconnect = (cid: ConnectionId)   => runtime.runPromise(disconnectEff(cid));
export const getInfo    = (cid: ConnectionId)   => runtime.runPromise(getInfoEff(cid));     // SessionInfo | undefined
export const watch      = (cid: ConnectionId)   => watchEff(cid);                            // AsyncIterable<SSEMessage>
export const buildSchemaContext = (cid, schema?) => runtime.runPromise(buildSchemaContextEff(cid, schema));
export const disposeAll = () => runtime.dispose();        // 进程退出收口（事实 #9）
```

`withClient` 的桥接（避免 Promise 里出现 `Scope` 泛型）：

```ts
// connector 内部实现，业务侧签名干净
withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
  return runtime.runPromise(
    Effect.acquireUseRelease(
      acquireClient,                                   // pg.Pool.connect() / pool.getConnection()
      (c) => Effect.tryPromise({ try: () => fn(toDbClient(c)), catch: (e) => asDbError(e) }),
      (c, exit) => releaseClient(c, exit)              // release() 必然执行
    )
  );
}
```

**进程退出收口**：在 standalone / electrobun / vscode 入口各注册一次 `process.on("SIGINT"|"SIGTERM"|"beforeExit")` → `disposeAll()`，并在 `Scope.close` 内顺带清空 keepalive FiberMap。**这修掉了现状「keepalive 定时器无进程级清理」的缺陷。**

---

## 5. 业务层改动契约（最小侵入）

### 5.1 handler ctx 变化

```ts
// 之前（PostgresDbHandlerContext，18 个字段）
{ connectionMap, getConnId, getS, getSWithDb, getStatements, recreateUserUsedClient,
  attachPostgresClientHandlers, startUserClientKeepalive, stopUserClientKeepalive,
  sendSSEMessage, disconnectConnection, assertSessionDbType, capabilitiesForKind,
  isPgUserClientDeadError, forward }

// 之后
{
  connector: DbConnector,          // 当前会话的连接能力（含 query/stream/控制/AI schema）
  getConnId: () => ConnectionId,
  publish: (msg: SSEMessage) => void,   // 业务主动推事件（如有）
  forward: (method, payload) => Promise<unknown>,  // 仅 postgres dump 递归用
}
```

`connectionMap`、`getS`、`getSWithDb`、`recreateUserUsedClient`、`attachPostgresClientHandlers`、`start/stopKeepalive`、`disconnectConnection`、`assertSessionDbType`（空函数，直接删）、`capabilitiesForKind`、`isPgUserClientDeadError` **全部从 ctx 移除**。

### 5.2 调用点替换表（机械替换，共 ~120 处）

实测计数（`Select-String -AllMatches`，`backend/*.ts` 当前基线）：

| 指标 | postgres | mysql | mssql |
|---|---|---|---|
| `backGroundPool.query(...)` | **20** | **17** | **0**（mssql 走 `pool.request().query(...)`） |
| `backGroundPool.connect()`（需 `withClient`） | **3** | 0 | 0 |
| `backGroundPool.getConnection()`（需 `withClient`） | 0 | **3** | 0 |
| `session.*` 连接状态直写（`cursor` / `runningQueryPid` / `*RowStream` / `mysqlRunningThreadId` / `sqlServerActiveRequest`） | **16** | **10** | **14** |

替换表：

| 现状 | 之后 | postgres | mysql | mssql |
|---|---|---|---|---|
| `session.backGroundPool.query(sql)` | `connector.query(sql)` | 20 | 17 | — |
| `pool.request().query(sql)` / `new sql.Request(pool)` | `connector.query(sql)` | — | — | ~15（需实测补全） |
| `session.userUsedClient.query(sql)`（Monaco 长连接路径） | `connector.queryAsUser(sql)` | 见 `db/query` 分支 | — | — |
| `backGroundPool.connect()` + `release()` | `connector.withClient(fn)` | 3 | — | — |
| `backGroundPool.getConnection()` + `release()` | `connector.withClient(fn)` | — | 3 | — |
| `session.cursor = …` / `runningQueryPid = …` | 删除（connector 内部） | 16 处合计 | — | — |
| `session.mysqlRowStream` / `mysqlRunningThreadId` | 删除（connector 内部） | — | 10 处合计 | — |
| `session.sqlServerRowStream` / `sqlServerActiveRequest` | 删除（connector 内部） | — | — | 14 处合计 |
| `getStatementsFromSql` | `connector.stream({ sql, batchSize })` 内部拆分 | ✓ | ✓ | ✓ |
| `db/connect` 的旧连接清理块 | `sessions.connect()` 内部 | 19 行 | 19 行 | 18 行 |
| `assertSessionDbType(s, dbType)` | 删除（空实现） | 多处 | 多处 | 多处 |
| `capabilitiesForKind(kind)` | `connector.databaseCapabilities` | ✓ | ✓ | ✓ |

> 合计需机械改写的调用点约 **110–130 处**（`session.*` 状态直写 40 处 + 池查询 50+ 处 + `withClient` 6 处 + 3 段连接清理 56 行）。

`db/query-stream` / `db/query-stream-more` 三个方言的 130+ 行流式逻辑**整体搬进对应 connector**，业务侧只剩：
`const batch = await connector.stream({sql, statements, batchSize, defaultSchema}); return batch;`

### 5.3 `api-core.ts` 最终形态

基线：`backend/api-core.ts` 共 **900 行**（其中非-db 业务约 350 行，连接生命周期与传输胶水约 500 行）。

- 删除：`attachPostgresClientHandlers`、三个 `recreate*`、`start/stopUserClientKeepalive`、`disconnectConnection`、`connectionMap`、`sendSSEMessage`、`getSession`、`subscribeSessionEvents`、三个 `is*DeadError`、`shouldRouteDbRequestToMysql/SqlServer`、`buildPostgresSchemaContext`、`buildMysqlSchemaContext`、`buildAiSchemaContext`
- 保留：`handleApiRequest` 的 connections / query-history / ai / subscription 分支（~350 行）
- `db/*` 路由改为：`const info = await getInfo(cid)` → 按 `info.dbKind` 拿 `connector` → 分发给对应 handler
- **顺带修掉**：`shouldRouteDbRequestTo*` 现在依赖「会话是否已存在」，前端刷新后先发 `db/*` 会静默 fallback 到 Postgres 处理器 → 改为按显式 `dbType` 优先、缺失时用 `getInfo` 兜底，并在无会话时抛 `DbError("no-session")`
- **保留兼容**：`getSession` / `subscribeSessionEvents` / `SessionConnection` 的导出在 `backend/db/legacy.ts` 中维持，`api-core.ts` re-export，直到 Phase 3 完成

---

### 5.4 连接获取语义：双轨模型（必须显式化）

现状是**两种语义并存**，重构时必须保留这个划分，但改成显式命名。

### 轨道 A — 每请求 acquire / 用完立即 release（主流）

| 方言 | 写法 | 底层语义 |
|---|---|---|
| PG | `pool.query(sql)` | 驱动内部 checkOut 一条 → 执行 → 立即归还，单次往返 |
| PG | `pool.connect()` … `finally { release() }` | 显式借用：`db/import-rows` 事务（postgres-db-handlers.ts:285/300/970） |
| MySQL | `pool.query(sql)` | 同 PG |
| MySQL | `getConnection()` … `finally { release() }` | `db/import-rows` 事务（:658）、`db/explain`（:721） |
| MSSQL | `pool.request().query(sql)` | `request()` 每次 checkOut 底层连接，request 完成即归还 |

> `pool.query()` 本身就是「按需 acquire + 立即 release」，只是借还发生在驱动内部。

### 轨道 B — 随会话长期持有（为「取消查询」而存在）

| 方言 | 持有物 | 说明 |
|---|---|---|
| PG | `userUsedClient: pg.Client`（池外独立长连接） | 由 `dbForReconnect` 专供重建（postgres-db-handlers.ts:88） |
| MySQL | `userUsedClient: PoolConnection`（从池借走、永不归还） | mysql-db-handlers.ts:413 |
| MSSQL | `userUsedClient === backGroundPool`（同一对象） | sqlserver-db-handlers.ts:1054-1055，靠 `request.cancel()` 取消 |

**存在理由**：`pg_cancel_backend(pid)` / `KILL QUERY <threadId>` 必须命中执行该查询的会话，
因此 `runningQueryPid` / `mysqlRunningThreadId` / `sqlServerActiveRequest` 都登记在会话上。

**轨道 B 的延伸**：流式期间连接被钉住 —— PG `pg-cursor`（`session.cursor`）、
MySQL `rowStream`（自有连接）、MSSQL 流式 request + **显式事务**（sqlserver-mssql-stream.ts:131）。
各自在读完 / `teardown*` / 断开时归还。

### 重构后的接口语义映射

| 接口 | 语义 | Effect 表达 |
|---|---|---|
| `query()` | 每请求 acquire/release（池内部借还） | `Effect.tryPromise(pool.query)`，无需 scope |
| `withClient(fn)` | 每请求显式借用，异常/取消也必归还 | `Effect.acquireUseRelease(pool.connect, use, c => release)` 替代 `try/finally` |
| `queryAsUser()` | 会话级钉住（见待确认项 7） | 会话 scope 内 `acquireRelease`，或 `Resource.manual` 按需+可刷新 |
| `stream()` / `streamMore()` | 流式期间钉住 | 钉在会话 scope，`teardownStream()` 即释放 |
| 会话全部持有物 | 会话 scope | `Scope.close` 一次收口 |

### ⚠️ 必须避开的实现陷阱

1. **禁止用 `withClient` 实现 `query()`**：`pool.query()` 内部已借了一条连接，再包一层
   `pool.connect()` 会变成「借一条连接、再在里面借一条」，池上限 1~2 时**直接自锁**。两者必须是独立入口。
2. **不要在持有连接的事务里长期停留**：现有 `db/import-rows` 的 `finally { release() }` 语义必须用
   `acquireUseRelease` 保持，否则取消/异常路径会漏归还。
3. **隧道模式池上限为 2**（`max: sshEnabled ? 2 : 6`）。MySQL 的轨道 B 长期占用池中 1 条 →
   实际只剩 1 条。若保留轨道 B，需评估「流式翻页 + 并发 `db/explain`」是否会**饿死等超时**；
   建议在 `connect-*.ts` 里把池上限与轨道 B 的占用关系做成显式常量或配置。
4. **MSSQL 的 `userUsedClient` 与 `backGroundPool` 是同一对象**，现状 `disconnectConnection` 对两者分别
   `close()`/`end()` 属重复关闭；重构后必须按「方言一份释放链」实现，不能按字段逐个释放。

---

### 5.5 backgroundPool 是否必需：取消机制与并发通道

### 5.5.1 三方言取消机制（已核对源码/类型）

| 方言 | 取消机制 | 需要额外连接 |
|---|---|---|
| PG | `client.cancel(query)` → `pg/lib/client.js:541-558`：`con.connect(port, host)` **新开一条 TCP** 发 CancelRequest（`processID` + `secretKey`），**不使用原连接的池** | 否 |
| MSSQL | `request.cancel()` → tedious `connection.cancel()`（`mssql/lib/tedious/request.js:324-326`）在同一 TCP 上发 **attention 包** | 否 |
| MySQL | 必须 `KILL QUERY <id>`，该语句需**从另一条连接**执行；唯一免第二连接的办法是 `conn.destroy()`（= 销毁会话，丢临时表/会话变量） | **是** |

**结论**：取消**不应**作为 backgroundPool 存在的理由。PG / MSSQL 的取消可在用户连接上原生完成（`@types/pg` 未暴露 `cancel`，需 `as any` 断言）。

### 5.5.2 backgroundPool 的真正职责 = 并发通道

业务侧存在两条必须能**并行**的通道：

| 通道 | 现状载体 | 用途 |
|---|---|---|
| 用户通道 | `session.userUsedClient` | `db/query`、游标流式、Monaco 长连接语义 |
| 元数据通道 | `session.backGroundPool` | `db/schemas\|tables\|columns\|indexes\|…`、`calculateColumnEditable`、`db/explain`、`db/import-rows` 事务 |

若砍掉元数据通道只留一条连接：**用户在 Monaco 跑长查询 / 流式翻页期间，侧栏元数据请求全部排在其后 → UI 卡死。**

> 因此 `backGroundPool` 的本质是「保证用户连接忙碌时仍有可用连接」，池化只是手段。
> 重构时**保留**，但语义应显式化为「第二条独立通道」。

### 5.5.3 实测数据（真实 PostgreSQL 16，pg 8.20.0 / pg-cursor 2.19.0）

> 验证脚本已删除；下表为实测输出，非源码推断。

| # | 验证项 | 实测结果 | 结论 |
|---|---|---|---|
| A | 同一连接并发两条 `pg_sleep(0.3)` | `q1@303ms, q2@606ms`（墙钟 606ms） | 同连接**严格串行** |
| B | 游标 portal 存活时，同连接发探测查询 | 800ms 内未完成 | 同连接**被游标阻塞** |
| C | 游标在连接 1，另一条连接查询 | **18ms** | 其他连接**不受影响** |
| C2 | 池 `max=1` + 游标存活，再取连接 | `timeout exceeded when trying to connect` | max=1 时取不到连接 |
| D1 | `client.cancel(client, activeQuery)` | `EISCONN`，且为**异步 error 事件**，`try/catch` 接不住、直接击穿进程 | ❌ **不可用** |
| D2 | 另开一条 TCP 发 CancelRequest | **取消成功，307ms，未从池借连接** | ✅ 唯一可用机制 |
| E1 | 事务内 portal 存活 → 并发 `ALTER TABLE` | 被阻塞（`55P03` lock timeout） | portal 持表锁 |
| E2 | 非事务（**当前代码形态**）portal 存活 | 同样被阻塞（`55P03`） | **当前实现确实持锁** |
| E3 | 游标读尽 / 中途 `cursor.close()` | `ALTER` 成功（2~3ms） | 锁随之释放 |
| E4 | 事务内 close 后未 COMMIT | 仍被阻塞，COMMIT 后才释放 | 锁由事务持有 |

**E2 是关键**：backend 现在用 `client.query(new Cursor(...))` 且从不 `BEGIN`，但 portal 存活期间**依然持有 `AccessShareLock`**（`pg_locks` 可见，且阻塞并发 DDL）。
结合 backend 的实现（批次未读完则把 `session.cursor` 存起来，不发送 Sync），
**流式查询期间该表会一直被锁住**，直到用户翻页翻完或连接断开。
这正是 `pg-cursor` 源码注释警告的 `node-pg-cursor#56` 场景。

### 5.5.4 死锁/饥饿分析

| 情况 | 判定 |
|---|---|
| 池子自身 | **无死锁**。`pool.query()` 一次性借还、无嵌套；`import-rows` 的 `pool.connect()` 内只跑 `client.query`；tRPC 元数据调用天然串行 |
| 隧道模式 `max: 2` | **饥饿风险（非死锁）**。MySQL 的 `userUsedClient` 借走池中 1 条不还 → 仅剩 1 条。流式翻页 + 并发 `db/explain` 可等到超时。**PG 安全**（其 `userUsedClient` 在池外） |
| **MySQL 流式首批（真实缺陷）** | `db/query-stream` 在 `conn = session.userUsedClient` 上先执行 `ensureMysqlDefaultDatabase` → `USE db`（mysql-db-handlers.ts:466 → :49）。MySQL 协议层**严格串行**，该 `USE` 会排队，导致**首批直到长查询跑完才返回**。与池大小无关，是「在忙连接上插队」。修法：首批不发 `USE`，改用限定库名；`db/connect` 已记录 `mysqlCurrentDatabase`（:423） |
| **人为自锁（重构主要风险）** | 用 `withClient()` 实现 `query()`，或在 `withClient(fn)` 内再调 `connector.query()` → `pool.query()` 内部已借一条、外层又借一条 → 池 max=1~2 时**真死锁** |

### 5.5.5 单池容量公式（据实测推导，已更正）

**关键前提**：游标跑在「用户连接」上，所以现状下**游标不占池额度**。

| 场景 | 现状（轨道 B：用户连接池外/长借） | 去掉轨道 B（全走池） |
|---|---|---|
| 单个流式查询（游标 + 列元数据） | 池 **1** 条（元数据）+ 池外 1 条（游标） | 池 **2** 条 |
| + 用户再发一个查询 | 池 1 条 | 池 **3** 条 |
| 两个标签页同时流式 | 池 1~2 条 | 池 **4** 条 |

- **这解释了现状为何 `max=2` 能工作**：PG 的游标在池外，池只需应付元数据。
- **也解释了 MySQL 在隧道模式下的饥饿**：MySQL 的用户连接是**从池里借走不还**的，
  池 `max=2` → 实际只剩 1 条，元数据稍一并发就等超时。
- **去掉轨道 B 后 `max=2` 不够**，需 `max ≥ 4`（随并发标签页线性增长）。

### 5.5.6 轨道 B 的真实定位（不是架构必需，是并发确定性）

轨道 B（会话级常驻连接）买到的不是「能取消」（取消可用独立 TCP CancelRequest 实现，实测 D2），
而是**并发确定性**：用户连接永远在手，不会因池被占满而抢不到。

| 方案 | 做法 | 取舍 |
|---|---|---|
| A. 保留轨道 B（现状语义） | 用户连接池外固定(PG) / 池内长借(MySQL) | 确定性最好；每会话常驻占 1 条 + 需维护 `dbForReconnect` 与三份重连 |
| B. 全走池 + 算够 max | 单池 `max ≥ 4` | 架构最简（可删 `userUsedClient`/`dbForReconnect`/两份重连）；并发上限硬绑 `max` |
| **C. 池 + 显式会话租约（推荐）** | 会话建立时从池租 1 条并显式标记，断开时归还 | 接口上是一条稳定连接，实现上不浪费池外句柄；**本质是把轨道 B 显式化，而非删除** |

> **洞察**：池足够大时（`max ≥ 4`），方案 A 与 B 行为等价 ——「常驻」只是「长期租用」的特例。
> 因此「是否保留轨道 B」不是架构问题，而是**池容量 vs 资源浪费**的权衡。

**结论**：采纳方案 C 的实现形态 + 池上限 ≥ 4。
`DbConnector` 对外保持**一个池**（架构简化照做），但保留「会话内稳定一条连接」的语义，
并把它实现为**池内显式租约**；取消走**独立 TCP CancelRequest**，不依赖该租约。

### 5.5.8 `pg.Pool` 能否显式独占一条连接（疑似质疑，已实测）

**结论：可以。** `pool.connect()` 会把 client checkout 出来，**直到 `release()` 之前池都不会复用**。
实测（`pg` 8.20.0 / `pg-pool` 3.13.0）：

| 验证项 | 实测结果 | 含义 |
|---|---|---|
| `pool.connect()` 后 `totalCount/idleCount` | `0/0` → `1/0` → 钉第二条 `2/0` | 钉住的连接**不在 idle 队列** |
| 两次 `pool.connect()` | 返回**不同对象** | 可同时钉多条 |
| 钉住 2 条后再 `pool.query()` | `total=3`，`idle=1` | `pool.query` **新建**连接 |
| pid 对比（钉住连接 vs `pool.query`） | `109` vs `111`，**不同** | **绝不复用被钉住的连接** |
| 池被钉满（`max=1`）后 `pool.query()` | `timeout exceeded when trying to connect`（1001ms） | 宁可超时也不复用被钉连接 |
| 钉住游标 + 池内另一条查询 | 元数据查询 **10ms** 完成 | 钉住与并发**可共存** |

因此「必须另开池外连接才能保证独占」是**误解** —— 独占性由 `pool.connect()` + `release()` 保证。
轨道 B 与「池内显式租约」的差别**只在池容量占用方式上**（池外句柄 vs 占一个 `max` 名额）。

#### ⚠️ 实测踩到的两个真实陷阱

1. **`pool.query(new Cursor(...))` 不可用**：`pg-pool` 会把结果 `promisify` 成 `Promise`，
   拿不到 cursor、无法 `read()`。**游标必须跑在 `pool.connect()` 取出的 client 上。**
   所以若业务代码出现 `pool.query(cursor)` 的写法，需要改为显式 checkout（这是迁移时要检查的点）。
2. **`pool.end()` 会永久挂起**：若有**未结算的游标查询**，那条 client 永远不会 `release()`，
   `pool.end()`（以及进程退出）将永不返回 —— 实测 1500ms 超时兜底才拿到结果，
   这也正是设计验证脚本第一次挂住的原因。
   **对重构的直接要求**：`disconnect`/进程退出路径必须**先 `teardownStream()` 再 `pool.end()`**，
   且顺序不可颠倒（与 3.5 的释放链、以及「先关 DB 连接再关隧道」同源）。

### 5.5.9 设计决策

> **已确认（用户拍板）**：轨道 B **保留**。因此池容量策略不变（PG 游标在池外，池 `max=2` 维持现状），
> 架构简化只做「把三份重连收拢成一份」，**并发特性不做任何变更**。
> 下文中凡涉及「调整池上限」的条目，在保留轨道 B 的前提下仅为**可选优化**，不与 Effect 重构同 PR。

1. **保留元数据通道**，接口上以 `query()` / `queryAsUser()` 区分，注释明确「两者必须可并行」，**禁止互相实现**。
2. **取消改走驱动原生能力，且必须另开连接**：
   - PG：**禁止使用 `client.cancel()`**（实测 `EISCONN` 且会击穿进程）；实现方式为
     `new Connection().connect(host, port)` 后 `con.cancel(processID, secretKey)`，即**单独的 TCP CancelRequest**。
     `@types/pg` 未暴露该能力，需走 `pg/lib/connection.js`（内部模块，需固定版本或不变量测试兜底）。
   - MSSQL：`request.cancel()`（同 TCP attention 包）。
   - MySQL：`KILL QUERY` 走第二通道（保留轨道 B 时该通道常驻 1 条，取证可靠）。
3. **释放顺序强制**（实测 `pool.end()` 永久挂起）：`teardownStream()` → `userUsedClient` 释放 → `pool.end()` → `closeTunnel()`，
   顺序不可颠倒。隧道场景下「先关 DB 连接再关隧道」同样不可颠倒。
4. **portal 必须主动释放**：流式未读尽时不得无限期持有 portal，
   需加「翻页空闲超时自动 `teardownStream`」或「前端切走即释放」，否则**长时间锁表**（实测 E2）。
5. **可选优化（不与本次重构同 PR）**：隧道场景池上限 2 → 3~4、MySQL 流式首批移除排队的 `USE`。

---

## 6. 实施阶段与 PR 拆分

> 每阶段独立可回滚，每阶段结束跑一次全量回归清单。

### Phase 0 — 地基（不引 Effect，纯搬移，行为等价）✅ **已完成**

实际落地与文档原计划的差异（已按实际情况收敛）：

| 计划 | 实际做法 | 原因 |
|---|---|---|
| 新建 `db/contract.ts` / `errors.ts` / `legacy.ts` | **未建**，Phase 0 只建 `db/sessions.ts` | 契约与错误类型属 Phase 1/2 的产物，提前建会留下空壳 |
| 搬 `connectionMap` 到 `sessions.ts` | ✅ 完成，17 处引用全部只在 `sessions.ts` | — |
| 三个 `connect-*.ts`、`session-connection.ts` 不动 | ✅ 未改动 | — |

实际搬入 `backend/db/sessions.ts`（385 行）的内容：
连接注册表、三方言建连（`connectSession`）、统一资源释放（`releaseSessionResources`）、
`disconnectConnection`、三份重连（`recreateUserUsedClient` / `recreateMysqlUserClient` / `recreateSqlServerPool`）、
keepalive（`startUserClientKeepalive` / `stopUserClientKeepalive` / `disposeAllKeepalives`）、
事件推送（`sendSSEMessage` / `subscribeSessionEvents`）、三个死连接判定、`attachPostgresClientHandlers`、
`shouldRouteDbRequestTo*`、`capabilitiesForKind`、`assertSessionDbType`。

**顺带消除的重复**：搬移前「三分支 teardown」重复在 4 处（`api-core` 的 `disconnectConnection`
+ 三个 handler 的 `db/connect` 旧连接清理，各 ~19 行）。现收拢为 `releaseSessionResources` 一份，
`connectSession` 与 `disconnectConnection` 共用。**这直接消除了文档 §2.3 指出的渗漏点 3。**

**为断模块环所做的原语下沉**（重要，避免后人改回去）：
- `teardownMysqlStreaming`：`mysql-db-handlers.ts` → `db/sessions.ts`
- `teardownSqlServerRowStream`：`sqlserver-mssql-stream.ts` → `sqlserver-mssql-query.ts`
- 原因：handler 需要 import `connectSession`，而 sessions 需要 import 这两个 teardown 原语，
  否则形成 handler ⇄ sessions 的模块环。两个原语都只依赖会话句柄自身，下沉后环彻底断开。

**出口标准核验**

| 标准 | 结果 |
|---|---|
| `api-core.ts` 不再持有 `connectionMap` | ✅ 0 命中（900 → **697 行**） |
| 三个 handler 不再引用 `connectionMap` | ✅ 0 命中 |
| 类型检查无新增错误 | ✅ 基线 11 个 = 现状 11 个（同一批，仅 4 处 mysql 行号位移） |
| 端到端行为等价 | ✅ 9/9 通过（真实 PostgreSQL 16，见下） |

端到端验证覆盖（临时脚本已删除）：建连 → 注册表可读 → 能力表(12 项) → 事件订阅+推送 →
元数据查询 → 流式首批(100 行 `hasMore`) → 流式加载更多 → 幂等断开 → 同 id 重连 →
未连接时的错误文案逐字一致。

**遗留到 Phase 1 的已知项**：`api-core.ts` 仍有 3 处 `session.backGroundPool`，
位于 AI schema 上下文构建（`buildPostgresSchemaContext` / `buildMysqlSchemaContext` / `buildSqlServerSchemaContext` 的取值处）。
按 §5.5.6 决策，这三段整体移入各 `DbConnector.buildSchemaContext()` 是 Phase 1/2 的范围。

### Phase 1 — 连接抽象落地（业务与 session 解耦）✅ **三方言完成并实测通过**

**产物**

| 产物 | 行数 | 说明 |
|---|---|---|
| `backend/db/contract.ts` | 116 | `DbConnector` 契约（零驱动依赖） |
| `backend/db/connector-pg.ts` | 197 | Postgres：游标、执行中 pid、死连接重试 |
| `backend/db/connector-mysql.ts` | 336 | MySQL：行流、threadId、`USE`、array 行模式、`KILL QUERY` |
| `backend/db/connector-mssql.ts` | 166 | MSSQL：共享池、流句柄、`request.cancel()`、事务池暴露 |
| `backend/db/schema-context.ts` | 101 | AI schema 采集（从 api-core 迁出） |
| `backend/db/sessions.ts` | 404 | 连接生命周期（Phase 0 产物） |

**契约最终形态**：`query` / `queryAsUser` / `queryWithDefaultSchema?` / `withPoolClient` /
`stream` / `streamMore` / `teardownStream` / `dispose` / `cancelCurrentQuery` /
`sessionThreadId` / `sessionInfo` / `currentDatabase?` / `setActiveRequest?` /
`sessionControl?` / `nativePool?` / `buildSchemaContext` / `watch`

**出口标准核验（三方言）**

| 标准 | 结果 |
|---|---|
| handler 内 `session.*` 连接字段访问 | PG **0**（原 40）／MySQL **0**（原 37）／MSSQL **0**（原 37） |
| `api-core.ts` 残留连接代码 | ✅ **0**（`backGroundPool`/`userUsedClient`/`setInterval`/各 `connect-*` 全部清零）；900 → **611 行** |
| 类型检查 | ✅ 基线 11 → **7**（无新增；消掉的 4 个是 mysql 池泛型错误） |
| 端到端行为等价 | ✅ Postgres **13/13 + 10/10**、MySQL **14/14**、AI schema 路径 **8/8**（真实 PG 16 / MySQL 8.4） |
| SQL Server 端到端 | ✅ 13/14（唯一"失败"项经 HEAD 基线比对确认为既有行为：mssql 列元数据只解析出 1 列，原始实现相同） |

**关键设计取舍**

1. **`connectorFor(cid)` 是同步函数**，不是 async：连接在会话生命周期内始终存在。
2. **游标/行流状态从「散在 handler + session」收进连接器**：`stream`/`streamMore` 跨请求维持，
   PG handler 从 ~50 行降到一行；MSSQL 的列可编辑性装配通过 `StreamPlan.streamColumnsFor` 回调保留在业务侧。
3. **死连接重试移入连接器**（`queryAsUser` / `stream`），经 `deps.recreateUserClient()` 复用 `sessions.ts` 的重建逻辑。
4. **`releaseSessionResources` 前先 `connector.dispose()`**：游标/行流清理原先散在两个方言的 `recreate*` 里。
5. **契约入参放宽为 `string | QuerySpec`、`QueryResult<Row = any>`**，并新增
   `header`（mysql `ResultSetHeader`）、`recordset`（mssql 兼容别名）、`QuerySpec.rowsAsArray`。
   理由：这些数据若不在契约表达就会**静默改变行为**（`save-changes` 的 affectedRows、
   `schema-dump` 的数组行、12 处 `r.recordset` 读法）。
6. **`BorrowedClient` 暴露 `exec`/`beginTransaction`/`commit`/`rollback`**：MySQL 的 `db/explain` 需 `USE` 与
   EXPLAIN 同连接；`db/import-rows` rollback 分支需显式事务。pg 侧改用 `BEGIN`/`COMMIT` 语句。
7. **方言专用能力以「可选方法」而非「句柄属性」暴露**：MSSQL 的 `nativePool()`、
   `setActiveRequest()`、`sessionControl()` 都定义为可选方法，业务侧不持有池对象。
8. **三处原语下沉以断开模块环**：`teardownMysqlStreaming` → `sessions.ts`；
   `teardownSqlServerRowStream` → `sqlserver-mssql-query.ts`；
   `buildSqlServerSchemaContext` → `sqlserver-support.ts`（最后一个是为了让 connector 与 handler 都能引用）。

**实测新发现（重要）**

1. **修掉既有 bug：`schema-dump --includeData` 搬迁前不输出任何 INSERT。**
   原实现从 `session.backGroundPool.connection` 取原生连接，而 **mysql2 promise 池对象上没有 `.connection`**
   （该属性在借出的 `PoolConnection` 上）→ `undefined` → 抛 TypeError → 被 `catch { parts.push("-- skip ...") }` 静默吞掉。
   新实现改走借出连接的 `conn.query({ rowsAsArray: true })`。
   *证据：我第一版同样从池上取，**复现了完全相同的静默失败**，从而证实这是既有缺陷。*
2. **mysql2 `rowsAsArray` 返回 `[rows, fields]` 元组**（实测），按 `{rows, fields}` 解析会把字段元数据当数据行
   （产出 `N'[object Object]'`）。连接器已兼容两种形态。
3. **PG 同连接串行：流式 portal 未读完时 `db/query` 会排队阻塞**（实测：读尽后 2ms 返回）。
   既有约束（§5.5.3），非本次引入；修法归入「portal 主动释放」待修项。

**新增待修项（Phase 1 期间发现，非本次引入）**

- `db/explain-text`(PG) 与 mssql 侧存在**未被引用的诊断代码**，Phase 3 一并清理。
- `buildSqlServerSchemaContextUnused` 已删除；`sqlServerSession` 已删除。

原计划项进度：
- ✅ 定义 `DbConnector` 接口（三方言适配器完成）
- ✅ 三个 handler 的 ctx 换成 `{ connector, getConnId, forward }`
- ✅ 删除 `db/connect` 的 3 段旧连接清理、`assertSessionDbType`

**已完成部分（Postgres + MySQL 全路径）**

| 产物 | 说明 |
|---|---|
| `backend/db/contract.ts` | `DbConnector` 契约（零驱动依赖）：`query` / `queryAsUser` / `queryWithDefaultSchema?` / `withPoolClient` / `stream` / `streamMore` / `teardownStream` / `dispose` / `cancelCurrentQuery` / `sessionThreadId` / `sessionInfo` / `currentDatabase?` / `buildSchemaContext` / `watch` |
| `backend/db/connector-pg.ts` | Postgres 连接工厂：游标、执行中 pid、死连接重试内聚到连接器内部 |
| `backend/db/connector-mysql.ts` | MySQL 连接工厂：行流、执行中 threadId、`USE` 处理、array 行模式内聚 |
| `backend/db/schema-context.ts` | AI schema 上下文采集（从 `api-core.ts` 迁出） |
| `session-connection.ts` | 三种方言会话新增 `connector?: DbConnector`（由连接层在会话建立时注入） |
| `api-core.ts` | 新增 `sessionConnectorFor(cid)`，业务访问连接的**唯一入口** |
| `postgres-db-handlers.ts` | 40 处 `session.*` 句柄访问 → **0**；1088 → 947 行 |
| `mysql-db-handlers.ts` | 37 处 → **0**；1311 → 1049 行 |

**关键设计取舍**

1. **`connectorFor(cid)` 是同步函数**，不是 async：连接在会话生命周期内始终存在。
2. **游标/行流状态从「散在 handler + session」收进连接器**：`stream` / `streamMore` 跨两个请求维持，
   PG 侧 handler 从 ~50 行降到一行。
3. **死连接重试（原 `attempt < 2` 循环）移入连接器**的 `queryAsUser` / `stream`，
   经 `deps.recreateUserClient()` 复用 `sessions.ts` 的重建逻辑。
4. **`releaseSessionResources` 前先 `connector.dispose()`**：游标/行流清理原先散在
   `recreateUserUsedClient` / `recreateMysqlUserUsedClient` 里，现由连接器自持。
5. **契约入参放宽为 `string | QuerySpec`、`QueryResult<Row = any>`**，并新增
   `mainQueryResult.header`（mysql `ResultSetHeader`）、`QuerySpec.rowsAsArray`。
   理由：`db/save-changes` 依赖 `affectedRows`、`db/query`/`schema-dump` 依赖数组行，
   若不在契约表达就会**静默改变行为**（详见下方实测）。
6. **`BorrowedClient` 暴露 `exec` / `beginTransaction` / `commit` / `rollback`**：
   MySQL 的 `db/explain` 需要 `USE` 与后续 EXPLAIN 绑定同一连接；
   `db/import-rows` 的 rollback 分支需要显式事务。pg 侧改用 `BEGIN`/`COMMIT` 语句，不实现这些可选方法。
7. **`teardownMysqlStreaming` 下沉到 `sessions.ts`、`teardownSqlServerRowStream` 下沉到
   `sqlserver-mssql-query.ts`**：断开 handler ⇄ sessions 的模块环（handler 需要 `connectSession`）。

**出口标准核验**

| 标准 | 结果 |
|---|---|
| handler 内 `session.*` 连接字段访问 | PG **0**（原 40）／MySQL **0**（原 37）／MSSQL 37（待做） |
### Phase 2 — Effect 接管连接层 ✅ **已完成（三方言回归通过）**

**做法**：新增 `backend/db/sessions-effect.ts`（307 行）作为 Effect 服务化实现，
`backend/db/sessions.ts`（251 行）降级为**同步读取 + 既有导出名**的适配层。
连接器（`connector-*.ts`）与全部业务 handler / 传输层**完全不用改**。

| 能力 | 实现 |
|---|---|
| 连接注册表 | `Ref<Map<ConnectionId, Entry>>` |
| 每条连接的生命周期 | `Scope.make()` + `Scope.provide(Effect.acquireRelease(open, release), scope)` |
| keepalive | `Effect.forkIn(fiber, serviceScope)` + `FiberMap.set(map, cid, fiber)` |
| 断开/重连 | `Scope.close(entry.scope, Exit.void)`（release 链必执行） |
| 运行时 | `Layer.effect(DbSessions, makeSessions())` + `ManagedRuntime` |
| 同步读取 | 投影 Map（`projectionGet` 等），由 Effect 模块统一维护 |

**实测修掉的 Effect 化 bug（重要）**

`disposeAll()` 最初只调 `runtime.dispose()`，结果**什么都没释放**：

- 会话仍在、`db/*` 请求仍可用（实测输出 `after dispose call: still-works`）
- keepalive fiber 悬挂 → **进程 90s 不退出**

修法：服务内新增 `disposeAll`，显式遍历所有 Entry 调 `disposeEntry`（关闭各自 scope + 中断 keepalive fiber）
并清空 `Ref` 与投影，**然后**才 `runtime.dispose()`。

修复后实测：**进程 2.7s 自然退出**（keepalive 间隔 60s）、投影已清、
dispose 后请求正确返回「未找到数据库连接，请先连接数据库」。

**进程退出收口**：`installSessionDisposeOnExit()` 在 `beforeExit` / `SIGINT` / `SIGTERM` / `exit`
挂一次性收口（幂等），由 `api-core` 模块加载时调用；`disposeAllSessions` 亦从 `api-core` 再导出供宿主显式调用。

**出口标准核验**

| 标准 | 结果 |
|---|---|
| `setInterval` 调用点 | ✅ **0**（keepalive 已 Effect 化；仅剩 `session-connection.ts` 的类型字段，Phase 3 清理） |
| 类型检查 | ✅ 基线 7（无新增） |
| 三方言回归 | ✅ **27/27**（PG/MySQL/MSSQL × 建连/事件/流式/query/元数据/存活/断开/同 id 重连） |
| 全功能综合回归 | ✅ PG + MySQL 全绿（流式读尽、`import-rows` 事务、`session-monitor`、`partition-info`、`explain`、`schema-dump --includeData`、AI schema、事件类型） |
| 退出收口 | ✅ 进程自然退出 2.7s；dispose 后会话不可用 |

> 与设计文档的差异：**`PubSub` 未启用**。事件仍走既有的 `session.eventPushers` + `sendSSEMessage`——
> 传输层（tRPC subscription）依赖该同步推送模型，改造收益低于风险，留待按需评估。
> 同理，`connector-*.ts` 的重连/探测仍以 Promise 表达（由 Effect fiber 调度调用），未改为纯 Effect。

### Phase 3 — 清理与收口 ✅ **已完成**

**已完成**

| 项 | 结果 |
|---|---|
| 连接器从会话对象移除 | `SessionConnection` 不再有 `connector` 字段；改由 `db/sessions-effect.ts` 的**连接器投影**统一持有，业务经 `sessionConnectorOf(cid)` 取值 |
| **对外类型收窄** | 新增 `SessionInfo`（`{ connectionId, dbKind, currentDatabase? }`）与 `getSessionInfo()`；`trpc/context.ts` 的 `Context.session` 与 `trpc/router/db.ts` 的存在性判断已切到它——**传输层不再 import `SessionConnection`** |
| 业务层不再 import 方言句柄类型 | `api-core` / 三个 handler 中的 `MysqlSessionConnection` / `SqlServerSessionConnection` 引用 **0**（含一个已无消费者的再导出，一并删除） |
| `keepAliveTimer` 字段 | 已从会话类型移除（`setInterval` 调用在 Phase 2 已归零） |
| **死连接判定改类型优先** | 新增 `db/errors.ts`：`DbError` + `toDbError()` + `isConnectionLost(e, dialect)`——**类型优先（`DbError.kind`）、正则仅作兜底**；三个连接器的 `isDeadError` 已改走该入口 |
| **边界不变量可执行化** | 新增 `scripts/check-db-boundaries.mjs`：覆盖「业务层不得运行时 import 驱动 / 不得访问会话句柄 / 不得 import 句柄类型」与「传输层不得 import `SessionConnection`」 |

**边界检查现状**（`node scripts/check-db-boundaries.mjs` → 退出码 0）

```
✅ 连接层边界检查通过：业务层无运行时驱动依赖、无会话句柄访问
ℹ️  已记录例外 9 处（如实列出，不隐藏）：
   8 处 类型 import 驱动（仅用于 ctx 签名标注，无运行时依赖）
   1 处 sqlserver-db-handlers.ts 运行时 import mssql
        （sql.Transaction / sql.Request，用于 db/import-rows 事务与参数化插入）
```

> 关于 `sqlserver-support.ts`：它是平铺文件但内容为**连接层 helper**
> （SHOWPLAN / 分区元数据 / 会话监控 / `sqlServerSessionControl`），且 `db/connector-mssql.ts` 依赖它，
> 故在边界检查中归入连接层，避免形成反向依赖。

**收窄效果的实测证据**（三方言回归）

```
pg_2_sessioninfo_shape    keys: ["connectionId", "dbKind"]
mysql_2_sessioninfo_shape keys: ["connectionId", "dbKind", "currentDatabase"]
mssql_2_sessioninfo_shape keys: ["connectionId", "dbKind"]
pg/mysql/mssql_4_trpc_context  sessionKeys 同上（无任何句柄字段）
pg/mysql/mssql_3_getSession_still_works  hasHandle: true（业务 handler 内部仍可读到句柄）
```

即：**传输层拿到的是无句柄摘要；只有业务 handler 经 `DbConnector` 访问连接能力。**

**一处如实说明（未做）**

`db/errors.ts` 的**分类外壳与判定入口已就位，但驱动原始错误尚未在连接器内被包装成 `DbError`**——
因此实际判定当前仍走正则兜底分支。后续只需在连接器捕获处加一层 `toDbError(e, kind)`，
类型分支即生效，判定逻辑无需再改。之所以不现在做：需要逐处判断每个驱动错误的 `kind`，
在没有具体故障驱动的前提下贸然分类，风险高于收益。

**可选（未做）**：`Effect.fn("...")` 加 tracing span、`Metric` 记录连接数/重连次数。

---

## 7. 回归清单（按风险排序）

| # | 场景 | 关注点 |
|---|---|---|
| 1 | 三方言建连（直连 + SSH 隧道） | 隧道建立/关闭顺序；错误文案与现状逐字一致 |
| 2 | 三方言断开 → 资源释放 | pool/client/tunnel 全部释放；重复 disconnect 幂等；无句柄泄漏 |
| 3 | 页面刷新 / 关闭标签页 | `db/disconnect` beacon + SSE 断开两条路径都能释放 |
| 4 | 流式查询：首批 / 加载更多 / 中途取消 / 边翻页边点取消 | cursor 归还、rowStream teardown、`hasMore` 语义 |
| 5 | keepalive 与长查询/流式并发 | 有 cursor / rowStream 时不得探测；死连接自动重建且前端只看到一条 INFO |
| 6 | `db/cancel-query` / `db/session-control` | pg `pg_cancel_backend`/`pg_terminate_backend`、mysql `KILL QUERY`、mssql `request.cancel()` 的 pid/threadId 映射 |
| 7 | tRPC `onConnectionEvents` 订阅 | 建立即收到「事件订阅已建立」；重连后仍收到 NOTICE/ERROR |
| 8 | `db/schema-dump` / `db/database-dump` / `db/execute-ddl` / `db/import-rows` | `withClient` 的事务语义与现状一致（mssql 事务 + 流式 request 归还） |
| 9 | AI 助手（`ai/prompt-build` / `ai/sql-edit` / `ai/prompt-build-diff`） | `buildSchemaContext` 迁移后三方言输出与现状一致 |
| 10 | 前端首次进入、刷新后立刻发 `db/*` 再 `db/connect` | 新的路由策略不得回退成「静默走 Postgres」 |
| 11 | 进程退出（SIGINT/SIGTERM） | keepalive 被清理、连接被释放、无挂起定时器导致进程不退 |
| 12 | 连接不存在 / 已断开时的各种 `db/*` | 错误文案仍为「未找到数据库连接，请先连接数据库」 |

---

## 8. 性能与打包

- **effect 体积**：`node_modules/effect` 约 28.8MB（含 src/dts）；`effect` 已在 `dependencies`，服务端已安装，**磁盘/安装成本为 0**。
- **前端打包**：严禁 `shared/src` 使用非 type import 引 `effect`；`backend/db/contract.ts` 用 `import type` 引 shared 类型。Vite 前端入口不触碰 `backend/db/`，故不会进前端包。
- **运行时开销**：Effect 的 fiber 调度与结构化并发有微小常数成本，相对数据库 IO 可忽略；连接层每次调用仅一次 `runPromise` 边界。
- **并发语义**：现状 handler 调用彼此无序列化（`connectionMap` 上无锁）。Effect 版**不引入**额外串行化（不使用 `Semaphore`），保持现状并发行为。

---

## 9. 待确认项（实施前需拍板）

| # | 问题 | 建议 |
|---|---|---|
| 1 | keepalive 是否在 connect 后立刻探测一次？现状是等 60s | 建议**保持现状**（不立刻探测），减少行为差异面 |
| 2 | 事件 `PubSub` 溢出策略 | 建议 `bounded(256) + dropping`（现状无界 `Set`，慢消费者会占内存） |
| 3 | 是否保留 `SessionConnection` 对外导出 | 建议 Phase 3 后从 `api-core` 移除，只留 `SessionInfo` |
| 4 | 重连失败是否通知前端 | 现状静默吞错；建议发一条 `WARNING` 事件（对用户有价值） |
| 5 | 是否上 lint 规则固化边界 | 建议上（`no-restricted-imports`，成本极低，收益长期） |
| 6 | Phase 0 是否独立合入并观察 | 建议**是**（纯搬移风险最低，可先验证隔离本身的价值） |
| 7 | PG / MySQL 的轨道 B（会话级钉住长连接）是否保留 | 建议**保留**（省一次 `pool.connect()` 往返 + 取消语义直接可用）。改为按需则每次执行多一次往返、取消出现竞态窗口。MSSQL 因共用池不涉及（详见 5.4） |
| 8 | 隧道模式池上限 2 与轨道 B 占用是否需要调参 | 建议为 MySQL/隧道场景显式评估，必要时把上限提高或把轨道 B 改为按需 |
| 9 | backgroundPool 是否保留 | ✅ **已定：保留**，语义明确为「第二条独立通道」。实测：取消不必依赖它（PG 走独立 TCP CancelRequest），但它保证长查询/流式期间元数据不被阻塞（见 5.5.2 / 5.5.3） |
| 10 | 是否修掉 5.5.4 的两个既有缺陷 | 建议修：MySQL 流式首批排队的 `USE`、隧道模式池上限 2 导致的饥饿 |
| 11 | **轨道 B 保留还是改造** | ✅ **已定：保留轨道 B**（不改为池内租约）。推论：池容量策略**不需要改动**（PG 的游标在池外，池 `max=2` 维持现状即可）；架构简化只做「把三份重连收拢成一份」，不动并发特性。池内显式租约降级为 Phase 3+ 的可选优化，**不与 Effect 重构同 PR** |
| 12 | **portal 主动释放策略**（实测确认锁真实存在） | 建议加「翻页空闲超时自动 `teardownStream`」；否则流式期间整表被 `AccessShareLock` 锁住，影响其他客户端写入 |
| 13 | 轨道 B 保留后，PG 取消走哪条路 | 建议走**独立 TCP CancelRequest**（实测 307ms 可用），不再依赖池发取消 SQL；`client.cancel()` 因 `EISCONN` **禁止使用** |

---

## 10. 一句话总结

**隔离由「接口 + 依赖注入」保证，不由「业务也写成 Effect」保证。**
Effect 只负责连接层的四件事：**生命周期对称（Scope）、重连一份（retry）、流式资源自动收获（acquireRelease/FiberMap）、错误与取消类型化**；
业务 handler 依旧是 async + `switch`，只把「伸手进 session」换成「调用 `DbConnector`」。
