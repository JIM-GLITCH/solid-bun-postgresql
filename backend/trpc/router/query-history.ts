/**
 * Query History Router
 * 查询历史：新增 / 搜索 / 删除 / 清空
 *
 * 业务逻辑复用 `backend/api-core` 的专用函数（单一真源），
 * 这里只做输入校验与 query/mutation 语义划分。
 */

import { t } from '../init';
import { z } from 'zod';
import {
  queryHistoryAdd,
  queryHistorySearch,
  queryHistoryDelete,
  queryHistoryClear,
} from '../../api-core';

/** 查询历史条目（返回类型真源） */
export type QueryHistoryEntry = {
  id: string;
  sql: string;
  timestamp: number;
  connectionId?: string;
};

export const queryHistoryRouter = t.router({
  /** 新增一条查询历史 */
  add: t.procedure
    .input(z.object({ sql: z.string(), connectionId: z.string().optional() }))
    .mutation(({ input }) => queryHistoryAdd(input)),

  /** 搜索历史 */
  search: t.procedure
    .input(
      z.object({
        keyword: z.string().optional(),
        since: z.number().optional(),
        until: z.number().optional(),
      })
    )
    .query(({ input }) => queryHistorySearch(input)),

  /** 删除单条 */
  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => queryHistoryDelete(input)),

  /** 清空全部 */
  clear: t.procedure.mutation(() => queryHistoryClear()),
});
