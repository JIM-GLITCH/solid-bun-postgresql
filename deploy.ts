import { SolidPlugin } from "bun-plugin-solid";

// ========== 配置区 ==========
const ECS_HOST = process.env.ECS_HOST || "your-ecs-ip";           // 阿里云 ECS 公网 IP
const ECS_KEY = process.env.ECS_KEY || "~/.ssh/id_rsa";          // SSH 私钥路径

async function main() {
    console.log("🚀 开始部署流程...\n");

    // Step 1: 一步构建 - 使用 splitting: false 和 naming 配置
    console.log("📦 [1/4] 编译 Linux 可执行程序...");
    await Bun.$`rm -rf out/*`.nothrow();

    const result = await Bun.build({
        entrypoints: ["server.ts"],
        outdir: "out",
        plugins: [SolidPlugin()],
        target: "bun",
        compile:{
            "outfile":"server-linux",
            "target":"bun-linux-x64"
        }
    });

    if (!result.success) {
        console.error("打包失败:", result.logs);
        process.exit(1);
    }

    console.log("✅ 编译完成\n");

    // Step 2: 上传到阿里云 ECS
    console.log(`📤 [2/4] 上传文件到 root@${ECS_HOST}:/services...`);

    // 先确保远程目录存在
    await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "mkdir -p /services"`;

    // 上传可执行文件
    await Bun.$`scp -i ${ECS_KEY} ./out/server-linux root@${ECS_HOST}:/services/server-linux`;

    console.log("✅ 上传完成\n");

}

main().catch((err) => {
    console.error("❌ 部署失败:", err.message);
    process.exit(1);
});
