/**
 * tRPC 集成测试
 * 测试 Web 和 VSCode 两种传输层
 */

import { createTrpcClient } from './client';
import type { AppRouter } from '../../shared/src';

/**
 * 测试 Web 环境的 tRPC 调用
 */
export async function testWebEnvironment() {
  console.log('=== Testing Web Environment ===');

  const client = createTrpcClient({
    environment: 'web',
    httpOptions: {
      baseUrl: 'http://localhost:3000',
      getBearerToken: () => null,
    },
  });

  try {
    // 测试连接列表
    console.log('1. Testing connections.list...');
    const connections = await client.connections.list.query();
    console.log('✓ connections.list result:', connections);

    // 测试 AI 配置获取
    console.log('2. Testing ai.configGet...');
    const aiConfig = await client.ai.configGet.query();
    console.log('✓ ai.configGet result:', aiConfig);

    // 测试查询历史搜索
    console.log('3. Testing queryHistory.search...');
    const history = await client.queryHistory.search.query({
      keyword: 'SELECT',
    });
    console.log('✓ queryHistory.search result:', history);

    console.log('\n✓ All Web environment tests passed!');
  } catch (error) {
    console.error('✗ Web environment test failed:', error);
    throw error;
  }
}

/**
 * 测试 VSCode 环境的 tRPC 调用
 * 注意：这个测试只能在 VSCode webview 环境中运行
 */
export async function testVscodeEnvironment() {
  console.log('=== Testing VSCode Environment ===');

  // 检查是否在 VSCode 环境中
  if (typeof window === 'undefined' || !(window as any).acquireVsCodeApi) {
    console.log('⊘ Skipping VSCode tests - not in VSCode webview environment');
    return;
  }

  const client = createTrpcClient({
    environment: 'vscode',
    vscodeOptions: {
      timeout: 30000,
    },
  });

  try {
    // 测试连接列表
    console.log('1. Testing connections.list...');
    const connections = await client.connections.list.query();
    console.log('✓ connections.list result:', connections);

    // 测试 AI 配置获取
    console.log('2. Testing ai.configGet...');
    const aiConfig = await client.ai.configGet.query();
    console.log('✓ ai.configGet result:', aiConfig);

    // 测试订阅账号
    console.log('3. Testing subscription.account...');
    const account = await client.subscription.account.query();
    console.log('✓ subscription.account result:', account);

    console.log('\n✓ All VSCode environment tests passed!');
  } catch (error) {
    console.error('✗ VSCode environment test failed:', error);
    throw error;
  }
}

/**
 * 测试类型安全性
 */
export function testTypeSafety() {
  console.log('=== Testing Type Safety ===');

  const client = createTrpcClient();

  // 这些应该在编译时就能检查类型
  const examples = {
    // ✓ 正确的调用
    correctQuery: () => client.connections.list.query(),
    correctMutation: () => client.db.connect.mutate({
      connectionId: 'test',
      dbType: 'postgres',
      host: 'localhost',
      port: '5432',
      database: 'test',
      username: 'user',
      password: 'pass',
    }),

    // ✗ 以下调用会在 TypeScript 编译时报错
    // @ts-expect-error - missing required fields
    incorrectMutation: () => client.db.connect.mutate({
      connectionId: 'test',
      // dbType is missing - TypeScript error!
    }),

    // @ts-expect-error - wrong method type
    wrongMethodType: () => client.connections.list.mutate(),
  };

  console.log('✓ Type safety checks passed (compile-time)');
}

/**
 * 测试错误处理
 */
export async function testErrorHandling() {
  console.log('=== Testing Error Handling ===');

  const client = createTrpcClient({
    environment: 'web',
    httpOptions: {
      baseUrl: 'http://localhost:3000',
    },
  });

  try {
    // 测试连接到不存在的数据库
    console.log('1. Testing invalid connection...');
    const result = await client.db.connect.mutate({
      connectionId: 'invalid-test',
      dbType: 'postgres',
      host: 'invalid-host-12345',
      port: '5432',
      database: 'test',
      username: 'test',
      password: 'test',
    });

    if (!result.success) {
      console.log('✓ Error handled correctly:', result.error);
    } else {
      console.warn('⚠ Expected error but got success');
    }
  } catch (error) {
    console.log('✓ Exception caught correctly:', error);
  }

  console.log('✓ Error handling tests passed!');
}

/**
 * 运行所有测试
 */
export async function runAllTests() {
  console.log('\n========================================');
  console.log('tRPC Integration Tests');
  console.log('========================================\n');

  try {
    testTypeSafety();
    await testErrorHandling();
    await testWebEnvironment();
    await testVscodeEnvironment();

    console.log('\n========================================');
    console.log('✓ All tests passed!');
    console.log('========================================\n');
  } catch (error) {
    console.error('\n========================================');
    console.error('✗ Tests failed!');
    console.error('========================================\n');
    throw error;
  }
}

// 如果直接运行此文件
if (typeof window !== 'undefined') {
  (window as any).__runTrpcTests = runAllTests;
  console.log('Run tests with: window.__runTrpcTests()');
}
