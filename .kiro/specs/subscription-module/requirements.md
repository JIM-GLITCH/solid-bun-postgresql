# 需求文档

## 简介

DB Player 订阅模块为 VSCode 插件提供完整的订阅生命周期管理，涵盖：网页端订阅购买流程（GitHub 登录 → 选择套餐 → 支付宝/微信支付 → 激活）、VSCode 插件内触发订阅（唤起浏览器跳转订阅页）、网页支付完成后通过 URI Scheme 回传 token 唤起插件、以及插件内订阅有效性校验与到期提醒。

后端基于 Hono + Bun 部署于阿里云函数计算（FC），数据库为 PostgreSQL，已实现 GitHub OAuth 登录、支付宝/微信 Native 支付、订阅激活与 `/api/verify-license` 校验接口。

---

## 词汇表

- **System**：DB Player 订阅模块整体系统
- **Backend**：基于 Hono + Bun 的后端 API 服务，部署于阿里云 FC
- **Frontend**：基于纯 TS + Vite 构建的订阅网页
- **VSCode_Plugin**：DB Player VSCode 扩展插件
- **Auth_Service**：负责 GitHub OAuth 登录与 JWT 签发的认证服务
- **Payment_Service**：负责创建支付订单、处理支付回调、激活订阅的支付服务
- **License_Validator**：VSCode 插件内负责调用 `/api/verify-license` 并缓存结果的校验组件
- **Subscription_Page**：前端订阅网页，包含登录、套餐选择、支付弹窗
- **URI_Scheme**：VSCode 自定义协议，格式为 `vscode://publisher.db-player/auth?token=<JWT>`
- **JWT**：JSON Web Token，用于标识已登录用户身份，有效期 7 天
- **Order**：支付订单，包含订单号、套餐、金额、状态等信息
- **Subscription**：用户订阅记录，包含套餐、状态、到期时间
- **Plan**：订阅套餐，当前支持 `monthly`（月付 ¥29）和 `yearly`（年付 ¥199）

---

## 需求

### 需求 1：网页端完整订阅流程

**用户故事：** 作为未订阅用户，我希望在订阅网页上完成 GitHub 登录、选择套餐并支付，以便激活 DB Player 订阅。

#### 验收标准

1. WHEN 用户访问订阅网页且未登录，THE Frontend SHALL 显示"GitHub 登录"按钮并隐藏订阅操作按钮。
2. WHEN 用户点击"GitHub 登录"按钮，THE Frontend SHALL 跳转至 `GET /api/auth/github` 发起 GitHub OAuth 授权流程。
3. WHEN GitHub OAuth 授权成功，THE Auth_Service SHALL 在 `user_identities` 表中查找或创建用户记录，签发有效期为 7 天的 JWT，并将浏览器重定向至 `{FRONTEND_URL}?token=<JWT>`。
4. WHEN Frontend 检测到 URL 中包含 `token` 参数，THE Frontend SHALL 将 token 存入 `localStorage`，清除 URL 中的 token 参数，并展示当前订阅状态。
5. WHEN 已登录用户点击订阅按钮，THE Frontend SHALL 弹出支付方式选择弹窗，提供"支付宝"和"微信支付"两个选项。
6. WHEN 用户选择支付宝，THE Frontend SHALL 调用 `POST /api/payment/create`（body: `{plan, method: "alipay"}`），并将浏览器跳转至返回的 `payUrl`。
7. WHEN 用户选择微信支付，THE Frontend SHALL 调用 `POST /api/payment/create`（body: `{plan, method: "wxpay"}`），并展示包含 `codeUrl` 二维码的扫码弹窗。
8. WHILE 微信支付弹窗展示，THE Frontend SHALL 每 3 秒轮询 `GET /api/payment/order/:orderNo`，直至订单状态变为 `paid` 或弹窗关闭。
9. WHEN 订单状态变为 `paid`，THE Frontend SHALL 关闭支付弹窗并刷新订阅状态展示。
10. IF 支付宝或微信支付回调验签失败，THEN THE Payment_Service SHALL 返回失败响应且不激活订阅。
11. WHEN 支付回调验签通过且交易状态为成功，THE Payment_Service SHALL 在事务中将订单状态更新为 `paid`，并创建或续期 `subscriptions` 记录。
12. WHEN 用户已有有效订阅时续费，THE Payment_Service SHALL 从当前到期时间顺延套餐天数，而非从当前时间计算。

---

### 需求 2：VSCode 插件内触发订阅流程

**用户故事：** 作为 VSCode 插件用户，我希望在插件内直接触发订阅流程，以便无需手动打开浏览器即可完成购买。

#### 验收标准

1. WHEN VSCode_Plugin 检测到用户未订阅或订阅已过期，THE VSCode_Plugin SHALL 在插件 UI 中展示"订阅 DB Player"入口。
2. WHEN 用户在插件内点击订阅入口，THE VSCode_Plugin SHALL 调用 `vscode.env.openExternal` 打开订阅网页 URL，并附加查询参数 `source=vscode`。
3. WHEN 订阅网页检测到 `source=vscode` 参数，THE Frontend SHALL 在支付完成后的重定向流程中，将 URI Scheme 回传地址拼入支付完成跳转逻辑（见需求 3）。
4. THE VSCode_Plugin SHALL 不在本地存储用户的 GitHub OAuth 凭据，所有认证均通过网页完成后经 URI Scheme 传递 JWT。

---

### 需求 3：网页支付完成后唤起 VSCode 插件

**用户故事：** 作为完成网页支付的用户，我希望浏览器自动唤起 VSCode 插件并传递登录凭据，以便无需手动在插件内重新登录。

#### 验收标准

1. WHEN 订阅网页检测到 `source=vscode` 参数且用户已完成登录（持有有效 JWT），THE Frontend SHALL 展示"返回 VSCode"按钮。
2. WHEN 用户点击"返回 VSCode"按钮或支付成功后自动触发，THE Frontend SHALL 构造 URI Scheme `vscode://publisher.db-player/auth?token=<JWT>` 并通过 `window.location.href` 跳转。
3. WHEN VSCode_Plugin 收到 URI Scheme 回调，THE VSCode_Plugin SHALL 从 URL 参数中提取 `token`，将其安全存储于 VSCode `SecretStorage`，并触发订阅状态刷新。
4. IF URI Scheme 中的 `token` 验证失败（格式非法或 JWT 解析错误），THEN THE VSCode_Plugin SHALL 丢弃该 token 并提示用户重新登录。
5. THE VSCode_Plugin SHALL 注册 URI Handler 以处理 `vscode://publisher.db-player/auth` 路径的回调。

---

### 需求 4：VSCode 插件订阅校验

**用户故事：** 作为 VSCode 插件，我需要校验当前用户的订阅有效性，以便决定是否开放付费功能。

#### 验收标准

1. WHEN VSCode_Plugin 启动或用户触发功能时，THE License_Validator SHALL 携带存储的 JWT 调用 `GET /api/verify-license`，获取 `{valid: boolean, expiresAt: number | null}` 响应。
2. WHEN `/api/verify-license` 返回 `{valid: true}`，THE License_Validator SHALL 将校验结果缓存，缓存有效期不超过 1 小时。
3. WHEN `/api/verify-license` 返回 `{valid: false}` 或请求失败，THE License_Validator SHALL 清除本地缓存并将订阅状态标记为无效。
4. WHILE 缓存有效期内，THE License_Validator SHALL 直接使用缓存结果，不重复发起网络请求。
5. IF 本地存储中不存在 JWT，THEN THE License_Validator SHALL 直接返回无效状态，不发起网络请求。
6. THE Backend SHALL 在 `/api/verify-license` 接口中，当 JWT 缺失或无效时返回 HTTP 401 及 `{valid: false}`。
7. THE Backend SHALL 在 `/api/verify-license` 接口中，当订阅存在且未过期时返回 HTTP 200 及 `{valid: true, expiresAt: <Unix 时间戳>}`。

---

### 需求 5：订阅到期提醒

**用户故事：** 作为订阅用户，我希望在订阅即将到期时收到插件内提醒，以便及时续费。

#### 验收标准

1. WHEN License_Validator 获取到 `expiresAt` 且距到期时间不足 7 天，THE VSCode_Plugin SHALL 在 VSCode 通知区域展示到期提醒，包含剩余天数和"立即续费"操作按钮。
2. WHEN 用户点击"立即续费"按钮，THE VSCode_Plugin SHALL 调用 `vscode.env.openExternal` 打开订阅网页并附加 `source=vscode` 参数。
3. THE VSCode_Plugin SHALL 在同一 VSCode 会话中，对同一到期时间的提醒最多展示 1 次，避免重复打扰。
4. WHEN 订阅已过期，THE VSCode_Plugin SHALL 展示订阅已过期通知，并禁用需要订阅的付费功能入口。

---

### 需求 6：认证与安全

**用户故事：** 作为系统，我需要确保所有订阅相关操作均经过身份验证，以防止未授权访问。

#### 验收标准

1. THE Backend SHALL 对所有需要登录的接口（`/api/subscription`、`/api/payment/create`、`/api/payment/order/:orderNo`、`/api/verify-license`）验证 `Authorization: Bearer <JWT>` 头，缺失或无效时返回 HTTP 401。
2. THE Auth_Service SHALL 使用 HS256 算法签发 JWT，设置 issuer 为 `db-player`、audience 为 `db-player-api`、有效期为 7 天。
3. IF JWT 已过期或签名验证失败，THEN THE Backend SHALL 返回 HTTP 401，不执行业务逻辑。
4. THE VSCode_Plugin SHALL 将 JWT 存储于 VSCode `SecretStorage`，不得存储于明文配置文件或 `globalState`。
5. THE Backend SHALL 对支付回调接口（`/api/payment/alipay/notify`、`/api/payment/wxpay/notify`）验证支付平台签名，验签失败时拒绝处理。

---

### 需求 7：订阅状态查询

**用户故事：** 作为已登录用户，我希望随时查询当前订阅状态，以便了解套餐和到期时间。

#### 验收标准

1. WHEN 已认证用户调用 `GET /api/subscription`，THE Backend SHALL 返回 `{success: true, subscription: {active: boolean, plan: string, expiresAt: number | null}}`。
2. WHEN 用户无有效订阅记录，THE Backend SHALL 返回 `{active: false, plan: "free", expiresAt: null}`。
3. WHEN 用户存在多条订阅记录，THE Backend SHALL 取 `expires_at` 最晚的有效记录作为当前订阅状态。
4. THE Backend SHALL 以 Unix 时间戳（秒）格式返回 `expiresAt`，永久订阅时返回 `null`。

---

### 需求 8：支付订单幂等性

**用户故事：** 作为支付系统，我需要确保重复的支付回调不会导致订阅被重复激活。

#### 验收标准

1. WHEN 支付平台重复发送同一订单的回调通知，THE Payment_Service SHALL 检测到订单状态已为 `paid`，直接返回成功响应而不重复激活订阅。
2. THE Payment_Service SHALL 在数据库事务中使用 `SELECT ... FOR UPDATE` 锁定订单行，防止并发回调导致的竞态条件。
3. THE Payment_Service SHALL 在激活订阅时，对同一用户的现有有效订阅执行续期操作，而非创建重复的订阅记录。
