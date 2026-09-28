// 共享类型定义，供 frontend / backend 使用

export * from "./types";
export * from "./database-capabilities";
export * from "./transport";
export * from "./format-cell";
export * from "./sql-split";
export * from "./sql-format";

// tRPC 相关导出
export * from "./trpc-types";

// 解决 DbRpcBase 重复导出问题
import { DbRpcBase as TransportDbRpcBase } from "./transport";
import { DbRpcBase as TrpcDbRpcBase } from "./trpc-types";

// 导出统一的 DbRpcBase 类型
export type DbRpcBase = TransportDbRpcBase;