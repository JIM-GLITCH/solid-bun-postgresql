import * as vscode from "vscode";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class ExpiryNotifier {
  private readonly notified = new Set<number>();

  constructor(private readonly getSubscriptionFrontend: () => string) {}

  async checkAndNotify(expiresAt: number | null): Promise<void> {
    if (expiresAt === null) return; // 永久订阅

    const nowMs = Date.now();
    const expiresMs = expiresAt * 1000;

    if (expiresMs <= nowMs) {
      // 已过期
      vscode.window.showWarningMessage("DB Player: 订阅已过期，请续费以继续使用。", "立即续费").then(action => {
        if (action === "立即续费") {
          const base = this.getSubscriptionFrontend().replace(/\/$/, "");
          const src = vscode.env.uriScheme === "cursor" ? "cursor" : "vscode";
          vscode.env.openExternal(vscode.Uri.parse(`${base}?source=${src}`));
        }
      });
      return;
    }

    const remainingMs = expiresMs - nowMs;
    if (remainingMs <= SEVEN_DAYS_MS) {
      if (this.notified.has(expiresAt)) return; // 去重
      this.notified.add(expiresAt);

      const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
      vscode.window.showWarningMessage(
        `DB Player: 订阅将在 ${remainingDays} 天后到期，请及时续费。`,
        "立即续费"
      ).then(action => {
        if (action === "立即续费") {
          const base = this.getSubscriptionFrontend().replace(/\/$/, "");
          const src = vscode.env.uriScheme === "cursor" ? "cursor" : "vscode";
          vscode.env.openExternal(vscode.Uri.parse(`${base}?source=${src}`));
        }
      });
    }
  }
}
