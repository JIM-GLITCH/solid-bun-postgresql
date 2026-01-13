import { SolidPlugin } from "bun-plugin-solid";

// 清空out文件夹再build

await Bun.$`rm out/*`
await Bun.build({
    entrypoints: ["server.ts"],
    outdir: "./out",
    plugins: [SolidPlugin()],
    target: "bun",
    // compile: true,
    sourcemap:true
})
console.log("build finished" )