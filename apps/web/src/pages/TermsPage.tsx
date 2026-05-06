import { LegalPage } from "./LegalPage";

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      effectiveDate="May 1, 2025"
      intro={
        <p>
          Please read these Terms of Service carefully before using ShelfSense. By creating an account
          or accessing the platform, you agree to be bound by these terms. If you do not agree, do not
          use the service.
        </p>
      }
      sections={[
        {
          title: "1. Acceptance of Terms",
          body: (
            <p>
              These Terms of Service ("Terms") are a legal agreement between you (or the organization
              you represent) and SenseStack Technologies ("we", "us", or "our"), the company behind
              ShelfSense. By registering for, accessing, or using ShelfSense (the "Service"), you
              confirm that you have read, understood, and agree to these Terms. If you are accepting
              on behalf of an organization, you warrant that you have the authority to bind that
              organization to these Terms.
            </p>
          ),
        },
        {
          title: "2. Description of Service",
          body: (
            <p>
              ShelfSense is a cloud-based, subscription SaaS platform for inventory management, stock
              tracking, expiry monitoring, purchase orders, supplier management, and business
              operations. The platform is offered via the internet and accessed through a web browser.
              Features available to you depend on your active subscription plan.
            </p>
          ),
        },
        {
          title: "3. Account Registration and Workspace Responsibility",
          body: (
            <>
              <p>
                To use ShelfSense, you must register an account using accurate, current, and complete
                information. You are responsible for maintaining the confidentiality of your login
                credentials and for all activities that occur under your account.
              </p>
              <p style={{ marginTop: 10 }}>
                Each registered account is associated with one or more Workspaces. The workspace owner
                is responsible for all users added to the workspace, including their actions and
                compliance with these Terms. You must not share your account with others or allow
                unauthorized access to your workspace.
              </p>
            </>
          ),
        },
        {
          title: "4. Subscription Plans and Billing",
          body: (
            <>
              <p>
                ShelfSense offers subscription plans including a Free plan and paid plans (Basic, Pro,
                and Business/Enterprise). All paid subscription fees are billed in US Dollars (USD).
                By selecting a paid plan, you authorize us to charge the applicable fees using your
                chosen payment method.
              </p>
              <p style={{ marginTop: 10 }}>
                Subscription billing may be monthly or annual depending on the plan option selected.
                We reserve the right to change pricing with reasonable notice. Continued use of the
                service after a price change constitutes acceptance of the new pricing.
              </p>
            </>
          ),
        },
        {
          title: "5. Trial, Free Plan, and Paid Plan Terms",
          body: (
            <>
              <p>
                The Free plan is available at no cost and is subject to usage limits (users, locations,
                items) as defined in the plan details. Free plan users receive no payment obligations
                but may have limited access to certain features.
              </p>
              <p style={{ marginTop: 10 }}>
                Paid plans are activated either immediately or after a trial period, as applicable.
                During a trial, you may access paid features at no charge. At the end of the trial,
                the applicable plan fees will apply unless you downgrade or cancel before the trial
                period ends.
              </p>
            </>
          ),
        },
        {
          title: "6. Acceptable Use",
          body: (
            <>
              <p>You agree not to use ShelfSense to:</p>
              <ul style={{ paddingLeft: 20, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                <li>Violate any applicable law or regulation</li>
                <li>Upload or transmit harmful, fraudulent, or illegal content</li>
                <li>Attempt to gain unauthorized access to other accounts or systems</li>
                <li>Interfere with the integrity or performance of the service</li>
                <li>Reverse engineer, decompile, or attempt to extract the source code</li>
                <li>Resell or sublicense the service without prior written consent</li>
              </ul>
              <p style={{ marginTop: 10 }}>
                We reserve the right to suspend or terminate accounts that violate these terms without
                notice.
              </p>
            </>
          ),
        },
        {
          title: "7. Customer Data Ownership",
          body: (
            <p>
              You retain full ownership of all data you input into ShelfSense, including inventory
              records, supplier information, stock movements, and business data. We do not claim any
              intellectual property rights over your data. We process your data solely to provide and
              improve the service, as described in our Privacy Policy.
            </p>
          ),
        },
        {
          title: "8. Service Availability",
          body: (
            <p>
              We aim to provide a reliable and available service but do not guarantee 100% uptime.
              The service may be temporarily unavailable due to maintenance, upgrades, or circumstances
              beyond our control. We will make reasonable efforts to provide advance notice of planned
              downtime.
            </p>
          ),
        },
        {
          title: "9. Limitation of Liability",
          body: (
            <p>
              To the maximum extent permitted by applicable law, SenseStack Technologies shall not be
              liable for any indirect, incidental, special, consequential, or punitive damages arising
              from your use of or inability to use ShelfSense, including loss of data, revenue, or
              profits. Our total aggregate liability to you shall not exceed the amount you paid for
              the service in the three months preceding the claim.
            </p>
          ),
        },
        {
          title: "10. Termination",
          body: (
            <p>
              You may cancel your subscription at any time from your account settings. Upon
              cancellation, your access to paid features will continue until the end of the current
              billing period, after which your account will revert to the Free plan or be deactivated.
              We reserve the right to suspend or terminate your account if you violate these Terms or
              engage in conduct harmful to the service or other users.
            </p>
          ),
        },
        {
          title: "11. Changes to Terms",
          body: (
            <p>
              We may update these Terms from time to time. We will notify you of material changes by
              posting the updated Terms on our website and, where appropriate, by email. Continued use
              of ShelfSense after any such changes constitutes your acceptance of the new Terms. We
              encourage you to review these Terms periodically.
            </p>
          ),
        },
        {
          title: "12. Contact Information",
          body: (
            <p>
              If you have any questions about these Terms, please contact us at:{" "}
              <a href="mailto:hello@shelfsense.com" className="legal-inline-link">
                hello@shelfsense.com
              </a>
              . SenseStack Technologies, the company operating ShelfSense, can also be reached via the
              in-app support system.
            </p>
          ),
        },
      ]}
    />
  );
}
