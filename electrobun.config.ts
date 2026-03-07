/**
 * Electrobun 构建配置（项目根目录）
 * 前端由 Vite 预构建到 dist-electrobun/，此处仅复制（与 Solid 模板一致）
 */
import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Front Table",
    identifier: "dev.fronttable.app",
    version: "0.1.0",
  },
  build: {
    bun: {
      entrypoint: "electrobun-app/src/bun/index.ts",
    },
    copy: {
      "dist-electrobun/index.html": "views/app/index.html",
      "dist-electrobun/index-electrobun.js": "views/app/index-electrobun.js",
    },
    // 使用 CEF 替代系统 WebView2，解决 Windows 高 DPI 下界面模糊（类似 Tauri 的清晰度）
    win: { bundleCEF: true, defaultRenderer: "cef" },
  },
} satisfies ElectrobunConfig;
