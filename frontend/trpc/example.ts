/**
 * tRPC Client 使用示例
 * 展示如何使用新的 tRPC client 替代旧的 API 调用
 */

import { getTrpcClient, createTrpcClient } from './client';
import type { ConnectDbInput, DbKind } from '../../shared/src';

/**
 * 旧方式：使用现有的 API 封装
 */
export async function connectDatabaseOld(
  connectionId: string,
  params: any,
  dbType: DbKind = "postgres"
) {
  // 旧的方式：使用 frontend/api.ts 中的函数
  // const res = await connectPostgres(connectionId, params, dbType);
  // return res;
  console.log('Old API call - connectPostgres');
  return { success: false };
}

/**
 * 新方式：使用 tRPC client（完全类型安全）
 */
export async function connectDatabaseNew(
  connectionId: string,
  params: any,
  dbType: DbKind = "postgres"
) {
  const trpc = getTrpcClient();
  
  // 完全类型安全的调用
  const result = await trpc.db.connect.mutate({
    connectionId,
    ...params,
    dbType,
  });
  
  // TypeScript 会自动推断返回类型
  // result: { success: boolean; error?: string; dbType?: string }
  return result;
}

/**
 * 其他 API 调用示例
 */
export async function exampleApiCalls() {
  const trpc = getTrpcClient();

  // 1. 获取连接列表
  const connections = await trpc.connections.list.query();
  // connections: { items?: any[]; error?: string }

  // 2. 获取数据库能力
  const capabilities = await trpc.db.capabilities.query({
    connectionId: 'test-connection',
    dbType: 'postgres',
  });
  // capabilities: { capabilities: any; error?: string }

  // 3. 断开连接
  const disconnectResult = await trpc.db.disconnect.mutate({
    connectionId: 'test-connection',
    dbType: 'postgres',
  });
  // disconnectResult: { success: boolean; error?: string }

  // 4. AI 配置
  const aiConfig = await trpc.ai.configGet.query();
  // aiConfig: { apiMode: string; model: string; ... }

  const aiConfigSetResult = await trpc.ai.configSet.mutate({
    apiMode: 'openai-compatible',
    model: 'gpt-4',
    keyRef: 'test-key',
  });
  // aiConfigSetResult: { success?: boolean; error?: string }
}

/**
 * 渐进式迁移示例
 * 可以逐步将旧 API 替换为 tRPC 调用
 */
export class DatabaseService {
  private trpc = getTrpcClient();

  async connect(params: ConnectDbInput) {
    // 新方式：tRPC
    return await this.trpc.db.connect.mutate(params);
  }

  async disconnect(params: { connectionId: string; dbType: DbKind }) {
    // 新方式：tRPC
    return await this.trpc.db.disconnect.mutate(params);
  }

  async getCapabilities(params: { connectionId: string; dbType: DbKind }) {
    // 新方式：tRPC
    return await this.trpc.db.capabilities.query(params);
  }

  // 保留一些旧的 API 作为过渡
  async legacyConnect(connectionId: string, params: any, dbType: DbKind) {
    // 旧方式：可以调用现有的 API
    // return await connectPostgres(connectionId, params, dbType);
    console.log('Legacy API call');
    return { success: false };
  }
}

/**
 * 环境检测示例
 */
export function environmentExample() {
  // 1. 自动检测环境
  const autoClient = getTrpcClient();
  console.log('Auto-detected environment client created');

  // 2. 指定环境
  const webClient = createTrpcClient({ 
    environment: 'web',
    httpOptions: {
      baseUrl: '',
      getBearerToken: () => localStorage.getItem('token') || null,
    }
  });

  const vscodeClient = createTrpcClient({ 
    environment: 'vscode',
    vscodeOptions: {
      timeout: 60000, // VSCode 环境可以使用更长的超时
    }
  });

  console.log('Environment-specific clients created');
}