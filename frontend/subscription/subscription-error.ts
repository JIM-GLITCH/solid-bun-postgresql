/** 与后端 `SubscriptionRequiredError` 语义一致，供 HttpTransport / UI 识别 */

export class SubscriptionRequiredError extends Error {
  override readonly name = "SubscriptionRequiredError";
  readonly subscriptionRequired = true as const;
  constructor(
    message = "需要有效订阅：请先在订阅站登录，或将 JWT 存入 localStorage（dbplayer_token / dbplayer.jwt）。自托管请在**业务 API 进程**设置 SUBSCRIPTION_OFF=1，扩展可用 DBPLAYER_SUBSCRIPTION_OFF=1。"
  ) {
    super(message);
  }
}
