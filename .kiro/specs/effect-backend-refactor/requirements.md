# Requirements Document

## Introduction

本需求文档描述将 `backend/` 目录下的 24 个 TypeScript 模块全面重构为 Effect TS 架构。重构目标涵盖类型安全、错误处理、资源管理、并发控制、依赖注入和可测试性六个核心维度。项目已引入 Effect TS 依赖（effect: ^3.22.1），部分模块（如 `effect-session-runtime.ts`）已开始使用 Effect 模式，本重构将统一所有后端模块采用相同的架构风格。

重构采用全量并行策略，一次性重构所有模块，前端同步适配，无需保持 API 兼容性。

## Glossary

- **Effect TS**: 一个 TypeScript 函数式编程库，提供类型安全的异步编程、错误处理和资源管理能力
- **Effect**: Effect TS 核心类型，表示一个可能失败的计算
- **Context**: Effect TS 的依赖注入机制，用于管理服务的依赖关系
- **Layer**: Effect TS 的资源管理模式，处理资源的获取和释放
- **Schema**: Effect TS 的数据验证和序列化库
- **ManagedResource**: 使用 Effect 的 `Scope` 和 `Layer` 管理的资源，确保正确获取和释放
- **SessionConnection**: 数据库会话连接对象，包含连接池、客户端连接和事件推送器
- **DbKind**: 数据库类型枚举，支持 `postgres`、`mysql`、`mariadb`、`sqlserver`
- **SSE**: Server-Sent Events，用于向前端推送实时消息
- **SSH Tunnel**: SSH 隧道，用于通过跳板机连接远程数据库
- **Handler**: 处理特定 API 请求的函数模块
- **Transport**: API 传输层，支持 HTTP 和 VS Code 两种模式
- **Pool**: 数据库连接池，管理多个数据库连接
- **Keepalive**: 保活机制，定期发送心跳防止连接超时

## Requirements

### Requirement 1: 类型安全的错误处理

**User Story:** 作为后端开发者，我希望所有错误都有明确的类型定义，以便编译器能捕获错误处理遗漏并提供更好的 IDE 支持。

#### Acceptance Criteria

1. THE Backend_System SHALL 为每个模块定义结构化的错误类型，使用 Effect 的 `Data.Error` 模式
2. WHEN 发生数据库连接错误，THE Database_Module SHALL 返回类型为 `DatabaseConnectionError` 的错误，包含连接参数（脱敏）、错误码和原始错误信息
3. WHEN 发生 SQL 执行错误，THE Query_Module SHALL 返回类型为 `QueryExecutionError` 的错误，包含 SQL 语句（脱敏）、错误位置和数据库错误码
4. WHEN 发生 SSH 隧道错误，THE Ssh_Module SHALL 返回类型为 `SshTunnelError` 的错误，包含跳板机地址（脱敏）和连接阶段信息
5. WHEN 发生 AI 服务错误，THE Ai_Module SHALL 返回类型为 `AiServiceError` 的错误，包含 API 模式、模型名称和 HTTP 状态码
6. IF 错误包含敏感信息（密码、密钥等），THEN THE Error_System SHALL 在日志和响应中脱敏处理

### Requirement 2: 资源安全管理

**User Story:** 作为后端开发者，我希望数据库连接、SSH 隧道和流式查询等资源能被安全管理，避免资源泄漏。

#### Acceptance Criteria

1. WHEN 建立数据库连接，THE Database_Module SHALL 使用 Effect 的 `Scope` 或 `Layer` 管理连接生命周期
2. WHEN 建立数据库连接需要 SSH 隧道，THE Database_Module SHALL 确保隧道在连接关闭时一并关闭
3. WHEN 创建流式查询（cursor/stream），THE Query_Module SHALL 确保流在会话结束或中断时正确关闭
4. WHEN 会话因网络中断或页面关闭而终止，THE Session_Module SHALL 自动释放所有关联资源
5. WHILE 执行 keepalive 探活，THE Session_Module SHALL 在连接失败时触发自动重连或标记会话为断开状态
6. IF 资源释放失败，THEN THE Resource_System SHALL 记录错误日志并继续尝试释放其他资源

### Requirement 3: 依赖注入与服务层

**User Story:** 作为后端开发者，我希望各模块的依赖通过 Effect Context 管理，便于测试时替换实现。

#### Acceptance Criteria

1. THE Backend_System SHALL 为每个主要功能领域定义 Service 接口和 Tag
2. THE Database_Module SHALL 提供 `DatabaseService` 接口，包含连接、查询、断开等方法
3. THE Ssh_Module SHALL 提供 `SshTunnelService` 接口，封装隧道创建和管理逻辑
4. THE Ai_Module SHALL 提供 `AiService` 接口，封装与 AI API 的交互逻辑
5. THE Storage_Module SHALL 提供 `ConnectionStoreService`、`QueryHistoryService`、`AiKeyStoreService` 等接口
6. THE Subscription_Module SHALL 提供 `SubscriptionService` 和 `LicenseService` 接口
7. WHEN 测试模块需要替换依赖，THE Test_System SHALL 能通过 Layer 注入 mock 实现

### Requirement 4: 并发控制与取消

**User Story:** 作为后端开发者，我希望长时间运行的查询能被取消，避免占用数据库资源。

#### Acceptance Criteria

1. WHEN 执行长时间运行的查询，THE Query_Module SHALL 支持 Effect 的 `Fiber` 和 `Signal` 机制进行取消
2. WHEN 用户取消查询，THE Query_Module SHALL 向数据库发送 `CANCEL` 命令（PostgreSQL）或 `KILL QUERY`（MySQL）
3. WHILE 流式查询正在执行，THE Query_Module SHALL 在取消信号触发时关闭流并释放数据库连接
4. WHEN 会话断开，THE Session_Module SHALL 取消所有正在运行的查询任务
5. IF 取消操作失败，THEN THE Query_Module SHALL 记录错误日志但不应阻塞其他操作

### Requirement 5: 配置管理

**User Story:** 作为后端开发者，我希望所有配置项通过 Effect 的 Config 系统管理，支持环境变量和默认值。

#### Acceptance Criteria

1. THE Backend_System SHALL 使用 Effect 的 `Config` 模块定义所有配置项
2. WHEN AI 服务需要 API 配置，THE Ai_Module SHALL 从 Effect Config 读取 `apiMode`、`baseUrl`、`model` 等参数
3. WHEN 数据库连接需要超时配置，THE Database_Module SHALL 从 Effect Config 读取连接超时、空闲超时等参数
4. WHEN SSH 隧道需要配置，THE Ssh_Module SHALL 从 Effect Config 读取默认超时和调试模式
5. IF 配置项缺失，THEN THE Config_System SHALL 使用合理默认值或返回配置错误

### Requirement 6: 流式处理与 SSE 推送

**User Story:** 作为后端开发者，我希望数据库事件（通知、错误、警告）能通过 SSE 实时推送到前端。

#### Acceptance Criteria

1. WHEN PostgreSQL 连接收到 `NOTIFICATION` 事件，THE Postgres_Module SHALL 通过 SSE 推送 `NOTIFICATION` 类型消息
2. WHEN 数据库连接发生错误，THE Database_Module SHALL 通过 SSE 推送 `ERROR` 类型消息
3. WHEN 数据库返回 notice 消息，THE Postgres_Module SHALL 通过 SSE 推送 `NOTICE` 类型消息
4. WHEN 连接断开，THE Session_Module SHALL 通过 SSE 推送 `WARNING` 类型消息
5. WHILE SSE 连接活跃，THE Http_Module SHALL 每 10 秒发送心跳注释 `: heartbeat`
6. IF SSE 客户端断开，THEN THE Http_Module SHALL 清理订阅但不应断开数据库会话

### Requirement 7: API Handler 统一重构

**User Story:** 作为后端开发者，我希望所有 `db/*` API handlers 使用统一的 Effect 模式实现。

#### Acceptance Criteria

1. THE Postgres_DbHandlers_Module SHALL 将所有 `handlePostgresDbRequest` 中的 case 分支重构为独立的 Effect 函数
2. THE Mysql_DbHandlers_Module SHALL 将所有 `handleMysqlDbRequest` 中的 case 分支重构为独立的 Effect 函数
3. THE SqlServer_DbHandlers_Module SHALL 将所有 `handleSqlServerDbRequest` 中的 case 分支重构为独立的 Effect 函数
4. WHEN 路由请求到不同数据库处理器，THE Api_Core_Module SHALL 使用 Effect 的路由逻辑
5. IF 请求方法不匹配任何处理器，THEN THE Api_Core_Module SHALL 返回结构化的 `MethodNotFoundError`

### Requirement 8: 连接存储与历史管理

**User Story:** 作为后端开发者，我希望连接存储和查询历史模块使用 Effect 进行文件 I/O 和数据验证。

#### Acceptance Criteria

1. THE Connections_Store_Module SHALL 使用 Effect 的文件操作 API 读写连接配置文件
2. THE Query_History_Store_Module SHALL 使用 Effect 的文件操作 API 读写查询历史文件
3. WHEN 保存连接配置，THE Connections_Store_Module SHALL 验证必填字段和数据格式
4. WHEN 保存查询历史，THE Query_History_Store_Module SHALL 限制历史条目数量并清理过期记录
5. IF 文件操作失败，THEN THE Storage_Module SHALL 返回结构化的 `StorageError` 并记录详细日志

### Requirement 9: AI 服务集成

**User Story:** 作为后端开发者，我希望 AI 服务模块使用 Effect 处理 HTTP 请求、流式响应和错误重试。

#### Acceptance Criteria

1. THE Ai_Service_Module SHALL 使用 Effect 的 HTTP 客户端（或 Effect 包装的 fetch）发送请求
2. WHEN AI API 返回流式响应，THE Ai_Module SHALL 使用 Effect 的流处理 API 解析 SSE 格式
3. WHEN AI API 请求失败，THE Ai_Module SHALL 根据错误类型决定是否重试（网络错误重试，认证错误不重试）
4. THE Ai_Module SHALL 使用 Effect Schema 验证 AI 返回的 JSON 结构
5. IF AI 返回的 SQL 包含高风险操作（DROP、TRUNCATE、无 WHERE 的 UPDATE/DELETE），THEN THE Ai_Module SHALL 在 `warnings` 字段中标注

### Requirement 10: 订阅与许可证管理

**User Story:** 作为后端开发者，我希望订阅和许可证模块使用 Effect 管理远程 API 调用和本地令牌存储。

#### Acceptance Criteria

1. THE Subscription_License_Module SHALL 使用 Effect HTTP 客户端调用订阅验证 API
2. THE Subscription_Token_Store_Module SHALL 使用 Effect 文件 API 管理令牌存储
3. WHEN 验证订阅状态，THE License_Module SHALL 解析 JWT 令牌并检查有效期
4. IF 订阅验证 API 不可用，THEN THE License_Module SHALL 使用本地缓存的验证结果（如有）
5. WHEN 订阅令牌过期或无效，THE License_Module SHALL 返回 `SubscriptionRequiredError`

### Requirement 11: SSH 隧道服务

**User Story:** 作为后端开发者，我希望 SSH 隧道模块使用 Effect 管理连接生命周期和错误处理。

#### Acceptance Criteria

1. THE Ssh_Module SHALL 使用 Effect 的 `acquireRelease` 模式管理 SSH 客户端连接
2. WHEN SSH 隧道创建失败，THE Ssh_Module SHALL 返回结构化的 `SshTunnelError` 并包含诊断信息
3. WHILE SSH 隧道活跃，THE Ssh_Module SHALL 支持自定义调试日志输出（开发模式）
4. WHEN 关闭 SSH 隧道，THE Ssh_Module SHALL 优雅关闭 SSH 客户端和本地代理服务器
5. IF SSH 连接超时，THEN THE Ssh_Module SHALL 提供清晰的错误提示，引导用户检查跳板机配置

### Requirement 12: 数据库连接模块重构

**User Story:** 作为后端开发者，我希望 PostgreSQL、MySQL、SQL Server 的连接模块使用 Effect 管理连接创建和池化。

#### Acceptance Criteria

1. THE Postgres_Connect_Module SHALL 使用 Effect 封装 `pg.Client` 和 `pg.Pool` 的创建逻辑
2. THE Mysql_Connect_Module SHALL 使用 Effect 封装 `mysql2.Pool` 的创建逻辑
3. THE SqlServer_Connect_Module SHALL 使用 Effect 封装 `mssql.ConnectionPool` 的创建逻辑
4. WHEN 创建数据库连接池，THE Connect_Modules SHALL 根据是否使用 SSH 隧道调整池大小
5. IF 数据库连接失败，THEN THE Connect_Modules SHALL 返回结构化的 `DatabaseConnectionError` 并包含重试建议

### Requirement 13: 会话运行时扩展

**User Story:** 作为后端开发者，我希望现有的 `effect-session-runtime.ts` 扩展以支持完整的 Effect 模式。

#### Acceptance Criteria

1. THE Session_Runtime_Module SHALL 扩展支持 `SessionConnection` 的所有数据库类型
2. WHEN 注册新会话，THE Session_Runtime_Module SHALL 使用 Effect 的 `Ref` 保证线程安全
3. WHEN 断开会话，THE Session_Runtime_Module SHALL 使用 Effect 的资源释放机制
4. THE Session_Runtime_Module SHALL 提供基于 Effect 的 `withSessionScope` 函数，自动管理资源作用域
5. IF 会话不存在，THEN THE Session_Runtime_Module SHALL 返回类型化的 `SessionNotFoundError`

### Requirement 14: 测试基础设施

**User Story:** 作为后端开发者，我希望重构后的模块易于测试，能快速编写单元测试和集成测试。

#### Acceptance Criteria

1. THE Backend_System SHALL 为每个 Service 接口提供 mock 实现的测试工具
2. THE Test_Infrastructure SHALL 提供测试用的数据库连接 mock
3. THE Test_Infrastructure SHALL 提供测试用的 SSH 隧道 mock
4. THE Test_Infrastructure SHALL 提供测试用的 AI 服务 mock
5. WHEN 运行测试，THE Test_System SHALL 使用 Effect 的 TestContext 提供测试配置和服务

### Requirement 15: API 兼容性与前端适配

**User Story:** 作为全栈开发者，我希望重构后的 API 行为与现有前端兼容，或提供清晰的迁移路径。

#### Acceptance Criteria

1. THE Api_Core_Module SHALL 保持现有的 JSON-RPC 方法签名不变
2. THE Api_Core_Module SHALL 保持 SSE 消息格式不变
3. WHEN 错误响应格式变更，THE Api_Core_Module SHALL 提供迁移文档和类型更新
4. THE Frontend_Module SHALL 同步更新 API 客户端类型定义
5. IF 行为发生破坏性变更，THEN THE Team SHALL 在发布说明中明确标注

### Requirement 16: 日志与可观测性

**User Story:** 作为后端开发者，我希望所有模块使用 Effect 的日志系统，支持结构化日志和日志级别控制。

#### Acceptance Criteria

1. THE Backend_System SHALL 使用 Effect 的 `Logger` 模块替代 `console.log`
2. WHEN 记录错误日志，THE Log_System SHALL 包含结构化的错误信息、上下文和时间戳
3. WHEN 记录调试日志，THE Log_System SHALL 包含操作名称、参数（脱敏）和执行时间
4. THE Log_System SHALL 支持通过环境变量控制日志级别（DEBUG、INFO、WARN、ERROR）
5. IF 敏感信息需要记录，THEN THE Log_System SHALL 自动脱敏或使用占位符

### Requirement 17: 性能与资源使用

**User Story:** 作为后端开发者，我希望重构后不引入明显的性能回退，内存和 CPU 使用保持在合理范围。

#### Acceptance Criteria

1. THE Backend_System SHALL 确保重构后 API 响应延迟增加不超过 10%
2. THE Backend_System SHALL 确保重构后内存使用增加不超过 20%
3. WHEN 处理高并发请求，THE Backend_System SHALL 利用 Effect 的并发原语优化吞吐量
4. WHEN 执行批量操作，THE Backend_System SHALL 使用 Effect 的并发控制避免资源耗尽
5. IF 性能指标超过阈值，THEN THE Team SHALL 进行性能分析并优化关键路径
