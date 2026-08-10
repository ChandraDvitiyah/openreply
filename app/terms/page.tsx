import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Terms and Conditions - Kult",
  description:
    "Terms and conditions for using Kult's Instagram automation and link-page software.",
};

export default function TermsPage() {
  return (
    <LegalShell
      title="Terms and Conditions"
      description="These terms define acceptable use of Kult's Instagram comment automation and public link-page software."
      updatedAt="August 4, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-white">Authorized Use</h2>
        <p className="mt-3">
          You may use Kult only with Instagram professional accounts you
          own or are authorized to manage. You are responsible for the campaigns,
          keywords, links, and messages you configure.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Platform Compliance</h2>
        <p className="mt-3">
          You agree to follow Meta Platform Terms, Instagram policies, applicable
          messaging rules, privacy laws, advertising rules, and anti-spam laws.
          Kult may rate-limit, pause, or disable campaigns that create
          compliance, abuse, security, or deliverability risk.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Availability</h2>
        <p className="mt-3">
          Kult depends on third-party platforms including Meta, authentication,
          hosting, database, and queue providers. We work to operate the
          service reliably, but uninterrupted availability is not guaranteed.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Open-Source Core</h2>
        <p className="mt-3">
          The OpenReply foundation is open source under its repository license.
          Your use of Meta, Clerk, Turso, hosting providers, and other third-party
          services is also governed by their respective terms.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Your Content And Responsibility</h2>
        <p className="mt-3">
          You retain responsibility for your links, messages, campaign rules,
          and account activity. You must not use Kult for unsolicited bulk
          messaging, deceptive links, harassment, scraping, or access to an
          account you are not authorized to manage.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Disclaimer And Liability</h2>
        <p className="mt-3">
          The software is provided without a guarantee that every webhook,
          message, redirect, or third-party API will remain available. To the
          extent allowed by law, the operator is not liable for indirect losses,
          lost revenue, account restrictions, or third-party platform changes.
        </p>
      </section>
    </LegalShell>
  );
}
