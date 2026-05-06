import type { PaymentProvider, CheckoutParams, CheckoutResult, WebhookVerifyResult } from "./interface.js";

export class PayFastPaymentProvider implements PaymentProvider {
  readonly name = "payfast";

  async createCheckout(_params: CheckoutParams): Promise<CheckoutResult> {
    throw new Error(
      "PayFast payment provider is not yet configured. Set PAYFAST_MERCHANT_ID, PAYFAST_MERCHANT_KEY, and PAYFAST_PASSPHRASE in environment variables.",
    );
  }

  async verifyWebhook(
    _rawBody: unknown,
    _headers: Record<string, string>,
  ): Promise<WebhookVerifyResult> {
    throw new Error("PayFast payment provider is not yet configured.");
  }
}
