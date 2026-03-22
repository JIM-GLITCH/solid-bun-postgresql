import path from "path";

await Bun.build({
    entrypoints: [path.join(import.meta.dirname, "src/index.ts")],
    target: "node",
    outdir: path.join(import.meta.dirname, "out"),
    format: "cjs",
});

// FC 运行时需要 package.json
await Bun.write(
    path.join(import.meta.dirname, "out/package.json"),
    JSON.stringify({ name: "subscription-api", version: "1.0.0" }, null, 2)
);

console.log("subscription/backend/out/index.js")
