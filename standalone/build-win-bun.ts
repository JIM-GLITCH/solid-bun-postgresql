import { SolidPlugin } from "bun-plugin-solid";
import { join } from "path";

const standaloneDir = import.meta.dir;

await Bun.build({
  entrypoints: [join(standaloneDir, "server.ts")],
  outdir: join(standaloneDir, "out"),
  plugins: [SolidPlugin()],
  target: "bun",
  external: ["cpu-features"], // ssh2 的可选依赖，原生模块无法打包
  compile: {
    target: "bun-windows-x64",
    outfile: "server-win.exe"
  }
});
console.log("build finished");
