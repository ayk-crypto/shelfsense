export interface CheckoutParams {
  idempotencyKey: string;
  subscriptionId: string;
  paymentId: string;
  workspaceId: string;
  amount: number;
  currency: string;
  planName: string;
  billingCycle: string;
  customerEmail: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  gatewayReference: string | null;
  gatewayCustomerId: string | null;
}

export interface WebhookVerifyResult {
  valid: boolean;
  eventId: string | null;
  status: "paid" | "failed" | "cancelled" | "refunded" | "unknown";
  gatewayReference: string | null;
  paymentId: string | null;
  subscriptionId: string | null;
}

export interface PaymentProvider {
  readonly name: string;
  createCheckout(params: CheckoutParams): Promise<CheckoutResult>;
  verifyWebhook(rawBody: unknown, headers: Record<string, string>): Promise<WebhookVerifyResult>;
}
