# 实现计划：subscription-module

## 概述

基于现有后端（Hono + Bun）、前端（纯 TS + Vite）和 VSCode 插件（`vscode-extension/src/extension.ts`），分四个阶段完成订阅模块的完整实现：后端 `source` 参数透传、前端 VSCode 模式检测与 URI Scheme 跳转、VSCode 插件新增 URI Handler / TokenStorage / LicenseValidator / ExpiryNotifier 四个组件，以及用 fast-check 覆盖设计文档中全部 19 个正确性属性的属性测试。

## 任务

- [x] 1. 后端：修改 `source` 参数透传逻辑
  - [x] 1.1 修改 `GET /api/auth/github`，将 `source` 查询参数编码进 OAuth `state`
    - 在 `subscription/backend/src/index.ts` 中，读取 `c.req.query("source")`
    - 将 `state` 改为 `base64(JSON.stringify({ nonce: uuid, source?: string }))`
    - _需求：2.2, 2.3_

  - [x] 1.2 修改 `GET /api/auth/github/callback`，解析 `state` 并将 `source` 拼入重定向 URL
    - 解码 `state`，取出 `source` 字段
    - 重定向目标改为 `{FRONTEND_URL}?token=<JWT>[&source=<source>]`
    - _需求：2.3, 3.2_

  - [ ]* 1.3 为后端 `source` 透传逻辑编写属性测试（属性 1、13、17、18、19）
    - 在 `subscription/backend/src/` 下新建 `auth.test.ts`
    - **属性 1：JWT 签发规范** — 对任意 userId/email，验证算法 HS256、issuer、audience、过期时间 7 天（±60s）
      - `// Feature: subscription-module, Property 1: JWT 签发规范`
      - **验证需求：1.3, 6.2**
    - **属性 13：受保护接口认证** — 对任意缺失/格式错误/过期 JWT，受保护接口返回 401
      - `// Feature: subscription-module, Property 13: 受保护接口认证`
      - **验证需求：4.6, 6.1, 6.3**
    - 新建 `payment.test.ts`
    - **属性 4：支付激活订阅** — 对任意有效订单，激活后 status='paid'，订阅 expires_at > now
      - `// Feature: subscription-module, Property 4: 支付激活订阅`
      - **验证需求：1.11**
    - **属性 5：续费顺延计算** — 对任意已有有效订阅，续费后 expires_at = 原 expires_at + 套餐天数
      - `// Feature: subscription-module, Property 5: 续费顺延计算`
      - **验证需求：1.12, 8.3**
    - **属性 17：订阅状态查询格式** — 对任意已认证用户，响应结构符合 SubscriptionResponse 类型
      - `// Feature: subscription-module, Property 17: 订阅状态查询格式`
      - **验证需求：7.1, 7.2, 7.4**
    - **属性 18：多订阅取最晚记录** — 对任意多条 active 订阅，返回 expires_at 最晚的记录
      - `// Feature: subscription-module, Property 18: 多订阅取最晚记录`
      - **验证需求：7.3**
    - **属性 19：支付回调幂等性** — 对任意已 paid 订单，重复回调不改变订阅记录
      - `// Feature: subscription-module, Property 19: 支付回调幂等性`
      - **验证需求：8.1**
    - **属性 3：支付回调验签拒绝** — 对任意格式错误/签名无效的回调，返回失败且订阅不变
      - `// Feature: subscription-module, Property 3: 支付回调验签拒绝`
      - **验证需求：1.10, 6.5**

- [x] 2. 检查点 — 后端修改完成
  - 确保所有测试通过，如有疑问请向用户确认。

- [x] 3. 前端：VSCode 模式检测与 URI Scheme 跳转
  - [x] 3.1 在 `subscription/frontend/src/app.ts` 中新增 `source=vscode` 检测逻辑
    - 初始化时读取 `URLSearchParams` 中的 `source`，若为 `vscode` 则存入 `sessionStorage`
    - 修改 `init()` 函数：当 `source=vscode` 且已登录时，展示"返回 VSCode"按钮
    - _需求：2.3, 3.1_

  - [x] 3.2 实现 URI Scheme 跳转函数
    - 新增 `redirectToVscode(token: string): void`，构造 `vscode://lilr.db-player/auth?token=<JWT>` 并通过 `window.location.href` 跳转
    - _需求：3.2_

  - [x] 3.3 在支付成功后自动触发 URI Scheme 跳转
    - 微信支付：轮询到 `paid` 后，若 `sessionStorage` 中有 `source=vscode`，调用 `redirectToVscode`
    - 支付宝：`returnUrl` 回到页面时（页面初始化检测到已登录且 `source=vscode`），展示"返回 VSCode"按钮并可手动触发
    - _需求：2.3, 3.2_

  - [ ]* 3.4 为前端逻辑编写属性测试（属性 2、7）
    - 在 `subscription/frontend/src/` 下新建 `app.test.ts`，使用 Vitest + fast-check
    - **属性 2：token 存储与 URL 清理** — 对任意有效 token，`getToken()` 后 localStorage 存有 token 且 URL 不含 token 参数
      - `// Feature: subscription-module, Property 2: token 存储与 URL 清理`
      - **验证需求：1.4**
    - **属性 7：source=vscode 时构造 URI Scheme** — 对任意有效 JWT 且 source=vscode，构造的 URL 格式为 `vscode://lilr.db-player/auth?token=<JWT>`
      - `// Feature: subscription-module, Property 7: source=vscode 时构造 URI Scheme`
      - **验证需求：2.3, 3.2**

- [x] 4. 检查点 — 前端修改完成
  - 确保所有测试通过，如有疑问请向用户确认。

- [x] 5. VSCode 插件：新增 TokenStorage 组件
  - [x] 5.1 在 `vscode-extension/src/` 下新建 `token-storage.ts`，实现 `TokenStorage` 类
    - 底层使用 `vscode.ExtensionContext.secrets`，key 为 `dbplayer.jwt`
    - 实现 `getToken(): Promise<string | undefined>`
    - 实现 `setToken(token: string): Promise<void>`
    - 实现 `clearToken(): Promise<void>`
    - _需求：3.3, 6.4_

- [x] 6. VSCode 插件：新增 URI Handler 组件
  - [x] 6.1 在 `vscode-extension/src/` 下新建 `uri-handler.ts`，实现 `DbPlayerUriHandler` 类
    - 实现 `vscode.UriHandler` 接口，处理路径 `/auth`
    - 从 URI 参数中提取 `token`，验证 JWT 格式（三段 base64url 结构）
    - 格式合法时调用 `TokenStorage.setToken(token)`
    - 格式非法时调用 `vscode.window.showErrorMessage` 提示重新登录，不存储 token
    - _需求：3.3, 3.4, 3.5_

  - [x] 6.2 在 `vscode-extension/src/extension.ts` 的 `activate` 函数中注册 URI Handler
    - 调用 `vscode.window.registerUriHandler(new DbPlayerUriHandler(tokenStorage))`
    - 将注册结果加入 `context.subscriptions`
    - _需求：3.5_

  - [x] 6.3 在 `vscode-extension/package.json` 中注册 URI Handler 配置
    - 在 `contributes` 中添加 `"uriHandler": {}` 声明（VSCode 要求 package.json 声明）
    - _需求：3.5_

  - [ ]* 6.4 为 URI Handler 编写属性测试（属性 8、9）
    - 在 `vscode-extension/src/` 下新建 `uri-handler.test.ts`，使用 Vitest + fast-check，mock vscode API
    - **属性 8：URI Handler 存储 token** — 对任意格式合法的 URI，处理后 SecretStorage 中存储的 token 等于 URI 中的 token
      - `// Feature: subscription-module, Property 8: URI Handler 存储 token`
      - **验证需求：3.3**
    - **属性 9：无效 token 被拒绝** — 对任意格式非法的 token（非三段结构、含非法字符），处理后 SecretStorage 不存储该 token
      - `// Feature: subscription-module, Property 9: 无效 token 被拒绝`
      - **验证需求：3.4**

- [x] 7. VSCode 插件：新增 LicenseValidator 组件
  - [x] 7.1 在 `vscode-extension/src/` 下新建 `license-validator.ts`，实现 `LicenseValidator` 类
    - 缓存结构：`{ result: { valid: boolean; expiresAt: number | null }, cachedAt: number }` 存于内存
    - 实现 `validate(): Promise<{ valid: boolean; expiresAt: number | null }>`
      - 无 JWT 时直接返回 `{ valid: false, expiresAt: null }`，不发起请求
      - 缓存有效（< 1 小时）时直接返回缓存结果
      - 调用 `GET /api/verify-license`，成功时缓存结果，失败/401 时清除缓存返回无效状态
    - 实现 `invalidateCache(): void`，清除内存缓存
    - _需求：4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 7.2 将 `extension.ts` 中现有的 `checkSubscription` 函数替换为使用 `LicenseValidator`
    - 删除原有的内联 `checkSubscription` 函数
    - 使用 `LicenseValidator` 实例的 `validate()` 方法
    - _需求：4.1_

  - [ ]* 7.3 为 LicenseValidator 编写属性测试（属性 10、11、12）
    - 在 `vscode-extension/src/` 下新建 `license-validator.test.ts`，使用 Vitest + fast-check，mock fetch
    - **属性 10：缓存行为** — 对任意有效响应，缓存写入后 1 小时内重复调用不发起新网络请求
      - `// Feature: subscription-module, Property 10: 缓存行为`
      - **验证需求：4.2, 4.4**
    - **属性 11：无效响应清除缓存** — 对任意 valid:false 响应或网络失败，内存缓存被清除
      - `// Feature: subscription-module, Property 11: 无效响应清除缓存`
      - **验证需求：4.3**
    - **属性 12：无 JWT 时不发起请求** — 对任意无 JWT 状态，validate() 直接返回无效且 fetch 未被调用
      - `// Feature: subscription-module, Property 12: 无 JWT 时不发起请求`
      - **验证需求：4.5**

- [x] 8. VSCode 插件：新增 ExpiryNotifier 组件
  - [x] 8.1 在 `vscode-extension/src/` 下新建 `expiry-notifier.ts`，实现 `ExpiryNotifier` 类
    - 使用 `Set<number>` 记录已提醒的 `expiresAt`，同一会话内不重复提醒
    - 实现 `checkAndNotify(expiresAt: number | null): Promise<void>`
      - `expiresAt` 为 null 时不提醒（永久订阅）
      - `expiresAt` < now 时展示"订阅已过期"通知（`showWarningMessage`）
      - `expiresAt` 距 now ≤ 7 天时，展示含剩余天数和"立即续费"按钮的提醒通知
      - "立即续费"按钮点击后调用 `vscode.env.openExternal` 打开订阅页并附加 `source=vscode`
    - _需求：5.1, 5.2, 5.3, 5.4_

  - [x] 8.2 在 `extension.ts` 的订阅校验流程中集成 `ExpiryNotifier`
    - 在 `LicenseValidator.validate()` 返回结果后，调用 `ExpiryNotifier.checkAndNotify(expiresAt)`
    - _需求：5.1, 5.4_

  - [ ]* 8.3 为 ExpiryNotifier 编写属性测试（属性 6、14、15、16）
    - 在 `vscode-extension/src/` 下新建 `expiry-notifier.test.ts`，使用 Vitest + fast-check，mock vscode API
    - **属性 6：openExternal 附加 source=vscode** — 对任意插件内触发的订阅/续费操作，openExternal 的 URL 包含 `source=vscode`
      - `// Feature: subscription-module, Property 6: openExternal 附加 source=vscode`
      - **验证需求：2.2, 5.2**
    - **属性 14：到期提醒触发** — 对任意 expiresAt 距 now ≤ 7 天（且 > 0），checkAndNotify 触发 VSCode 通知且含"立即续费"按钮
      - `// Feature: subscription-module, Property 14: 到期提醒触发`
      - **验证需求：5.1**
    - **属性 15：提醒去重** — 对任意相同 expiresAt，同一会话多次调用 checkAndNotify，通知只展示一次
      - `// Feature: subscription-module, Property 15: 提醒去重`
      - **验证需求：5.3**
    - **属性 16：过期禁用功能** — 对任意 expiresAt < now，付费功能入口处于禁用状态且展示过期通知
      - `// Feature: subscription-module, Property 16: 过期禁用功能`
      - **验证需求：5.4**

- [x] 9. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有疑问请向用户确认。

## 备注

- 标有 `*` 的子任务为可选项，可跳过以加快 MVP 进度
- 每个属性测试文件顶部需注明 `// Feature: subscription-module, Property N: <描述>`
- fast-check 每个属性测试最少运行 100 次迭代（`numRuns: 100`）
- VSCode 插件的属性测试需 mock `vscode` 模块（Vitest `vi.mock('vscode', ...)`）
- URI Scheme 格式：`vscode://lilr.db-player/auth?token=<JWT>`（publisher 为 `lilr`，name 为 `db-player`）
- 后端测试使用 Bun test runner（`bun test`），前端和插件测试使用 Vitest（`vitest --run`）
