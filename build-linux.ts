import { SolidPlugin } from "bun-plugin-solid";

await Bun.build({
    entrypoints: ["server.ts"],
    outdir: "out",
    plugins: [SolidPlugin()],
    target: "bun",
    compile: {
        target: "bun-linux-x64",
        outfile: "server-linux"
    }
})
console.log("build finished")