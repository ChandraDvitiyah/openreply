"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, BarChart3, CalendarDays, Camera as Instagram, Check, ChevronDown, Link2, Menu, MessageCircle, MousePointer2, Send, ShieldCheck, Sparkles, Terminal, Users, X, Zap } from "lucide-react";
import type { ReactNode } from "react";
import s from "./landing.module.css";
import { KultMonogram, KultWordmark } from "./kult-brand";
const tools = [{ name: "ChatGPT", file: "openai" }, { name: "Claude", file: "claude" }, { name: "Cursor", file: "cursor" }, { name: "VS Code", file: "vscode" }];
const capabilities = [
    { title: "Content scheduling", body: "Draft, schedule, and publish to Instagram and Facebook. Your agent takes care of the calendar.", icon: CalendarDays },
    { title: "DM automations", body: "Turn comments and keywords into conversations with automatic private replies.", icon: MessageCircle },
    { title: "Media uploads", body: "Send your photos and videos straight from your agent into your publishing workflow.", icon: Send },
    { title: "Smart links", body: "Build your link-in-bio page, organize destinations, and track every click.", icon: Link2 },
    { title: "Performance insights", body: "Bring views, engagement, and campaign reports into the same conversation.", icon: BarChart3 },
    { title: "Your workspace", body: "Manage connected accounts and collaborate with your team in one place.", icon: Users },
];
const faqs = [
    ["What is Kult?", "Kult is the marketing suite for your agent. A single MCP server connects your AI tools to content scheduling, Instagram and Facebook automations, your inbox, smart links, and performance insights."],
    ["Which agents can I use?", "Use an MCP-compatible client such as ChatGPT, Claude, Cursor, or VS Code. Connection and authentication options depend on the client. Your Kult workspace’s AI agents page has the setup details."],
    ["What can my agent actually do?", "Your agent can upload media, draft and schedule posts, create comment-to-DM campaigns, reply to conversations, update link pages, and read performance reports using Kult’s tools."],
    ["Do I still need a Kult account?", "Yes. Create a Kult account, connect your social accounts, then authorize your agent. Your agent works within your workspace and its permissions."],
    ["Which social platforms are supported?", "Kult currently supports professional Instagram accounts and Facebook Pages. Available post formats and messaging actions depend on your account and Meta’s permissions."],
    ["Will my agent publish without asking?", "Your agent’s confirmation settings govern approvals. You can ask it to prepare drafts first and review everything in Kult. Connecting social accounts and authorizing agent access requires your consent."],
    ["Can I use the dashboard too?", "Absolutely. Your agent and the dashboard work with the same posts, campaigns, links, and reports. Move between them whenever you like."],
    ["Are paid plans available?", "The current self-hosted version has no paid plan limits. Growth pricing is coming soon. Hosting, AI provider costs, and Meta’s platform limits are separate."],
];
function Brand() { return <span className={s.brand}><KultWordmark /></span>; }
function AgentIcon({ name, file }: {
    name: string;
    file: string;
}) { return <Image src={`/landing/${file}.svg`} width={21} height={21} alt={name}/>; }
function WindowBar({ children, dark = false }: {
    children: ReactNode;
    dark?: boolean;
}) { return <div className={`${s.windowBar} ${dark ? s.darkBar : ""}`}><span className={s.traffic} aria-hidden="true"><i /><i /><i /></span><span>{children}</span><span className={s.windowSpacer}/></div>; }
function Actions() {
    return <div className={s.actions}>
      <Link href="/agents" className={s.softButton}>Set up your agent <span className={s.buttonAgents}><AgentIcon {...tools[1]}/><AgentIcon {...tools[0]}/></span></Link>
    </div>;
}
function HeroChat() {
    return <div className={s.heroScene} aria-label="Illustrative conversation about running marketing with Kult">
    <Image src="/landing/desk.webp" alt="A warmly lit desk with a keyboard, notebook, and headphones" fill priority sizes="(max-width: 800px) 95vw, 750px" className={s.scenePhoto}/>
    <div className={s.sceneShade}/>
    <div className={`${s.chatLine} ${s.chatOne}`}><span>Sam</span><p>wait, you ran that whole launch?<b className={s.reaction}>💚</b></p></div>
    <div className={`${s.chatLine} ${s.chatTwo}`}><span>You</span><p>yeah, my agent handled it with kult</p></div>
    <div className={`${s.chatLine} ${s.chatThree}`}><span>Maria</span><p>posts, DMs, and the links too?</p></div>
    <div className={`${s.chatLine} ${s.chatFour}`}><span>You</span><p>all of it. one MCP server.<b className={s.reaction}>🤯</b></p></div>
  </div>;
}
function FeatureCards() {
    return <div className={s.featureGrid}>
    <article className={`${s.featureCard} ${s.publishCard}`}>
      <div className={s.featureText}><h3><CalendarDays size={18}/> The content</h3><p>From a first draft to your next post. Let your agent plan, schedule, and publish across your accounts.</p></div>
      <div className={s.miniSchedule}><WindowBar dark>Your content calendar</WindowBar><div className={s.scheduleInner}><small>THIS WEEK</small><div className={s.weekDays}>{["M", "T", "W", "T", "F"].map((d, i) => <span key={i}>{d}<b className={i === 2 ? s.dayActive : ""}>{19 + i}</b></span>)}</div><div className={s.scheduledPost}><Instagram size={18}/><div><b>The next big thing.</b><span>Wednesday · 10:00 AM</span></div><Check size={15}/></div></div></div>
      <div className={s.floatNote}><span className={s.squareMark}><KultMonogram /></span><div><b>One less thing to do.</b><small>Your launch post is scheduled.</small></div><Check size={18}/></div>
    </article>
    <article className={s.featureCard}><div className={s.featureText}><h3><MessageCircle size={18}/> The conversations</h3><p>A comment becomes a DM. A question gets an answer. Your agent builds the flow; Kult keeps it moving.</p></div>
      <div className={s.miniWindow}><WindowBar dark>Launch-day automation</WindowBar><div className={s.flowRow}><span className={s.tinyAvatar}>M</span><span>“Where can I get this?”</span><small>Comment</small></div><div className={s.flowActive}><Zap size={14}/><span>Keyword matched: <b>LINK</b></span><Check size={14}/></div><div className={s.flowRow}><span className={s.squareMark}><KultMonogram /></span><span>Sent you the link. Enjoy!</span><small>DM sent</small></div></div>
    </article>
    <article className={s.featureCard}><div className={s.featureText}><h3><Link2 size={18}/> The destination</h3><p>Give every campaign somewhere to land. Build link-in-bio pages, update destinations, and track clicks.</p></div><div className={`${s.miniWindow} ${s.linksWindow}`}><WindowBar dark>Your link page</WindowBar><div className={s.linkProfile}><span className={s.profileFlower}>✳</span><b>Studio good things</b><small>A little of everything we’re making.</small></div><div className={s.bioLink}>Shop the new collection <ArrowUpRight size={14}/></div><div className={s.bioLink}>A peek behind the scenes <ArrowUpRight size={14}/></div></div></article>
    <article className={s.featureCard}><div className={s.featureText}><h3><BarChart3 size={18}/> The bigger picture</h3><p>Know what’s working. Ask your agent for views, engagement, and campaign results, all in one conversation.</p></div><div className={`${s.miniWindow} ${s.chartWindow}`}><WindowBar dark>Campaign performance · example</WindowBar><div className={s.chartTop}><span>Post views<b>12,840</b></span><small>↗ 24% this week</small></div><div className={s.barChart} aria-hidden="true">{[24, 40, 33, 59, 47, 68, 56, 80, 66, 90, 76, 100].map((v, i) => <i key={i} style={{ height: `${v}%` }}/>)}</div><span className={s.chartLabel}>MON<span>SUN</span></span></div></article>
  </div>;
}
const demos = [
    { name: "Launch a campaign", request: "Let’s launch the new collection on Friday.", response: "I’ve prepared your launch across Instagram and Facebook.", tasks: ["3 posts drafted for your review", "LINK comment-to-DM flow prepared", "Collection added to your link page"], next: "Looks good. Schedule the posts and activate the flow.", result: "Your launch is ready.", detail: "Posts scheduled. Automation active. Links tracked." },
    { name: "Understand your results", request: "How did our latest launch perform?", response: "I’ve checked your posts, conversations, and tracked links.", tasks: ["Post performance reviewed", "Campaign delivery report checked", "Link clicks summarized"], next: "What should we try next?", result: "Here’s your next move.", detail: "Build on your best-performing content with a new draft." },
];
function AgentDemo() {
    const [active, setActive] = useState(0);
    const demo = demos[active];
    return <><div className={s.demoIntro}><div className={s.segmented} aria-label="Example workflows">{demos.map((d, i) => <button key={d.name} aria-pressed={i === active} onClick={() => setActive(i)}>{d.name}</button>)}</div><p>Ask in plain language. Your agent uses Kult to take care of the work.<br />{" "}Same conversation. Your entire marketing workflow.</p></div>
  <div className={s.desktopScene}>
    <div className={s.desktopMenu}><span className={s.desktopBrand}><KultMonogram /> Kult <span>File &nbsp; Edit &nbsp; View</span></span><span>Marketing, handled.</span></div>
    <div className={s.desktopToast}><span className={s.squareMark}><KultMonogram /></span><div><b>{active === 0 ? "Campaign ready" : "Report ready"}</b><small>{demo.detail}</small></div><span>now</span></div>
    <div className={`${s.agentWindow} ${s.backWindow}`}><WindowBar>ChatGPT</WindowBar><div className={s.agentBody}><div className={s.agentRail}><AgentIcon {...tools[0]}/><span>＋ New chat</span><span>⌕ Search</span><span>◫ Projects</span><small>Your chats</small><b>Our next launch</b><span>Content ideas</span><span>Weekly report</span></div><div className={s.agentMessages}><div className={s.userMessage}>{demo.request}</div><p>{demo.response}</p><div className={s.toolCall}><span className={s.squareMark}><KultMonogram /></span>Connected to Kult <Check size={14}/></div><ul>{demo.tasks.map(t => <li key={t}><Check size={13}/>{t}</li>)}</ul><div className={s.messageInput}>Ask anything <span>↑</span></div></div></div></div>
    <div className={`${s.agentWindow} ${s.frontWindow}`}><WindowBar><span className={s.claudeName}><AgentIcon {...tools[1]}/> Your marketing, with Kult</span></WindowBar><div className={s.frontMessages}><div className={s.userMessage}>{demo.next}</div><small className={s.toolProgress}>Working with Kult <ChevronDown size={12}/></small><h3>{demo.result}</h3><p>{demo.detail}</p><div className={s.resultCard}><span className={s.squareMark}><KultMonogram /></span><div><b>{active === 0 ? "Friday collection launch" : "Your campaign recap"}</b><small><span className={s.greenDot}/> {active === 0 ? "Scheduled · Instagram + Facebook" : "Views · Conversations · Link clicks"}</small></div><ArrowUpRight size={16}/></div><p>You can review everything in your Kult workspace.</p><div className={s.messageInput}>Reply… <span>↑</span></div></div></div>
    <span className={s.exampleLabel}>Illustrative agent workflow</span>
  </div></>;
}
function Suite() {
    const [selected, setSelected] = useState(0);
    const item = capabilities[selected];
    return <div className={s.suiteGrid}><div><h2>Everything included.</h2><div className={s.capabilityList}>{capabilities.map((c, i) => <button key={c.title} aria-pressed={i === selected} onClick={() => setSelected(i)}><c.icon size={20}/><span><b>{c.title}</b><small>{c.body}</small></span></button>)}</div></div><div className={s.suiteVisual}><div className={s.productWindow}><WindowBar>Kult workspace</WindowBar><div className={s.productBody}><aside><Brand />{capabilities.map((c, i) => <span key={c.title} className={selected === i ? s.productNavActive : ""}><c.icon size={13}/>{c.title}</span>)}</aside><div className={s.productContent}><div className={s.productBreadcrumb}>Workspace <span>/</span> {item.title}</div><h3>{item.title}</h3><p>{selected === 0 ? "Your next good idea, on the calendar." : item.body}</p><div className={s.productToolbar}><span>{selected === 4 ? "Last 7 days" : "All accounts"} <ChevronDown size={12}/></span><span>Connected to your agent <span className={s.greenDot}/></span></div>{selected === 0 ? <div className={s.calendarGrid}>{["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(d => <small key={d}>{d}</small>)}{Array.from({ length: 21 }, (_, i) => <div key={i}><span>{i + 1}</span>{[2, 5, 9, 11, 16, 18].includes(i) && <p className={i % 2 ? s.calendarPink : s.calendarLime}>{i % 2 ? "New collection" : "Behind the scenes"}<small>10:00 AM</small></p>}</div>)}</div> : <div className={s.workspaceRows}>{(selected === 1 ? ["Launch-day replies", "Send the guide", "Answer product questions", "Welcome new conversations"] : selected === 2 ? ["collection-launch.jpg", "behind-the-scenes.mp4", "studio-story.jpg", "product-details.jpg"] : selected === 3 ? ["Shop the collection", "Our latest launch", "Get the guide", "Behind the scenes"] : selected === 4 ? ["Post views", "Campaign replies", "Link clicks", "Audience engagement"] : ["Instagram account", "Facebook Page", "Workspace members", "Agent connection"]).map((t, i) => <div key={t}><span className={s.rowIcon}><item.icon size={16}/></span><b>{t}</b><span>{selected === 4 ? ["12,840", "286", "412", "4.8%"][i] : selected === 2 ? "Ready" : "Active"}</span></div>)}</div>}<small className={s.productFootnote}>Example workspace · your agent and dashboard stay in sync.</small></div></div></div></div></div>;
}
export function LandingPage({ supportEmail }: {
    supportEmail?: string;
}) {
    const contactDialog = useRef<HTMLDialogElement>(null);
    const menu = useRef<HTMLDetailsElement>(null);
    const contactHref = supportEmail ? `mailto:${supportEmail}?subject=Kult%20team%20enquiry` : "https://github.com/ChandraDvitiyah/openreply/issues/new?title=Kult%20team%20enquiry";
    return <main className={s.page}>
    <a href="#main-content" className={s.skipLink}>Skip to content</a>
    <header className={s.header}>
      <Link href="/" aria-label="Kult home"><Brand /></Link>
      <nav aria-label="Main navigation" className={s.desktopNav}><a href="#features">The suite</a><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><a href="#faq">FAQs</a></nav>
      <div className={s.navActions}><Link href="/signup" className={s.darkButton}>Start free <ArrowUpRight size={18}/></Link><details ref={menu} className={s.mobileMenu}><summary aria-label="Toggle navigation"><Menu size={21}/></summary><nav aria-label="Mobile navigation">{[["The suite", "#features"], ["How it works", "#how-it-works"], ["Pricing", "#pricing"], ["FAQs", "#faq"]].map(([label, href]) => <a href={href} key={href} onClick={() => { if (menu.current)
        menu.current.open = false; }}>{label}<ArrowUpRight size={15}/></a>)}</nav></details></div>
    </header>
    <section className={s.hero} id="main-content">
      <div className={s.eyebrow}><span className={s.greenDot}/> One MCP server. Your entire marketing workflow.</div>
      <h1>The Marketing Suite<br /><span className={s.highlight}>for your Agent.</span></h1>
      <p className={s.heroDescription}>Give your agent the tools to run marketing, end to end.<br />{" "}Content, conversations, links, and insights. All connected.</p>
      <HeroChat /><Actions />
      <div className={s.compatibility}><span>Made for the agents you already use</span><div>{tools.map(t => <span key={t.name} title={t.name}><AgentIcon {...t}/></span>)}<small>MCP</small></div></div>
    </section>
    <section id="features" className={s.section}><h2>One connection does the whole job.</h2><FeatureCards /></section>
    <section id="how-it-works" className={s.section}><h2>Ask your agent to handle it.</h2><AgentDemo /></section>
    <section className={s.section} id="suite"><Suite /></section>
    <section className={s.section}><h2>Or take the wheel yourself.</h2><div className={s.threeCards}>
      <article className={s.simpleCard}><h3><CalendarDays size={20}/> The dashboard</h3><p>Schedule a post, edit a campaign, or check a report. Everything your agent does is right here.</p><div className={s.smallPreview}><WindowBar>Your workspace</WindowBar><div className={s.previewRows}><span><CalendarDays size={16}/> Content calendar <ArrowUpRight size={14}/></span><span><MessageCircle size={16}/> Automations <ArrowUpRight size={14}/></span><span><BarChart3 size={16}/> Performance <ArrowUpRight size={14}/></span></div></div><Link href="/dashboard" className={s.cardLink}>Open your workspace <ArrowRight size={14}/></Link></article>
      <article className={s.simpleCard}><h3><Sparkles size={20}/> The playbooks</h3><p>Start with a ready-made campaign. Make it yours, then let your agent put it to work.</p><div className={s.smallPreview}><WindowBar>Campaign playbooks</WindowBar><div className={s.previewRows}><span><span className={s.templateDot}/> Launch a product <span>01</span></span><span><span className={s.templateDot}/> Share a free guide <span>02</span></span><span><span className={s.templateDot}/> Turn comments into DMs <span>03</span></span></div></div><Link href="/templates" className={s.cardLink}>Explore templates <ArrowRight size={14}/></Link></article>
      <article className={s.simpleCard}><h3><Terminal size={20}/> The connection</h3><p>One endpoint for your favorite MCP client. Connect once, and keep your tools together.</p><div className={`${s.smallPreview} ${s.terminalPreview}`}><WindowBar>MCP connection</WindowBar><code><span>server</span> kult<br /><span>endpoint</span> /api/mcp<br /><span>transport</span> Streamable HTTP<br /><b>✓ Your marketing toolkit, connected.</b></code></div><Link href="/agents" className={s.cardLink}>Connect your agent <ArrowRight size={14}/></Link></article>
    </div></section>
    <section className={s.section} id="pricing"><h2>Pricing</h2><div className={s.pricingGrid}>
      <article className={s.priceCard}><div className={s.planHeading}><h3>Free</h3><span>Get started</span></div><p className={s.price}>$0 <small>no card required</small></p><Link href="/signup" className={s.softButton}>Start free</Link><ul>{["One connected marketing workspace", "Agent access through MCP", "Content scheduling and publishing", "Instagram and Facebook automations", "Smart links and performance insights"].map(t => <li key={t}><Check size={15}/>{t}</li>)}</ul></article>
      <article className={s.priceCard}><div className={s.planHeading}><h3>Growth</h3><span className={s.limeBadge}>Coming next</span></div><p className={`${s.price} ${s.wordPrice}`}>Coming soon</p><button className={s.darkButton} disabled>On the way</button><p className={s.planDescription}>For your next chapter.</p><ul>{["A plan for growing brands", "Pricing to be announced", "Full plan details at launch"].map(t => <li key={t}><Check size={15}/>{t}</li>)}</ul><p className={s.planNote}>Start with Free while we build what’s next.</p></article>
      <article className={s.priceCard}><div className={s.planHeading}><h3>Teams</h3><span>Work together</span></div><p className={`${s.price} ${s.wordPrice}`}>Let’s talk</p><button className={s.softButton} onClick={() => contactDialog.current?.showModal()}>Get in touch <ArrowUpRight size={14}/></button><p className={s.planDescription}>Have a bigger workflow in mind?</p><ul>{["Tell us about your team", "Walk through your marketing workflow", "Discuss what you need from Kult"].map(t => <li key={t}><Check size={15}/>{t}</li>)}</ul></article>
    </div><p className={s.pricingNote}>Free reflects the current self-hosted offering. Hosting and AI provider costs are separate. Growth pricing is coming soon.</p></section>
    <section className={s.section} id="faq"><h2>Frequently asked questions</h2><div className={s.faqGrid}>{faqs.map(([q, a]) => <article key={q}><h3>{q}</h3><p>{a}</p></article>)}</div></section>
    <section className={s.section}><h2>Built for the way you work.</h2><div className={s.forEveryone}><div><span className={s.brandEmblem}><KultMonogram /></span><h3>Your agent brings the ideas.<br />Kult makes them happen.</h3><p>From your first post to your next big launch.<br />One place for everything that comes after “let’s do it.”</p><div className={s.platformNames}><Instagram size={20}/> Instagram <span>f</span> Facebook <span>⌘</span> MCP</div></div></div><div className={s.audienceGrid}><article><Users size={26}/><h3>A little team. A lot of possibility.</h3><p>Keep your team, accounts, content, and conversations working together. Give your agent the context to help.</p><Link href="/signup" className={s.cardLink}>Build your workspace <ArrowRight size={15}/></Link></article><article><ShieldCheck size={26}/><h3>Your workspace. Your say.</h3><p>Connect the accounts you choose. Manage agent access, review drafts, and stay in control of what goes live.</p><Link href="/agents" className={s.cardLink}>Set up agent access <ArrowRight size={15}/></Link></article></div></section>
    <section className={`${s.section} ${s.finalCta}`}><div className={s.finalShade}/><div className={s.finalContent}><span className={s.finalEmblem}><KultMonogram /></span><h2>Your next launch starts<br />with a conversation.</h2><p>Give your agent a marketing suite.<br />Then tell it what you have in mind.</p><Actions /></div></section>
    <footer className={s.footer}><div className={s.footerTop}><div><Link href="/" aria-label="Kult home"><Brand /></Link><p className={s.footerEyebrow}>Less busywork. More good ideas.</p><h2>The Marketing Suite<br />for your Agent.</h2><Actions /></div><div className={s.footerRight}><div className={s.footerArt} aria-hidden="true"><MessageCircle /><span className={s.artMonogram}><KultMonogram /></span><MousePointer2 /><Link2 /><CalendarDays /></div><nav aria-label="Footer navigation"><a href="#features">The suite</a><a href="#how-it-works">How it works</a><a href="#pricing">Pricing</a><Link href="/templates">Templates</Link><Link href="/agents">Connect your agent</Link></nav><nav aria-label="Legal links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/data-deletion">Data deletion</Link><a href="https://github.com/ChandraDvitiyah/openreply">GitHub <ArrowUpRight size={12}/></a></nav></div></div><div className={s.footerBottom}><p>© {new Date().getFullYear()} Kult. All rights reserved.</p><p>Made for people with something to put out into the world.</p></div></footer>
    <dialog ref={contactDialog} aria-labelledby="contact-heading" className={s.contactDialog} onClick={e => { if (e.target === e.currentTarget)
        contactDialog.current?.close(); }}><button className={s.closeDialog} aria-label="Close contact dialog" onClick={() => contactDialog.current?.close()}><X size={20}/></button><Brand /><h2 id="contact-heading">Let’s talk about your team.</h2><p>Tell us which accounts you manage, what your marketing workflow looks like, and how you’d like your agent to help.</p><a className={s.darkButton} href={contactHref}>{supportEmail ? "Email the Kult team" : "Start a conversation on GitHub"}<ArrowUpRight size={16}/></a><small>{supportEmail ? "Opens your email app. Nothing is sent automatically." : "Opens a new GitHub issue. Don’t include account credentials or private customer data."}</small></dialog>
  </main>;
}
