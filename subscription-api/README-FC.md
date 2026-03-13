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

```bash
cd subscription-api

# 登录 ACR
docker login registry.cn-hangzhou.aliyuncs.com

# 构建（替换 your-namespace 为你的 ACR 命名空间）
docker build -t registry.cn-hangzhou.aliyuncs.com/your-namespace/db-player-subscription:latest .

# 推送
docker push registry.cn-hangzhou.aliyuncs.com/your-namespace/db-player-subscription:latest
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
| API_BASE_URL | API 自身地址（FC 的 HTTP 触发器 URL），用于 GitHub 回调 |

## 5. 配置 VPC（访问 RDS）

若 RDS 在 VPC 内，在 `s.yaml` 中取消注释并填写 `vpcConfig`，将 FC 的 vSwitch 网段加入 RDS 白名单。

## 6. 部署

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

## 8. API 列表

| 路径 | 方法 | 说明 |
|------|------|------|
| /api/health | GET | 健康检查 |
| /api/auth/github | GET | 跳转 GitHub 授权 |
| /api/auth/github/callback | GET | GitHub 回调（自动） |
| /api/subscription | GET | 订阅状态（需 Bearer token） |
