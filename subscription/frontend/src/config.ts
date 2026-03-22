/**
 * API 地址：编译时由 build.ts 通过 define 注入 __API_URL__
 */
declare const __API_URL__: string;

export const getApiUrl = (): string => {
  const url = typeof __API_URL__ !== "undefined" ? __API_URL__ : "";
  if (url === "" || url === window.location.origin) return "";
  return url || "http://localhost:9000";
};
