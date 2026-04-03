import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;
const htmlEntry = join(__dirname, "index.html");

export default defineConfig({
  base: "./",
  root,
  optimizeDeps: {
    include: ["solid-js"],
    /** 先起 dev server，再在后台扫依赖，首屏可交互更早 */
    holdUntilCrawlEnd: false,
    /** 只从入口 HTML 爬依赖，避免误扫到无关目录 */
    entries: [htmlEntry],
  },
  plugins: [
    solid(),
  ],
  build: {
    outDir: join(__dirname, "out"),
    emptyOutDir: true,
    rollupOptions: {
      input: htmlEntry,
      output: {
        codeSplitting: false
      },
    },
  },

  server: {
    proxy: {
      "/api": "http://127.0.0.1:3001",
      "/vs": "http://127.0.0.1:3001",
    },
    port: 3000,
    /** 启动时预转换入口，减轻第一次打开页面的等待 */
    warmup: {
      clientFiles: ["./index.html", "./frontend/index.tsx"],
    },
  },
});
