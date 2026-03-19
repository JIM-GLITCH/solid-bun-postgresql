// ========== 配置区 ==========
// 前置：本机需安装 Docker（用于在容器内构建 Linux 版）；ECS 无需 Docker/Node
const ECS_HOST = process.env.ECS_HOST || "your-ecs-ip";
const ECS_KEY = process.env.ECS_KEY || "~/.ssh/id_rsa";

async function main() {
  console.log("🚀 开始部署流程...\n");

  // Step 1: 本地编译（含 Docker 构建 Linux 可执行文件）
  console.log("📦 [1/4] 编译（含 Docker 构建 Linux 版）...");
  const buildProc = Bun.spawn(["bun", "standalone/build-sea-linux.ts"], {
    cwd: import.meta.dir + "/..",
    stdout: "inherit",
    stderr: "inherit",
  });
  const ok = await buildProc.exited;
  if (ok !== 0) throw new Error(`Build failed with exit code ${ok}`);
  console.log("✅ 编译完成\n");

  // Step 2: 停止服务、上传到临时文件、替换（避免覆盖正在运行的二进制导致 scp 失败）
  console.log("🔪 [2/4] 停止服务并上传...");
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "fuser -k 3000/tcp 2>/dev/null || true"`;
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "sleep 2"`;
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "mkdir -p /services"`;
  await Bun.$`scp -i ${ECS_KEY} ./standalone/out/solid-project-sea root@${ECS_HOST}:/services/solid-project-sea.new`;
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "rm -f /services/solid-project-sea"`;
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "mv /services/solid-project-sea.new /services/solid-project-sea"`;
  console.log("✅ 上传完成\n");

  // Step 3: 添加执行权限
  console.log("🔑 [3/4] 添加执行权限...");
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "chmod +x /services/solid-project-sea"`;
  console.log("✅ 权限已添加\n");

  // Step 4: 启动服务
  console.log("🚀 [4/4] 启动服务...");
  const startCmd = " nohup /services/solid-project-sea > /services/server.log 2>&1 </dev/null &";
  await Bun.$`ssh -T -i ${ECS_KEY} root@${ECS_HOST} ${startCmd}`;
  console.log("✅ 服务已启动\n");

  console.log("🎉 部署完成！");
}

main().catch((err) => {
  console.error("❌ 部署失败:", err.message);
  process.exit(1);
});
