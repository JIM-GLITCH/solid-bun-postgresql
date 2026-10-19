/**
 * electrobun 未随包发布类型声明（package.json 的 exports 仅指向 lib/moved.cjs，
 * 包内无任何 .d.ts）。本文件提供**最小宽松声明**：形状够用、成员为 any，
 * 让主进程 / 渲染进程代码通过编译；待上游提供类型后可整体删除。
 *
 * 覆盖三处 import：
 * - `electrobun`        → RPCSchema / ElectrobunConfig（仅类型位）
 * - `electrobun/bun`    → BrowserView.defineRPC / BrowserWindow（主进程）
 * - `electrobun/view`   → Electroview（渲染进程）
 *
 * 注意：本文件必须是**全局脚本**（无 import/export）——一旦加上 export {}
 * 变成模块，下面的 ambient module 声明将不再生效。
 */

declare module "electrobun" {
  /** RPC schema 占位（泛型位，调用方传入具体 shape） */
  export type RPCSchema<T = any> = any;
  /** electrobun 构建配置 */
  export type ElectrobunConfig = any;
}

declare module "electrobun/bun" {
  type DefineRpcConfig = {
    maxRequestTime?: number;
    handlers: {
      requests: Record<string, (params: any) => unknown>;
      messages: Record<string, (payload: any) => void>;
    };
  };

  export class BrowserView {
    static defineRPC<T = any>(config: DefineRpcConfig): any;
  }

  export class BrowserWindow {
    constructor(config: { title?: string; url?: string; rpc?: any });
    readonly webview: any;
  }
}

declare module "electrobun/view" {
  export class Electroview {
    constructor(config: { rpc?: any });
    static defineRPC<T = any>(config: any): any;
    readonly rpc: any;
  }
}
