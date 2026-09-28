/**
 * tRPC 类型定义（前端安全）
 * 使用 zod 定义类型，避免前端引入 @trpc/server
 */

import { z } from 'zod';

// 定义数据库连接输入 schema
const connectDbInputSchema = z.object({
  connectionId: z.string(),
  dbType: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']),
  host: z.string(),
  port: z.string(),
  database: z.string(),
  username: z.string(),
  password: z.string(),
  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUsername: z.string().optional(),
  sshPassword: z.string().optional(),
  sshPrivateKey: z.string().optional(),
  connectionTimeoutSec: z.number().optional(),
});

// 定义数据库 RPC 基础 schema
const dbRpcBaseSchema = z.object({
  connectionId: z.string(),
  dbType: z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']),
});

// 导出类型（从 zod schema 推导）
export type ConnectDbInput = z.infer<typeof connectDbInputSchema>;
export type DbRpcBase = z.infer<typeof dbRpcBaseSchema>;

// 真实的 AppRouter 类型（单一来源：backend/trpc/server.ts）
export type { AppRouter } from '../../backend/trpc/server';