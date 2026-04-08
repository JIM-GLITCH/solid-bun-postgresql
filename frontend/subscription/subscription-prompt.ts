/** Web / VS Code Webview 共用：派发后由 DialogProvider 显示统一订阅提示弹窗 */

export const SUBSCRIPTION_REQUIRED_EVENT = "dbplayer:subscription-required";

export function raiseSubscriptionRequired(message?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(SUBSCRIPTION_REQUIRED_EVENT, {
      detail: { message: typeof message === "string" ? message.trim() : "" },
    })
  );
}
