import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import path from "path";

export default defineConfig({
  plugins: [solidPlugin()],
  build: {
    outDir: "vscode-extension/media",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "frontend/index-vscode.tsx"),
      output: { entryFileNames: "webview.js" },
    },
  },
  resolve: {
    conditions: ["development", "browser"],
  },
});
