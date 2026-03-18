import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = __dirname;

export default defineConfig({
  base: "./",
  root,
  optimizeDeps: {
    include: ["solid-js"],
  },
  plugins: [
    solid(),
  ],
  build: {
    outDir: join(__dirname, "out"),
    emptyOutDir: true,
    rollupOptions: {
      input: join(__dirname, "index.html"),
      output: {
        codeSplitting: false
      },
    },
  },

  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/vs": "http://localhost:3001",
    },
    port: 3000,
  },
});
