import type { Metadata } from "next";
import { headers } from "next/headers";
import { Analytics } from "@vercel/analytics/next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const baseUrl = host
    ? `${protocol}://${host}`
    : process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return {
    metadataBase: new URL(baseUrl),
    title: "Kult — Instagram and Messenger automations, together",
    description:
      "A self-hosted creator workspace for Instagram comment-to-DM, Facebook Messenger automation, and smart links.",
    keywords: [
      "instagram automation",
      "comment to DM",
      "instagram private replies",
      "facebook messenger automation",
      "social commerce",
      "manychat alternative",
    ],
    openGraph: {
      title: "Kult — Instagram and Messenger automations, together",
      description:
        "Automate Instagram and Facebook conversations, then publish one intelligent link page.",
      type: "website",
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "Kult product flow" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Kult — Instagram and Messenger automations, together",
      description:
        "Automate Instagram and Facebook conversations, then publish one intelligent link page.",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body
        suppressHydrationWarning
        className="min-h-full bg-background text-foreground font-sans antialiased"
      >
        <ClerkProvider signInUrl="/login" signUpUrl="/signup">
          {children}
          <Analytics />
        </ClerkProvider>
      </body>
    </html>
  );
}
