import type { PaymentProvider } from "./interface.js";
import { MockPaymentProvider } from "./mock.js";
import { PayFastPaymentProvider } from "./payfast.js";
import { SafepayPaymentProvider } from "./safepay.js";

export type { PaymentProvider, CheckoutParams, CheckoutResult, WebhookVerifyResult } from "./interface.js";

let _provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (_provider) return _provider;

  const name = (process.env.PAYMENT_PROVIDER ?? "mock").toLowerCase();

  switch (name) {
    case "payfast":
      _provider = new PayFastPaymentProvider();
      break;
    case "safepay":
      _provider = new SafepayPaymentProvider();
      break;
    case "mock":
    default:
      _provider = new MockPaymentProvider();
      break;
  }

  return _provider;
}
