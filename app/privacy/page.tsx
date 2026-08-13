import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy - Kult",
  description:
    "How Kult handles authentication, Instagram account data, webhook payloads, links, clicks, and campaign information.",
};

export default function PrivacyPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

  return (
    <LegalShell
      title="Privacy Policy"
      description="This policy explains how Kult processes information when you connect Instagram accounts, automate comment replies, and publish a link-in-bio page."
      updatedAt="August 4, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-white">Data We Collect</h2>
        <p className="mt-3">
          We collect the identity information supplied through Clerk,
          workspace metadata, connected Instagram account identifiers,
          encrypted Instagram access tokens, campaign settings, webhook events,
          comments needed to evaluate campaigns, delivery logs, public bio-page
          content, link clicks, and operational diagnostics.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">How We Use Data</h2>
        <p className="mt-3">
          We use this data to authenticate users, connect Instagram
          integrations, match comment keywords, send private replies through the
          official Meta APIs, prevent duplicate sends, troubleshoot failures,
          and protect the service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Instagram And Meta Data</h2>
        <p className="mt-3">
          Kult does not ask for Instagram passwords, scrape Instagram, or
          use browser automation. Instagram tokens are encrypted at rest and are
          used only to perform actions authorized by the connected business
          account.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Subprocessors</h2>
        <p className="mt-3">
          The service uses Clerk for authentication, Meta for Instagram access,
          Turso/libSQL for application data and durable queued work, and
          may use a hosting and monitoring provider to operate automations.
          Each provider processes data only as needed to provide its service.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Retention And Deletion</h2>
        <p className="mt-3">
          Instagram comments and identifiers are retained only as needed for
          delivery, deduplication, reporting, abuse prevention, and debugging.
          Disconnecting Instagram removes the stored connection and stops its
          campaigns. Follow the Data Deletion page for full deletion steps.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Contact</h2>
        <p className="mt-3">
          For privacy questions or a deletion request,{" "}
          {supportEmail ? (
            <a className="text-accent underline" href={`mailto:${supportEmail}`}>
              contact {supportEmail}
            </a>
          ) : (
            "use the contact email listed for Kult in its Meta app listing"
          )}
          . The operator must publish a monitored support address before making
          the Meta app public.
        </p>
      </section>
    </LegalShell>
  );
}
