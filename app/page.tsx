import Link from "next/link";

const channels = [
  {
    number: "01",
    title: "Instagram comments",
    body: "Turn a keyword—or every comment—into a private reply. Target one reel, the next reel, or every reel you publish from now on.",
  },
  {
    number: "02",
    title: "Instagram inbox",
    body: "Create keyword-aware DM auto-responders, opening messages, button reveals, tracked links, and a complete delivery log.",
  },
  {
    number: "03",
    title: "Facebook Messenger",
    body: "Reply to inbound Page messages and move Facebook post commenters into private Messenger conversations through the official API.",
  },
];

const signalRows = [
  ["@maya.co", "Commented LINK", "Private reply sent"],
  ["Jordan Lee", "Messaged PRICE", "Messenger reply sent"],
  ["@studio.ray", "New reel detected", "Campaign attached"],
];

const features = [
  "Instagram + Facebook Page connections",
  "Keyword and any-message triggers",
  "Every future reel targeting",
  "Opening-DM button sequences",
  "Turso-hosted application data",
  "Durable Turso delivery queue",
  "Encrypted Meta access tokens",
  "Multi-account creator workspace",
  "Link-in-bio studio and analytics",
];

export default function HomePage() {
  return (
    <main className="overflow-hidden bg-background">
      <header className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-5 lg:px-10">
        <Link href="/" className="flex items-center gap-3" aria-label="Kult home">
          <span className="brand-mark">K</span>
          <span className="display-title text-3xl tracking-tight">KULT</span>
        </Link>
        <nav className="hidden items-center gap-8 text-sm font-medium md:flex">
          <a href="#channels" className="hover:text-[#1e5653]">Channels</a>
          <a href="#workflow" className="hover:text-[#1e5653]">How it works</a>
          <a href="#features" className="hover:text-[#1e5653]">Features</a>
          <Link href="/templates" className="hover:text-[#1e5653]">Templates</Link>
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden px-3 py-2 text-sm font-semibold hover:text-[#1e5653] sm:inline-flex">
            Sign in
          </Link>
          <Link href="/signup" className="button-primary">Start free</Link>
        </div>
      </header>

      <section className="mx-auto max-w-[1440px] px-5 pb-20 pt-16 text-center lg:px-10 lg:pb-40 lg:pt-24">
        <p className="mb-6 text-sm font-semibold uppercase tracking-[0.2em] text-[#1e5653]">
          Social conversations, beautifully automated
        </p>
        <h1 className="display-title mx-auto max-w-6xl text-[clamp(5.2rem,12vw,11rem)] leading-[0.8] tracking-[-0.025em]">
          TURN COMMENTS
          <span className="block text-[#1e5653]">INTO CUSTOMERS.</span>
        </h1>
        <p className="mx-auto mt-8 max-w-3xl text-xl leading-8 text-muted lg:text-2xl lg:leading-9">
          One creator workspace for Instagram automation, Facebook Messenger,
          and the smart links that move every conversation forward.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Link href="/signup" className="button-primary">Create your account</Link>
          <a href="#workflow" className="button-secondary">See the flow</a>
        </div>

        <div className="relative mx-auto mt-20 max-w-6xl rounded-[40px] bg-[#044340] p-5 text-left shadow-[0_30px_80px_rgba(4,67,64,0.2)] sm:p-8 lg:mt-24 lg:rounded-[50px] lg:p-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9ce069]">Live campaign</p>
              <p className="display-title mt-2 text-4xl text-[#f5f4ee] sm:text-5xl">LAUNCH-DAY LINKS</p>
            </div>
            <span className="w-fit rounded-full bg-[#9ce069] px-5 py-2 text-xs font-bold uppercase tracking-[0.18em] text-black">
              Automation active
            </span>
          </div>
          <div className="mt-8 grid gap-3 lg:grid-cols-3">
            {signalRows.map(([person, trigger, result]) => (
              <div key={person} className="rounded-[24px] bg-[#f5f4ee] p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-semibold">{person}</p>
                    <p className="mt-1 text-sm text-muted">{trigger}</p>
                  </div>
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full bg-[#9ce069]" />
                </div>
                <p className="mt-6 border-t border-border pt-4 text-sm font-medium text-[#1e5653]">{result}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="channels" className="bg-white py-24 lg:py-40">
        <div className="mx-auto max-w-[1440px] px-5 lg:px-10">
          <div className="grid gap-8 lg:grid-cols-[1fr_0.65fr] lg:items-end">
            <h2 className="display-title text-[clamp(4.5rem,8vw,8rem)] leading-[0.86]">
              EVERY PLACE YOUR AUDIENCE STARTS TALKING.
            </h2>
            <p className="max-w-xl text-lg leading-7 text-muted lg:pb-2">
              Kult watches the official Meta events, applies your rules, and hands
              delivery to a retry-safe worker—without scraping or asking for social passwords.
            </p>
          </div>
          <div className="mt-20 grid gap-5 lg:grid-cols-3">
            {channels.map((channel) => (
              <article key={channel.number} className="rounded-[30px] border border-border bg-background p-8 lg:min-h-96 lg:p-10">
                <p className="display-title text-5xl text-[#1e5653]">{channel.number}</p>
                <h3 className="display-title mt-16 text-5xl leading-none">{channel.title}</h3>
                <p className="mt-6 text-base leading-7 text-muted">{channel.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="workflow" className="py-24 lg:py-40">
        <div className="mx-auto max-w-[1440px] px-5 lg:px-10">
          <div className="rounded-[50px] bg-[#044340] p-7 text-[#f5f4ee] lg:p-16">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#9ce069]">The workflow</p>
            <h2 className="display-title mt-5 max-w-5xl text-[clamp(4.5rem,8vw,8rem)] leading-[0.86]">
              FROM SIGNAL TO SEND, WITHOUT THE BUSYWORK.
            </h2>
            <div className="mt-16 grid gap-5 lg:grid-cols-3">
              {[
                ["Connect", "Authorize Instagram accounts and Facebook Pages through Meta."],
                ["Define", "Choose the trigger, keywords, audience surface, and private reply."],
                ["Deliver", "Kult queues, rate-limits, retries, logs, and measures every send."],
              ].map(([title, body], index) => (
                <div key={title} className="rounded-[30px] bg-white/10 p-7 lg:p-8">
                  <p className="text-sm font-semibold text-[#9ce069]">0{index + 1}</p>
                  <h3 className="display-title mt-14 text-5xl">{title}</h3>
                  <p className="mt-5 leading-7 text-white/65">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="bg-[#9ce069] py-24 lg:py-40">
        <div className="mx-auto max-w-[1440px] px-5 lg:px-10">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em]">Built to stay yours</p>
              <h2 className="display-title mt-5 text-[clamp(4.5rem,8vw,8rem)] leading-[0.86]">
                THE CREATOR OS YOU CONTROL.
              </h2>
              <p className="mt-8 max-w-lg text-lg leading-8">
                Clerk protects the workspace. Turso holds relational data and the
                durable queue. Kult brings the pieces together in one focused interface.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {features.map((feature, index) => (
                <div key={feature} className="flex min-h-28 items-center gap-4 rounded-2xl bg-[#f5f4ee] p-5">
                  <span className="display-title text-3xl text-[#1e5653]">{String(index + 1).padStart(2, "0")}</span>
                  <span className="font-semibold">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="px-5 py-24 lg:px-10 lg:py-40">
        <div className="mx-auto max-w-[1440px] rounded-[50px] border border-border bg-white p-8 text-center lg:p-20">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#1e5653]">Ready when your audience is</p>
          <h2 className="display-title mx-auto mt-5 max-w-5xl text-[clamp(4.5rem,9vw,9rem)] leading-[0.84]">
            BUILD THE CONVERSATION ONCE.
          </h2>
          <p className="mx-auto mt-7 max-w-2xl text-lg leading-8 text-muted">
            Launch Instagram and Messenger automations, publish your smart link page,
            and keep the full system under your control.
          </p>
          <Link href="/signup" className="button-primary mt-9">Create your account</Link>
        </div>
      </section>

      <footer className="bg-[#044340] px-5 py-12 text-[#f5f4ee] lg:px-10">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="display-title text-6xl">KULT</p>
            <p className="mt-3 max-w-md text-sm leading-6 text-white/60">Instagram, Messenger, and smart links—together in one self-hosted creator workspace.</p>
          </div>
          <div className="flex flex-wrap gap-6 text-sm text-white/70">
            <Link href="/privacy" className="hover:text-[#9ce069]">Privacy</Link>
            <Link href="/terms" className="hover:text-[#9ce069]">Terms</Link>
            <Link href="/data-deletion" className="hover:text-[#9ce069]">Data deletion</Link>
            <a href="https://github.com/Jurredr/openreply" className="hover:text-[#9ce069]">Open source</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
