/**
 * AI Router
 * AI 配置 / Key 删除 / 连通性测试 / SQL 编辑与 Prompt 构建
 *
 * 业务逻辑复用 `backend/api-core` 的专用函数（单一真源），
 * 这里只做输入校验与 query/mutation 语义划分。
 */

import { t } from '../init';
import { z } from 'zod';
import {
  aiConfigGet,
  aiConfigSet,
  aiKeyDelete,
  aiTestConnection,
  aiSqlEdit,
  aiPromptBuild,
  aiPromptBuildDiff,
} from '../../api-core';

const aiApiMode = z.enum(['openai-compatible', 'anthropic']);

export const aiRouter = t.router({
  /** 读取 AI 运行配置 */
  configGet: t.procedure.query(() => aiConfigGet()),

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
    .mutation(({ input }) => aiConfigSet(input)),

  /** 删除已保存的 API Key */
  keyDelete: t.procedure
    .input(z.object({ keyRef: z.string().optional() }).optional())
    .mutation(({ input }) => aiKeyDelete(input)),

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
    .mutation(({ input }) => aiTestConnection(input)),

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
    .mutation(({ input }) => aiSqlEdit(input)),

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
    .mutation(({ input }) => aiPromptBuild(input)),

  /** 构建 diff 用 prompt */
  promptBuildDiff: t.procedure
    .input(
      z.object({
        connectionId: z.string(),
        sql: z.string(),
        schema: z.string().optional(),
      })
    )
    .mutation(({ input }) => aiPromptBuildDiff(input)),
});
