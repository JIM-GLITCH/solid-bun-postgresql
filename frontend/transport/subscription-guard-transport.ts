/**
 * 在 IApiTransport 外层统一校验订阅：Standalone（HTTP）与 Extension（Webview）共用同一套 verify-license 逻辑
 */

import type { IApiTransport, ApiMethod, ApiRequestPayload, SSEMessage } from "../../shared/src";
import { verifyLicenseRemote, invalidateLicenseCache } from "../subscription/license-client";

export class SubscriptionRequiredError extends Error {
  override readonly name = "SubscriptionRequiredError";
  constructor(
    message = "需要有效订阅：请先在订阅站登录，或将 JWT 存入本页 localStorage（键名 dbplayer_token 或 dbplayer.jwt）。自托管可设 VITE_SUBSCRIPTION_OFF=1。"
  ) {
    super(message);
  }
}

export type SubscriptionGuardOptions = {
  subscriptionApiBase: string;
  getToken: () => string | null | Promise<string | null>;
};

export class SubscriptionGuardTransport implements IApiTransport {
  private lastToken: string | null | undefined;

  constructor(
    private readonly inner: IApiTransport,
    private readonly opts: SubscriptionGuardOptions
  ) {}

  private async ensureLicensed(): Promise<void> {
    const token = await Promise.resolve(this.opts.getToken());
    if (this.lastToken !== token) {
      invalidateLicenseCache();
      this.lastToken = token;
    }
    const { valid } = await verifyLicenseRemote(this.opts.subscriptionApiBase, token);
    if (!valid) {
      throw new SubscriptionRequiredError();
    }
  }

  async request<M extends ApiMethod>(method: M, payload: ApiRequestPayload[M]): Promise<unknown> {
    await this.ensureLicensed();
    return this.inner.request(method, payload);
  }

  subscribeEvents(connectionId: string, callback: (msg: SSEMessage) => void): () => void {
    let innerUnsub: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        await this.ensureLicensed();
        if (!cancelled) {
          innerUnsub = this.inner.subscribeEvents(connectionId, callback);
        }
      } catch (e) {
        console.error("[SubscriptionGuardTransport] subscribeEvents:", e);
      }
    })();
    return () => {
      cancelled = true;
      innerUnsub?.();
    };
  }
}
