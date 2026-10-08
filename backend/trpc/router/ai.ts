/**
 * AI Router
 * AI 配置 / Key 删除 / 连通性测试 / SQL 编辑与 Prompt 构建
 *
 * 返回类型在此集中标注（`handleApiRequest` 返回 `unknown`），供前端直接调用时推断。
 */

import { t } from '../init';
import { z } from 'zod';
import { handleApiRequest } from '../../api-core';

const aiApiMode = z.enum(['openai-compatible', 'anthropic']);

export const aiRouter = t.router({
  /** 读取 AI 运行配置 */
  configGet: t.procedure.query(
    () =>
      handleApiRequest('ai/config/get', {}) as Promise<{
        apiMode: 'openai-compatible' | 'anthropic';
        baseUrl?: string;
        model: string;
        keyRef: string;
        temperature: number;
        topP?: number;
        stream?: boolean;
        maxTokens: number;
        hasKey: boolean;
      }>
  ),

  /** 写入 AI 运行配置 */
  configSet: t.procedure
    .input(
      z.object({
        apiMode: aiApiMode,
        baseUrl: z.string().optional(),
        model: z.string(),
        keyRef: z.string().optional(),
        apiKey: z.string().optional(),
        temperature: z.number().optional(),
        topP: z.number().optional(),
        stream: z.boolean().optional(),
        maxTokens: z.number().optional(),
      })
    )
    .mutation(
      ({ input }) => handleApiRequest('ai/config/set', input) as Promise<{ success: boolean }>
    ),

  /** 删除已保存的 API Key */
  keyDelete: t.procedure
    .input(z.object({ keyRef: z.string().optional() }).optional())
    .mutation(
      ({ input }) => handleApiRequest('ai/key/delete', input ?? {}) as Promise<{ success: boolean }>
    ),

  /** 测试 AI 连通性 */
  testConnection: t.procedure
    .input(
      z
        .object({
          apiMode: aiApiMode.optional(),
          baseUrl: z.string().optional(),
          model: z.string().optional(),
          keyRef: z.string().optional(),
          temperature: z.number().optional(),
          topP: z.number().optional(),
          stream: z.boolean().optional(),
          maxTokens: z.number().optional(),
        })
        .optional()
    )
    .mutation(
      ({ input }) =>
        handleApiRequest('ai/test-connection', input ?? {}) as Promise<{ success: boolean }>
    ),

  /** AI 编辑 SQL */
  sqlEdit: t.procedure
    .input(
      z.object({
        connectionId: z.string(),
        sql: z.string(),
        instructions: z.string().optional(),
        keyRef: z.string().optional(),
        schema: z.string().optional(),
      })
    )
    .mutation(
      ({ input }) =>
        handleApiRequest('ai/sql-edit', input) as Promise<{
          sql: string;
          rationale: string;
          warnings: string[];
          alternatives?: string[];
          usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
          elapsedMs?: number;
          schemaInjected?: string[];
        }>
    ),

  /** 构建编辑用 prompt */
  promptBuild: t.procedure
    .input(
      z.object({
        connectionId: z.string(),
        sql: z.string(),
        schema: z.string().optional(),
        instructions: z.string().optional(),
      })
    )
    .mutation(
      ({ input }) =>
        handleApiRequest('ai/prompt-build', input) as Promise<{
          prompt: string;
          schemaInjected?: string[];
        }>
    ),

  /** 构建 diff 用 prompt */
  promptBuildDiff: t.procedure
    .input(
      z.object({
        connectionId: z.string(),
        sql: z.string(),
        schema: z.string().optional(),
      })
    )
    .mutation(
      ({ input }) =>
        handleApiRequest('ai/prompt-build-diff', input) as Promise<{
          prompt: string;
          schemaInjected?: string[];
        }>
    ),
});
