// 生成或获取当前窗口的 session ID
// 使用 sessionStorage 确保每个浏览器窗口/标签页有独立的 session

function generateSessionId(): string {
  return crypto.randomUUID();
}

export function getSessionId(): string {
  let sessionId = sessionStorage.getItem('db-session-id');
  if (!sessionId) {
    sessionId = generateSessionId();
    sessionStorage.setItem('db-session-id', sessionId);
  }
  return sessionId;
}
