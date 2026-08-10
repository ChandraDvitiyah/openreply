import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export const metadata = {
  title: "Sign in — Kult",
  description: "Sign in securely to manage your Instagram automations and links.",
};

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_30px_80px_rgba(4,67,64,0.16)] lg:grid-cols-[1.05fr_.95fr]">
        <div className="hidden min-h-[640px] flex-col justify-between bg-[#044340] p-12 text-[#f5f4ee] lg:flex">
          <div className="flex items-center text-lg font-bold">
            <span className="brand-mark !bg-[#9ce069] !text-[#044340]">K</span>
            <span className="ml-3">Kult</span>
          </div>
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[.25em] text-[#9ce069]">
              Welcome back
            </p>
            <h1 className="display-title max-w-lg text-7xl leading-[.88]">
              PICK UP EVERY CONVERSATION.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-8 text-white/75">
              Manage Instagram, Facebook Messenger, and smart links from one calm workspace.
            </p>
          </div>
          <p className="text-sm text-white/65">Official Meta APIs · No social passwords required</p>
        </div>
        <div className="flex min-h-[640px] flex-col items-center justify-center p-6 sm:p-12">
          <SignIn routing="hash" signUpUrl="/signup" fallbackRedirectUrl="/dashboard" />
          <p className="mt-6 text-center text-sm text-muted">
            New to Kult?{" "}
            <Link href="/signup" className="font-semibold text-[#1e5653] underline-offset-4 hover:underline">
              Create your account
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
