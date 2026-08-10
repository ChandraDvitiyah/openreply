import Link from "next/link";

interface LegalShellProps {
  title: string;
  description: string;
  updatedAt: string;
  children: React.ReactNode;
}

export default function LegalShell({
  title,
  description,
  updatedAt,
  children,
}: LegalShellProps) {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-5">
          <Link href="/" className="flex items-center gap-3">
            <span className="brand-mark">K</span>
            <span className="text-lg font-bold text-foreground">Kult</span>
          </Link>
          <Link
            href="/login"
            className="text-sm font-semibold text-muted transition hover:text-foreground"
          >
            Sign in
          </Link>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-5 py-14">
        <p className="text-sm font-semibold uppercase text-success">
          Last updated {updatedAt}
        </p>
        <h1 className="mt-4 text-4xl font-black text-foreground sm:text-5xl">
          {title}
        </h1>
        <p className="mt-5 text-base leading-8 text-muted">{description}</p>
        <div className="legal-copy mt-10 space-y-8 text-sm leading-7 text-[#4f514e]">
          {children}
        </div>
      </article>

      <footer className="border-t border-border py-8">
        <nav
          className="mx-auto flex max-w-3xl flex-wrap gap-x-6 gap-y-3 px-5 text-sm text-muted"
          aria-label="Legal pages"
        >
          <Link href="/privacy" className="transition hover:text-success">Privacy Policy</Link>
          <Link href="/terms" className="transition hover:text-success">Terms &amp; Conditions</Link>
          <Link href="/data-deletion" className="transition hover:text-success">Data Deletion</Link>
          <Link href="/" className="transition hover:text-success">Back to Kult</Link>
        </nav>
      </footer>
    </main>
  );
}
