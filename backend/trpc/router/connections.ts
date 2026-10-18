/**
 * Connections Router
 * 处理数据库连接的保存、删除、更新等操作
 *
 * 业务逻辑复用 `backend/api-core` 的专用函数（单一真源），
 * 这里只做输入校验与 query/mutation 语义划分。
 */

import { t } from '../init';
import { z } from 'zod';
import {
  connectionsList,
  connectionsSave,
  connectionsDelete,
  connectionsUpdateMeta,
  connectionsReorder,
  connectionsGetParams,
  connectionsConnect,
} from '../../api-core';
import type {
  DbKind,
  StoredConnectionParams,
} from '../../../shared/src';

const dbKindSchema = z.enum(['postgres', 'mysql', 'mariadb', 'sqlserver']);

const sshShape = {
  sshEnabled: z.boolean().optional(),
  sshHost: z.string().optional(),
  sshPort: z.string().optional(),
  sshUsername: z.string().optional(),
  sshPassword: z.string().optional(),
  sshPrivateKey: z.string().optional(),
};

/** 已保存连接摘要（返回类型真源） */
export type StoredConnectionSummary = {
  id: string;
  label: string;
  enc?: string;
  name?: string;
  group?: string;
};

export const connectionsRouter = t.router({
  /** 获取已保存的连接列表 */
  list: t.procedure.query(() => connectionsList()),

  /** 保存连接（新建或更新） */
  save: t.procedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().optional(),
        group: z.string().optional(),
        dbType: dbKindSchema.optional(),
        host: z.string(),
        port: z.string(),
        username: z.string(),
        password: z.string(),
        database: z.string(),
        connectionTimeoutSec: z.number().optional(),
        ...sshShape,
      })
    )
    .mutation(({ input }) => connectionsSave(input)),

  /** 删除连接 */
  delete: t.procedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => connectionsDelete(input)),

  /** 更新连接元数据（名称） */
  updateMeta: t.procedure
    .input(z.object({ id: z.string(), name: z.string().optional() }))
    .mutation(({ input }) => connectionsUpdateMeta(input)),

  /** 重新排序连接列表 */
  reorder: t.procedure
    .input(z.object({ list: z.array(z.unknown()) }))
    .mutation(({ input }) => connectionsReorder(input)),

  /** 获取连接参数（用于编辑，含密码） */
  getParams: t.procedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => connectionsGetParams(input)),

  /**
   * 连接数据库（使用已保存的连接参数）
   * `sessionId` 用于区分不同浏览器标签页，关闭标签页时可通过订阅断开释放资源
   */
  connect: t.procedure
    .input(z.object({ id: z.string(), sessionId: z.string().optional() }))
    .mutation(({ input }) => connectionsConnect(input)),
});
