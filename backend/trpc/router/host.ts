/**
 * Host Router —— 宿主能力（文件 / 剪贴板 / AI Key）。
 *
 * 这些能力只存在于宿主环境（VS Code 扩展），但为了让前端只有 **一个调用面**（tRPC），
 * 它们同样被建模为 procedure：
 * - 服务端默认实现一律抛 `METHOD_NOT_SUPPORTED`（浏览器 / Standalone 落到「不支持」，
 *   调用方据此回退到浏览器下载 / 本地文件选择）；
 * - VSCode 扩展宿主在 `createWebviewRpcBridge` 的 `procedureOverrides` 里按 path 覆盖成
 *   真实的 `vscode.*` API（见 `vscode-extension/src/extension.ts`）。
 */

import { t } from '../init';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';

/** 另存为结果：`cancelled` 表示用户取消 */
export type HostSaveFileResult = { success?: boolean; cancelled?: boolean };
/** 打开文件结果：文件为文本或 base64（二进制） */
export type HostReadFileResult = {
  cancelled?: boolean;
  content?: string;
  filename?: string;
  contentBase64?: string;
};
export type HostClipboardWriteResult = { success?: boolean };
export type HostClipboardReadResult = { text: string };
export type HostAiKeyResult = { success: boolean };

/** 服务端默认实现：宿主能力在服务端不存在 */
function unsupported(capability: string): never {
  throw new TRPCError({
    code: 'METHOD_NOT_SUPPORTED',
    message: `当前环境不支持宿主能力：${capability}`,
  });
}

export const hostRouter = t.router({
  /** 另存为（扩展 `showSaveDialog` + 写盘） */
  saveFile: t.procedure
    .input(z.object({ content: z.string(), filename: z.string(), isBase64: z.boolean().optional() }))
    .mutation((): HostSaveFileResult => unsupported('host.saveFile')),

  /** 打开文件选择器并读取内容 */
  readFile: t.procedure
    .input(z.object({ accept: z.array(z.string()).optional() }))
    .mutation((): HostReadFileResult => unsupported('host.readFile')),

  /** 写入系统剪贴板 */
  clipboardWrite: t.procedure
    .input(z.object({ text: z.string() }))
    .mutation((): HostClipboardWriteResult => unsupported('host.clipboardWrite')),

  /** 读取系统剪贴板 */
  clipboardRead: t.procedure.query((): HostClipboardReadResult => unsupported('host.clipboardRead')),

  /** 写入扩展 SecretStorage */
  aiKeySet: t.procedure
    .input(z.object({ keyRef: z.string(), apiKey: z.string() }))
    .mutation((): HostAiKeyResult => unsupported('host.aiKeySet')),

  /** 删除扩展 SecretStorage 中的 key */
  aiKeyDelete: t.procedure
    .input(z.object({ keyRef: z.string() }))
    .mutation((): HostAiKeyResult => unsupported('host.aiKeyDelete')),
});
