// 生成或获取当前窗口的 session ID
// 使用 sessionStorage 确保每个浏览器窗口/标签页有独立的 session

function generateSessionId(): string {
  // 兼容非安全上下文（HTTP）
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // fallback: 手动生成 UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function getSessionId(): string {
  let sessionId = sessionStorage.getItem('db-session-id');
  if (!sessionId) {
    sessionId = generateSessionId();
    sessionStorage.setItem('db-session-id', sessionId);
  }
  return sessionId;
}
