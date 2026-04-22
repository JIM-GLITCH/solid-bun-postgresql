# vscode-http-jsonrpc

NPM module to implement bidirectional communication between a jsonrpc client and server over HTTP + SSE.  
Server can send request too.

## Installation

```bash
pnpm add vscode-http-jsonrpc
```

## Usage

This package is designed as a full-duplex transport: request/notification traffic flows over HTTP POST, while responses and server push messages flow over SSE.

### Server (node.js)

```ts
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createHttpServerMessageConnection } from 'vscode-http-jsonrpc';

//rpcApp is a hono app
const { app: rpcApp, connection } = createHttpServerMessageConnection();
const app = new Hono()
app.route('/xxx', rpcApp);// or app.mount('/xxx',rpcApp.fetch)
serve({ fetch: app.fetch, port: 3000 });


connection.onRequest("ping", async () => {
  const result = await connection.sendRequest("ping")
  console.log(result)
  return "pong from server"
})
connection.listen();



```

### Client (browser/node.js)

```ts
import { createHttpClientMessageConnection } from 'vscode-http-jsonrpc';

const connection = createHttpClientMessageConnection('http://localhost:3000/xxx/');
connection.onRequest('ping', () => 'pong from client');
connection.listen();

const result = await connection.sendRequest("ping")
console.log(result)
```

### Notes

- **Mount path**: The client `baseUrl` must match where you mounted the RPC sub-app (e.g. `http://localhost:3000/xxx` or `http://localhost:3000/xxx/`). **With or without a trailing slash is fine**—the client normalizes the base URL before resolving `rpc` and `sse` endpoints.
- **`listen()` once**: Call `connection.listen()` exactly one time per `MessageConnection`. Calling it again throws `Connection is already listening`.
- **Register handlers before `listen()`**: You **must** register `onRequest` / `onNotification` **before** `listen()`. This ordering is required so every inbound request and notification from the peer is handled correctly; registering handlers afterward is unsafe.
- **Full-duplex example**: The `ping` snippet shows both sides issuing requests over the same connection.

