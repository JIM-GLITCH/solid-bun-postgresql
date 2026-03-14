# DB Player 订阅购买页

静态页面，可部署到 OSS 或任意静态托管。

## 本地预览

```bash
# 方式 1：用 Python
python -m http.server 8080

# 方式 2：用 Bun
bunx serve .

# 方式 3：用 npx
npx serve .
```

访问 http://localhost:8080

## 部署前配置

编辑 `config.js`，将 `API_URL` 改为你的订阅 API 地址：

```js
window.DBPLAYER_API_URL = 'https://你的FC域名';
```

## 部署到 OSS

1. 上传 `index.html`、`styles.css`、`app.js`、`config.js` 到 OSS Bucket
2. 开启静态网站托管，默认首页设为 `index.html`
3. 确保 subscription/backend 的 CORS 允许跨域（已配置 `origin: "*"`）

## 页面说明

- **用 GitHub 登录**：跳转到订阅 API 的 GitHub OAuth
- **订阅状态**：登录后显示当前是否已订阅
- **立即订阅 / 年付**：支付接口待接入，当前为占位
