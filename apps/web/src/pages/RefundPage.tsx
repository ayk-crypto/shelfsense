import { LegalPage } from "./LegalPage";

export function RefundPage() {
  return (
    <LegalPage
      title="Refund Policy"
      effectiveDate="May 1, 2025"
      intro={
        <p>
          This Refund Policy explains how subscription payments, cancellations, and refund requests
          are handled for ShelfSense. All amounts are billed in US Dollars (USD). Please read this
          policy carefully before subscribing to a paid plan.
        </p>
      }
      sections={[
        {
          title: "1. Subscription Billing",
          body: (
            <p>
              ShelfSense subscriptions are billed in advance on a monthly or annual basis in USD.
              By subscribing to a paid plan, you authorize us to charge your payment method at the
              start of each billing period. Billing occurs automatically and you will receive a
              payment confirmation by email.
            </p>
          ),
        },
        {
          title: "2. Free Plan",
          body: (
            <p>
              The Free plan is available at no cost. There are no charges associated with the Free
              plan, and no payment method is required to use it. This refund policy applies only to
              paid subscription plans.
            </p>
          ),
        },
        {
          title: "3. Cancellation",
          body: (
            <p>
              You may cancel your paid subscription at any time from your account's billing settings.
              Upon cancellation, your access to paid plan features will continue until the end of the
              current billing period. No further charges will be made after cancellation. Your account
              will revert to the Free plan (subject to its limits) at the end of the paid period.
              Cancellation does not automatically trigger a refund for the current billing period.
            </p>
          ),
        },
        {
          title: "4. Refund Eligibility",
          body: (
            <>
              <p>
                Refunds are not automatically issued after a successful subscription payment has been
                processed. However, we review refund requests on a case-by-case basis and may approve
                them in the following circumstances:
              </p>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <li>A duplicate charge was made due to a billing error</li>
                <li>You were charged for a plan you did not intend to select due to a platform error</li>
                <li>An accidental payment was made and a refund is requested promptly</li>
                <li>Refund is required by applicable consumer protection law in your jurisdiction</li>
              </ul>
              <p style={{ marginTop: 10 }}>
                Approved refunds will be credited back to the original payment method. Processing
                times depend on your bank or payment provider and may take 5–10 business days.
              </p>
            </>
          ),
        },
        {
          title: "5. Refund Request Window",
          body: (
            <p>
              Refund requests must be submitted within <strong>14 days</strong> of the payment date
              to be considered. Requests submitted after this window will generally not be eligible
              for a refund, except where required by law. To submit a request, contact us at{" "}
              <a href="mailto:hello@shelfsense.com" className="legal-inline-link">
                hello@shelfsense.com
              </a>{" "}
              with your account email, the payment date, and the reason for your request.
            </p>
          ),
        },
        {
          title: "6. Business and Custom Plans",
          body: (
            <p>
              Workspaces on Business or Enterprise plans with a negotiated pricing agreement may be
              subject to separate written terms that supersede this policy with respect to billing
              and refunds. Please refer to your agreement or contact your account manager for
              details specific to your arrangement.
            </p>
          ),
        },
        {
          title: "7. Annual Plans",
          body: (
            <p>
              For annual subscriptions, the full year's fee is charged upfront. If you cancel an
              annual plan mid-term, you will retain access until the end of the annual period, but
              partial refunds for unused months are not automatically issued. Exceptions may be
              considered on a case-by-case basis — please contact us within 14 days of payment to
              discuss your situation.
            </p>
          ),
        },
        {
          title: "8. Contact for Refund Requests",
          body: (
            <p>
              To submit a refund request or report a billing issue, please contact us at:{" "}
              <a href="mailto:hello@shelfsense.com" className="legal-inline-link">
                hello@shelfsense.com
              </a>
              . Include your registered email address, the transaction date, and a brief description
              of the issue. We aim to respond to all billing inquiries within 2 business days.
            </p>
          ),
        },
      ]}
    />
  );
}
