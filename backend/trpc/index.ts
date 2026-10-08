/**
 * tRPC 导出入口
 * 导出所有必要的类型和函数
 */

export { t, protectedProcedure } from './init';
export { createContext, type Context, type CreateContextFn } from './context';
export { appRouter, type AppRouter } from './router';
