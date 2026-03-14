/**
 * 部署时修改 API 地址；同源或留空则用相对路径
 */
declare global {
  interface Window {
    DBPLAYER_API_URL?: string;
  }
}

export const getApiUrl = (): string => {
  const url = window.DBPLAYER_API_URL ?? "";
  if (url === "" || url === window.location.origin) return "";
  return url || "http://localhost:9000";
};
