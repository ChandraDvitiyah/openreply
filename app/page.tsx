import type { Metadata } from "next";
import { LandingPage } from "./_landing/landing-page";

const title = "Kult — The Marketing Suite for your Agent";
const description = "Give your agent the tools to run marketing end to end. Publish content, automate conversations, manage links, and track performance from a single MCP server.";

export const metadata: Metadata = {
  title,
  description,
  keywords: ["agent marketing", "marketing MCP", "Instagram automation", "social media scheduling", "marketing suite"],
  openGraph: { title, description, type: "website", images: [] },
  twitter: { card: "summary", title, description, images: [] },
};

export default function HomePage() {
  return <LandingPage supportEmail={process.env.NEXT_PUBLIC_SUPPORT_EMAIL} />;
}
