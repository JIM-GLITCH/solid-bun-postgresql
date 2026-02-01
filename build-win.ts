import { SolidPlugin } from "bun-plugin-solid";


await Bun.build({
    entrypoints: ["server.ts"],
    outdir: "out",
    plugins: [SolidPlugin()],
    target: "bun",
    compile: {
        target: "bun-windows-x64",
        outfile: "server-win.exe"
    }
})
console.log("build finished")