import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const testDir = __dirname;
const rootDir = path.resolve(testDir, '..', '..');
const tsxCli = path.join(rootDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const serverEntry = path.join(testDir, 'server.ts');
const clientEntry = path.join(testDir, 'client.ts');

function wireLogs(name: string, child: ChildProcess) {
  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[${name}][stdout] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[${name}][stderr] ${chunk}`);
  });
  child.on('exit', (code, signal) => {
    console.log(`[${name}] exited with code=${code} signal=${signal ?? 'null'}`);
  });
}

function killChild(child: ChildProcess | undefined) {
  if (!child || child.killed) {
    return;
  }
  child.kill('SIGTERM');
}

async function main() {
  let serverProc: ChildProcess | undefined;
  let clientProc: ChildProcess | undefined;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    killChild(clientProc);
    killChild(serverProc);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);

  serverProc = spawn("bun", [ serverEntry], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      PORT: process.env.PORT ?? '3000',
    },
  });
  wireLogs('server', serverProc);

  // 给 server 一点启动时间，避免 client 首次连接过早失败。
  await new Promise((resolve) => setTimeout(resolve, 800));

  clientProc = spawn("bun", [ clientEntry], {
    cwd: rootDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  wireLogs('client', clientProc);

  await new Promise<void>((resolve) => {
    clientProc?.once('exit', () => resolve());
  });

  cleanup();
}

main().catch((error) => {
  console.error('[runner] failed:', error);
  process.exitCode = 1;
});
