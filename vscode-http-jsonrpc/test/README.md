# vscode-http-jsonrpc 本地联调示例

这个目录包含一个最小后端和最小前端（客户端）用于测试你的 HTTP + SSE JSON-RPC 通道是否可用。

## 文件说明

- `server.ts`: 启动 Hono + JSON-RPC 服务，提供：
  - `demo/echo`：回显字符串
  - `demo/sum`：计算两个数字之和
- `client.ts`: 作为前端客户端连接服务端，发起请求并打印结果。

## 运行方式

### 快速一条命令联调（推荐）

```bash
pnpm tsx vscode-http-jsonrpc/test/frontend-interaction.ts
```

这个脚本会在同一进程里启动 server 和模拟前端 client，然后打印两端交互日志并自动退出。

### 真实浏览器前端联调（TS 前端）

1. 启动 server（使用 `server.ts`）：

```bash
bun vscode-http-jsonrpc/test/server.ts
```

2. 浏览器打开首页：

```text
http://localhost:3000/
```

前端代码在 `frontend-client.ts`，页面 `index.html` 会加载 `/frontend-client.js`。  
`/frontend-client.js` 由 server 在运行时用 Bun 打包 TS 后输出，前端内部使用 `createHttpClientMessageConnection` 进行交互测试。

### 分开两个终端联调

1. 启动服务端（终端 1）：

```bash
pnpm tsx vscode-http-jsonrpc/test/server.ts
```

如遇 `3000` 端口占用，可换端口启动（PowerShell）：

```bash
$env:PORT=3100; pnpm tsx vscode-http-jsonrpc/test/server.ts
```

2. 启动客户端（终端 2）：

```bash
pnpm tsx vscode-http-jsonrpc/test/client.ts
```

## 预期输出

客户端应输出类似：

- `[client] echo result: [server] hello http json-rpc`
- `[client] sum result: 42`

服务端会看到：

- `[server] 收到 ping: ...`
