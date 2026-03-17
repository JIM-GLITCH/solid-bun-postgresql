import { defineConfig } from "vite-plus";
import solid from "vite-plugin-solid";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { cpSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const monacoVs = join(root, "node_modules", "monaco-editor", "min", "vs");

export default defineConfig({
  base: "./",
  root,
  plugins: [
    solid(),
    {
      name: "copy-monaco-vs",
      closeBundle() {
        cpSync(monacoVs, join(__dirname, "out", "vs"), { recursive: true });
        console.log("✅ Monaco vs copied to out/vs");
      },
    },
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
  dev:{
  }
});
