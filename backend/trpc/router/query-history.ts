/**
 * Query History Router
 * 查询历史：新增 / 搜索 / 删除 / 清空
 */

import { t } from '../init';
import { z } from 'zod';
import { handleApiRequest } from '../../api-core';

/** 查询历史条目（返回类型真源） */
export interface QueryHistoryEntry {
  id: string;
  sql: string;
  timestamp: number;
  connectionId?: string;
}

export const queryHistoryRouter = t.router({
  /** 新增一条查询历史 */
  add: t.procedure
    .input(z.object({ sql: z.string(), connectionId: z.string().optional() }))
    .mutation(({ input }) => handleApiRequest('query-history/add', input)),

  /** 搜索历史 */
  search: t.procedure
    .input(
      z.object({
        keyword: z.string().optional(),
        since: z.number().optional(),
        until: z.number().optional(),
      })
    )
    .query(
      ({ input }) =>
        handleApiRequest('query-history/search', input) as Promise<QueryHistoryEntry[]>
    ),

  /** 删除单条 */
  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => handleApiRequest('query-history/delete', input)),

  /** 清空全部 */
  clear: t.procedure.mutation(() => handleApiRequest('query-history/clear', {})),
});
