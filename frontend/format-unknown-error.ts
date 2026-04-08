/** 将 API 返回或 catch 的 unknown 转成可展示的短文案（避免 [object Object]） */

export function formatUnknownError(e: unknown, fallback: string): string {
  if (e == null || e === "") return fallback;
  if (typeof e === "string") return e.trim() || fallback;
  if (e instanceof Error) return e.message.trim() || fallback;
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    for (const k of ["message", "error", "detail", "reason"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    try {
      return JSON.stringify(e);
    } catch {
      return fallback;
    }
  }
  const s = String(e);
  return s === "[object Object]" ? fallback : s;
}
