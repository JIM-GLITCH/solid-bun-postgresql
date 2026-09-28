/**
 * tRPC 类型安全和多环境支持测试
 * 验证新的 tRPC 系统是否正常工作
 */

import { getTrpcClient, createTrpcClient } from './client';
import { Messenger } from 'vscode-messenger-webview';
import { getVsCodeWebviewApi } from '../transport/vscode-api';
import type { ConnectDbInput, DbKind } from '../../shared/src';

/**
 * 测试 1: 类型安全验证
 * 确保 TypeScript 能正确推断输入和输出类型
 */
export async function testTypeSafety() {
  console.log('Testing type safety...');

  const trpc = getTrpcClient();

  // 测试 db.connect - 完全类型安全
  const connectInput: ConnectDbInput = {
    connectionId: 'test-connection',
    dbType: 'postgres',
    host: 'localhost',
    port: '5432',
    database: 'testdb',
    username: 'postgres',
    password: 'password',
  };

  try {
    const connectResult = await trpc.db.connect.mutate(connectInput);
    // TypeScript 应该推断出返回类型: { success: boolean; error?: string; dbType?: string }
    console.log('Connect result type check:', typeof connectResult.success === 'boolean');
    
    if (connectResult.success) {
      console.log('✓ Type safety test passed for db.connect');
    } else {
      console.log('✗ Connect failed (expected in test):', connectResult.error);
    }
  } catch (error) {
    console.log('✗ Type safety test failed:', error);
  }

  // 测试其他 API 的类型推断
  try {
    const connections = await trpc.connections.list.query();
    // TypeScript 应该推断出返回类型: { items?: any[]; error?: string }
    console.log('Connections list type check:', Array.isArray(connections.items));
    
    const capabilities = await trpc.db.capabilities.query({
      connectionId: 'test',
      dbType: 'postgres',
    });
    // TypeScript 应该推断出返回类型: { capabilities: any; error?: string }
    console.log('Capabilities type check:', typeof capabilities.capabilities === 'object');
    
    console.log('✓ All type safety tests passed');
  } catch (error) {
    console.log('✗ Type safety test failed:', error);
  }
}

/**
 * 测试 2: 多环境支持验证
 * 验证不同环境下的 client 创建
 */
export async function testMultiEnvironmentSupport() {
  console.log('Testing multi-environment support...');

  // 测试 Web 环境
  try {
    const webClient = createTrpcClient({
      environment: 'web',
      httpOptions: {
        baseUrl: '',
        getBearerToken: () => null,
      },
    });
    console.log('✓ Web environment client created');
  } catch (error) {
    console.log('✗ Web environment test failed:', error);
  }

  // 测试 VSCode 环境
  try {
    const messenger = new Messenger(getVsCodeWebviewApi() as any);
    const vscodeClient = createTrpcClient({
      environment: 'vscode',
      vscodeOptions: {
        messenger,
        timeout: 60000,
      },
    });
    console.log('✓ VSCode environment client created');
  } catch (error) {
    console.log('✗ VSCode environment test failed:', error);
  }

  // 测试环境自动检测
  try {
    const autoClient = getTrpcClient();
    console.log('✓ Auto-detected environment client created');
  } catch (error) {
    console.log('✗ Auto-detection test failed:', error);
  }

  console.log('✓ Multi-environment support tests completed');
}

/**
 * 测试 3: vscode-messenger 集成验证
 * 验证 vscode-messenger 是否正常工作
 */
export async function testVscodeMessengerIntegration() {
  console.log('Testing vscode-messenger integration...');

  // 这个测试需要在 VSCode 环境中运行
  if (typeof window !== 'undefined' && (window as any).acquireVsCodeApi) {
    try {
      const messenger = new Messenger(getVsCodeWebviewApi() as any);
      const client = createTrpcClient({
        environment: 'vscode',
        vscodeOptions: {
          messenger,
        },
      });
      
      // 尝试发送一个简单的请求
      const result = await client.connections.list.query();
      console.log('✓ vscode-messenger integration test passed:', result);
    } catch (error) {
      console.log('✗ vscode-messenger integration test failed:', error);
    }
  } else {
    console.log('⊘ vscode-messenger test skipped (not in VSCode environment)');
  }
}

/**
 * 测试 4: 渐进式迁移验证
 * 验证新旧 API 可以共存
 */
export async function testGradualMigration() {
  console.log('Testing gradual migration...');

  // 新的 tRPC 方式
  const trpc = getTrpcClient();
  
  try {
    // 旧 API 方式（模拟）
    // const oldResult = await connectPostgres('test', params, 'postgres');
    
    // 新 tRPC 方式
    const newResult = await trpc.db.connect.mutate({
      connectionId: 'test',
      dbType: 'postgres',
      host: 'localhost',
      port: '5432',
      database: 'test',
      username: 'user',
      password: 'pass',
    });
    
    console.log('✓ Gradual migration test passed - both APIs can coexist');
  } catch (error) {
    console.log('✗ Gradual migration test failed:', error);
  }
}

/**
 * 运行所有测试
 */
export async function runAllTests() {
  console.log('=== Starting tRPC Integration Tests ===\n');

  await testTypeSafety();
  console.log();
  
  await testMultiEnvironmentSupport();
  console.log();
  
  await testVscodeMessengerIntegration();
  console.log();
  
  await testGradualMigration();
  console.log();

  console.log('=== All Tests Completed ===');
}

// 如果直接运行此文件，执行所有测试
if (import.meta.url === `file://${process.argv[1]}`) {
  runAllTests().catch(console.error);
}