import { SolidPlugin } from "bun-plugin-solid";
import { join } from "path";

const standaloneDir = import.meta.dir;

await Bun.build({
  entrypoints: [join(standaloneDir, "server.ts")],
  outdir: join(standaloneDir, "out"),
  plugins: [SolidPlugin()],
  target: "bun",
  compile: {
    target: "bun-linux-x64",
    outfile: "server-linux"
  }
});
console.log("build finished");
