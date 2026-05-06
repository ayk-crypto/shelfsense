import type { PaymentProvider, CheckoutParams, CheckoutResult, WebhookVerifyResult } from "./interface.js";
import { env } from "../../config/env.js";

export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createCheckout(params: CheckoutParams): Promise<CheckoutResult> {
    const url = new URL(`${env.appUrl}/billing/mock-checkout`);
    url.searchParams.set("token", params.idempotencyKey);
    url.searchParams.set("paymentId", params.paymentId);
    url.searchParams.set("subscriptionId", params.subscriptionId);
    url.searchParams.set("amount", String(params.amount));
    url.searchParams.set("currency", params.currency);
    url.searchParams.set("plan", params.planName);

    return {
      checkoutUrl: url.toString(),
      gatewayReference: `mock_ref_${params.idempotencyKey}`,
      gatewayCustomerId: null,
    };
  }

  async verifyWebhook(
    _rawBody: unknown,
    _headers: Record<string, string>,
  ): Promise<WebhookVerifyResult> {
    return {
      valid: false,
      eventId: null,
      status: "unknown",
      gatewayReference: null,
      paymentId: null,
      subscriptionId: null,
    };
  }
}
