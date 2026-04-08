# 阿里云函数计算部署说明

## 1. 前置条件

- 阿里云账号
- 已创建 RDS PostgreSQL，并执行 `schema.sql`
- 已创建 GitHub OAuth App：https://github.com/settings/developers
- 已开通阿里云容器镜像服务 ACR

## 2. 创建 GitHub OAuth App

1. 进入 GitHub → Settings → Developer settings → OAuth Apps → New OAuth App
2. 填写：
   - Application name: DB Player
   - Homepage URL: 你的前端地址
   - Authorization callback URL: `https://你的FC域名/api/auth/github/callback`
     - 部署后替换为实际 FC HTTP 触发器地址

## 3. 构建并推送镜像

**TS 直接跑，无需编译**：Bun 原生执行 `src/index.ts`，Dockerfile 已配置。

```bash
cd subscription/backend

# 登录 ACR（首次）
docker login registry.cn-hangzhou.aliyuncs.com

# 一键构建+推送（替换 your-namespace 为你的 ACR 命名空间）
ACR_NAMESPACE=your-namespace bun run deploy
```

## 4. 配置环境变量

在 `s.yaml` 或 FC 控制台配置：

| 变量 | 说明 |
|------|------|
| DATABASE_URL | PostgreSQL 连接串 |
| JWT_SECRET | JWT 签名密钥 |
| GITHUB_CLIENT_ID | GitHub OAuth App Client ID |
| GITHUB_CLIENT_SECRET | GitHub OAuth App Secret |
| FRONTEND_URL | 前端地址，登录成功后重定向 |
| API_BASE_URL | API 自身地址（FC 的 HTTP 触发器 URL），用于 GitHub 回调和支付回调 |
| ALIPAY_SANDBOX | true/1/yes=沙箱，否则正式；决定使用下面哪一套凭证 |
| ALIPAY_APP_ID 等 | 正式：`ALIPAY_APP_ID`、`ALIPAY_PRIVATE_KEY`、`ALIPAY_PUBLIC_KEY` |
| ALIPAY_SANDBOX_* | 沙箱：`ALIPAY_SANDBOX_APP_ID`、`ALIPAY_SANDBOX_PRIVATE_KEY`、`ALIPAY_SANDBOX_PUBLIC_KEY` |
| ALIPAY_AES_KEY / ALIPAY_SANDBOX_AES_KEY | 可选；开放平台启用「接口内容加密」时填入 Base64 AES 密钥 |
| WECHAT_APP_ID | 微信支付 AppID |
| WECHAT_MCH_ID | 微信支付商户号 |
| WECHAT_PUBLIC_KEY | 微信支付平台证书公钥（换行用 \n） |
| WECHAT_PRIVATE_KEY | 微信支付商户私钥（换行用 \n） |
| WECHAT_SERIAL_NO | 微信支付平台证书序列号 |

## 5. 配置 VPC（访问 RDS）

若 RDS 在 VPC 内，在 `s.yaml` 中取消注释并填写 `vpcConfig`，将 FC 的 vSwitch 网段加入 RDS 白名单。

## 6. 部署

部署地域默认为**杭州** `cn-hangzhou`（见 `s.yaml` 中 `vars.region`）。修改地域后需重新部署，并把 `API_BASE_URL` 改成对应区域的 FC 域名（如 `*.cn-hangzhou.fcapp.run`）。

```bash
# 安装 Serverless Devs
npm i -g @serverless-devs/s

# 配置阿里云密钥（首次）
s config add

# 部署
s deploy
```

## 7. 本地开发

```bash
bun install
export DATABASE_URL="postgresql://user:pass@localhost:5432/subscription"
export GITHUB_CLIENT_ID=xxx
export GITHUB_CLIENT_SECRET=xxx
export FRONTEND_URL=http://localhost:5173
export API_BASE_URL=http://localhost:9000
bun run dev
```

## 8. 故障排查

### 支付宝签名 `ERR_OSSL_UNSUPPORTED` / `DECODER routines::unsupported`

函数使用 **Node.js 20**（OpenSSL 3）时，个别 **PKCS#1**（`BEGIN RSA PRIVATE KEY`）应用私钥在 `createSign` 阶段会解码失败。`s.yaml` 已默认设置 `NODE_OPTIONS=--openssl-legacy-provider`；若仍报错，请把应用私钥转为 **PKCS#8** 后再写入环境变量：

```bash
openssl pkcs8 -topk8 -inform PEM -in rsa_private.pem -outform PEM -nocrypt -out app_pkcs8.pem
```

PKCS#8 文件头为 `BEGIN PRIVATE KEY`，与 `BEGIN RSA PRIVATE KEY` 不同。转换后需把**对应的应用公钥**重新上传到支付宝开放平台（与私钥仍为同一对）。

## 9. API 列表

| 路径 | 方法 | 说明 |
|------|------|------|
| /api/health | GET | 健康检查 |
| /api/auth/github | GET | 跳转 GitHub 授权 |
| /api/auth/github/callback | GET | GitHub 回调（自动） |
| /api/subscription | GET | 订阅状态（需 Bearer token） |
| /api/payment/create | POST | 创建支付订单（需 Bearer token），body: `{plan, method}` |
| /api/payment/alipay/notify | POST | 支付宝异步回调（支付宝服务器调用） |
| /api/payment/wxpay/notify | POST | 微信支付异步回调（微信服务器调用） |
| /api/payment/order/:orderNo | GET | 查询订单状态（需 Bearer token，前端轮询用） |
| /api/verify-license | GET | VSCode 插件订阅校验（需 Bearer token） |
