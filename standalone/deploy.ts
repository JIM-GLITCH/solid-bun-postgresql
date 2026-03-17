// ========== 配置区 ==========
const ECS_HOST = process.env.ECS_HOST || "your-ecs-ip";
const ECS_KEY = process.env.ECS_KEY || "~/.ssh/id_rsa";

async function main() {
  console.log("🚀 开始部署流程...\n");

  // Step 1: 编译 Linux 可执行程序 (pkg 支持跨平台编译)
  console.log("📦 [1/5] 编译 Linux 可执行程序 (pkg)...");
  const buildProc = Bun.spawn(["bun", "standalone/build-pkg.ts"], {
    cwd: import.meta.dir + "/..",
    env: { ...process.env, BUILD_TARGET: "linux" },
    stdout: "inherit",
    stderr: "inherit",
  });
  const ok = await buildProc.exited;
  if (ok !== 0) throw new Error(`Build failed with exit code ${ok}`);
  console.log("✅ 编译完成\n");

  // Step 2: Kill 3000 端口的程序
  console.log("🔪 [2/5] 停止 3000 端口的服务...");
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "fuser -k 3000/tcp || true"`;
  console.log("✅ 服务已停止\n");

  // Step 3: 删除旧文件并上传新文件
  console.log(`📤 [3/5] 删除旧文件并上传新文件到 root@${ECS_HOST}:/services...`);
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "rm -f /services/server-linux"`;
  await Bun.$`scp -i ${ECS_KEY} ./standalone/out/server-linux root@${ECS_HOST}:/services/server-linux`;
  console.log("✅ 上传完成\n");

  // Step 4: 添加执行权限
  console.log("🔑 [4/5] 添加执行权限...");
  await Bun.$`ssh -i ${ECS_KEY} root@${ECS_HOST} "chmod +x /services/server-linux"`;
  console.log("✅ 权限已添加\n");

  // Step 5: 启动服务
  console.log("🚀 [5/5] 启动服务...");
  const startCmd = " nohup /services/server-linux > server.log 2>&1 </dev/null &";
  await Bun.$`ssh -T -i ${ECS_KEY} root@${ECS_HOST} ${startCmd}`;
  console.log("✅ 服务已启动\n");

  console.log("🎉 部署完成！");
}

main().catch((err) => {
  console.error("❌ 部署失败:", err.message);
  process.exit(1);
});
