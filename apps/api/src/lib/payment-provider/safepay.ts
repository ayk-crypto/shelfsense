import type { PaymentProvider, CheckoutParams, CheckoutResult, WebhookVerifyResult } from "./interface.js";

export class SafepayPaymentProvider implements PaymentProvider {
  readonly name = "safepay";

  async createCheckout(_params: CheckoutParams): Promise<CheckoutResult> {
    throw new Error(
      "Safepay payment provider is not yet configured. Set SAFEPAY_API_KEY and SAFEPAY_SECRET_KEY in environment variables.",
    );
  }

  async verifyWebhook(
    _rawBody: unknown,
    _headers: Record<string, string>,
  ): Promise<WebhookVerifyResult> {
    throw new Error("Safepay payment provider is not yet configured.");
  }
}
