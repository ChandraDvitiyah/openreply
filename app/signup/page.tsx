import { SignUp } from "@clerk/nextjs";
import Link from "next/link";

export const metadata = {
  title: "Create your account — Kult",
  description: "Create your secure Kult workspace with Clerk.",
};

export default function SignUpPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-12">
      <section className="grid w-full max-w-5xl overflow-hidden rounded-[2rem] border border-border bg-surface shadow-[0_30px_80px_rgba(4,67,64,0.16)] lg:grid-cols-[1.05fr_.95fr]">
        <div className="hidden min-h-[640px] flex-col justify-between bg-[#9ce069] p-12 text-[#101211] lg:flex">
          <div className="flex items-center text-lg font-bold">
            <span className="brand-mark">K</span>
            <span className="ml-3">Kult</span>
          </div>
          <div>
            <p className="mb-5 text-sm font-semibold uppercase tracking-[.25em] text-[#044340]">
              Start free
            </p>
            <h1 className="display-title max-w-lg text-7xl leading-[.88]">
              BUILD ONCE. KEEP EVERY REPLY MOVING.
            </h1>
            <p className="mt-6 max-w-md text-lg leading-8 text-black/65">
              Connect your creator accounts, build your first automation, and publish your smart link page.
            </p>
          </div>
          <p className="text-sm text-black/55">Secured by Clerk · Your Meta tokens stay encrypted</p>
        </div>
        <div className="flex min-h-[640px] flex-col items-center justify-center p-6 sm:p-12">
          <SignUp routing="hash" signInUrl="/login" fallbackRedirectUrl="/dashboard" />
          <p className="mt-6 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-[#1e5653] underline-offset-4 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </section>
    </main>
  );
}
