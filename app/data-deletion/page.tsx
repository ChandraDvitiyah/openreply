import type { Metadata } from "next";
import LegalShell from "@/components/legal-shell";

export const metadata: Metadata = {
  title: "Data Deletion - Kult",
  description:
    "How Kult users can disconnect Instagram and request account, campaign, link, and delivery-data deletion.",
};

export default function DataDeletionPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

  return (
    <LegalShell
      title="Data Deletion"
      description="Follow these instructions to remove a connected Instagram account or request deletion of your Kult workspace and associated data."
      updatedAt="August 4, 2026"
    >
      <section>
        <h2 className="text-xl font-bold text-white">Disconnect Instagram</h2>
        <p className="mt-3">
          Sign in, open Settings, and select Disconnect. This removes the stored
          Instagram connection token and stops campaigns from sending private
          replies for that account. Repeat this for every connected Instagram
          account you want removed.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Delete Workspace Data</h2>
        <p className="mt-3">
          To delete your Clerk-linked workspace, campaigns, delivery logs,
          webhook records, link page, click records, and operational diagnostics,
          send a request from the email address used to sign in to{" "}
          {supportEmail ? (
            <a className="text-accent underline" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          ) : (
            "the support email published in Kult's Meta app listing"
          )}
          . Include your workspace name and connected Instagram usernames. Do
          not send passwords or access tokens.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">Verification</h2>
        <p className="mt-3">
          We may ask you to verify control of the email address or connected
          business account before deleting data. The operator should acknowledge
          the request and provide a completion status within 30 days, unless a
          longer retention period is required for legal, fraud-prevention, or
          security reasons.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-bold text-white">What Deletion Does Not Control</h2>
        <p className="mt-3">
          Kult cannot delete comments, messages, or account information retained
          independently by Instagram, Clerk, or another provider. Use those
          providers&rsquo; account and privacy controls for data they hold directly.
        </p>
      </section>
    </LegalShell>
  );
}
