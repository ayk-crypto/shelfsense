import { LegalPage } from "./LegalPage";

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      effectiveDate="May 1, 2025"
      intro={
        <p>
          SenseStack Technologies ("we", "us", "our") operates ShelfSense. This Privacy Policy
          explains what information we collect, how we use it, and your rights regarding your data.
          We are committed to protecting your privacy and handling your data responsibly.
        </p>
      }
      sections={[
        {
          title: "1. Information We Collect",
          body: (
            <>
              <p>We collect the following categories of information:</p>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <li>
                  <strong>Account details:</strong> Your name, email address, password (stored as a
                  secure hash), and profile information provided during registration.
                </li>
                <li>
                  <strong>Workspace data:</strong> Business name, workspace settings, locations, team
                  members, and role assignments you configure within the platform.
                </li>
                <li>
                  <strong>Inventory data:</strong> Items, stock quantities, expiry dates, batch
                  records, stock movements, purchase orders, and supplier information you enter.
                </li>
                <li>
                  <strong>Usage logs:</strong> Timestamps, actions performed, IP addresses, browser
                  type, and device information collected automatically when you use the service.
                </li>
                <li>
                  <strong>Billing references:</strong> Subscription plan, billing cycle, and payment
                  references returned by our payment providers. We do not store full card numbers or
                  sensitive payment credentials.
                </li>
              </ul>
            </>
          ),
        },
        {
          title: "2. How We Use Your Data",
          body: (
            <>
              <p>We use the information we collect for the following purposes:</p>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <li><strong>Account management:</strong> Creating and maintaining your account and workspace</li>
                <li><strong>Service delivery:</strong> Providing inventory tracking, alerts, reports, and all platform features</li>
                <li><strong>Support:</strong> Responding to support requests and resolving technical issues</li>
                <li><strong>Security:</strong> Detecting and preventing unauthorized access, fraud, and abuse</li>
                <li><strong>Billing:</strong> Processing subscription payments and managing your subscription status</li>
                <li><strong>Product improvement:</strong> Analysing usage patterns to improve platform features and reliability</li>
                <li><strong>Communications:</strong> Sending service notifications, security alerts, and account-related emails</li>
              </ul>
            </>
          ),
        },
        {
          title: "3. Payment Data",
          body: (
            <p>
              Subscription payments are processed through third-party payment providers. When you make
              a payment, you are interacting directly with the payment provider's secure environment.
              ShelfSense does not store your full card number, CVV, or other sensitive payment
              credentials. We only receive and store a payment reference, transaction status, and
              subscription identifiers returned by the payment provider. Please review your payment
              provider's privacy policy for details on how they handle your payment data.
            </p>
          ),
        },
        {
          title: "4. Data Sharing",
          body: (
            <>
              <p>
                We do not sell your personal data. We share data only with trusted service providers
                who help us operate the service, including:
              </p>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <li>Cloud infrastructure and database providers (for hosting and storage)</li>
                <li>Payment processing providers (for billing and subscription management)</li>
                <li>Email delivery providers (for transactional and alert emails)</li>
                <li>Analytics and monitoring tools (for performance and error tracking)</li>
              </ul>
              <p style={{ marginTop: 10 }}>
                These providers are bound by contractual obligations to protect your data and may only
                process it as directed by us. We do not share your data with advertisers or unrelated
                third parties.
              </p>
            </>
          ),
        },
        {
          title: "5. Security Measures",
          body: (
            <p>
              We implement industry-standard security measures to protect your data, including
              encryption of data in transit (TLS), hashed password storage, role-based access
              controls, and regular security reviews. However, no system is completely secure. We
              encourage you to use a strong, unique password and to report any suspected security
              issues to us immediately at{" "}
              <a href="mailto:hello@shelfsense.com" className="legal-inline-link">
                hello@shelfsense.com
              </a>
              .
            </p>
          ),
        },
        {
          title: "6. Data Retention",
          body: (
            <p>
              We retain your account and workspace data for as long as your account is active or as
              needed to provide the service. If you cancel your account, we may retain certain data
              for a limited period to comply with legal obligations, resolve disputes, or enforce our
              agreements. You may request deletion of your data by contacting us, subject to any
              applicable legal retention requirements.
            </p>
          ),
        },
        {
          title: "7. Your Rights",
          body: (
            <>
              <p>Depending on your jurisdiction, you may have the right to:</p>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <li>Access the personal data we hold about you</li>
                <li>Request correction of inaccurate or incomplete data</li>
                <li>Request deletion of your data (subject to legal retention requirements)</li>
                <li>Object to or restrict certain processing of your data</li>
                <li>Request a portable copy of your data</li>
              </ul>
              <p style={{ marginTop: 10 }}>
                To exercise any of these rights, please contact us at{" "}
                <a href="mailto:hello@shelfsense.com" className="legal-inline-link">
                  hello@shelfsense.com
                </a>
                .
              </p>
            </>
          ),
        },
        {
          title: "8. Cookies and Analytics",
          body: (
            <p>
              ShelfSense may use cookies and similar technologies to maintain your session, remember
              your preferences, and improve the platform experience. We may also use analytics tools
              to understand how the platform is used. These tools may collect information such as page
              views, feature usage, and session duration. You can manage cookie preferences through
              your browser settings, although disabling cookies may affect certain features of the
              service.
            </p>
          ),
        },
        {
          title: "9. Contact Information",
          body: (
            <p>
              If you have any questions or concerns about this Privacy Policy or how we handle your
              data, please contact us at:{" "}
              <a href="mailto:hello@shelfsense.com" className="legal-inline-link">
                hello@shelfsense.com
              </a>
              . SenseStack Technologies is the data controller for personal data processed through
              ShelfSense.
            </p>
          ),
        },
      ]}
    />
  );
}
