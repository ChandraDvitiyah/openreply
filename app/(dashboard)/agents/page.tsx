"use client";

import { useEffect, useState } from "react";

type AgentKey = { id: string; name: string; scopes: string[]; revoked: boolean; expired: boolean;
  expiration: number | null; lastUsedAt: number | null };

async function fetchAgentKeys() {
  const all: AgentKey[] = [];
    let offset: number | null = 0;
    do {
      const res = await fetch(`/api/agent-keys?offset=${offset}`, { cache: "no-store" });
      const data: { keys: AgentKey[]; nextOffset: number | null; error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to load keys.");
      all.push(...data.keys);
      offset = data.nextOffset;
    } while (offset !== null);
    return all;
  }

export default function AgentsPage() {
  const [keys, setKeys] = useState<AgentKey[]>([]);
  const [oauthReady, setOAuthReady] = useState<boolean | null>(null);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [endpoint, setEndpoint] = useState("/api/mcp");
  const [name, setName] = useState("");
  const [access, setAccess] = useState("write");
  const [days, setDays] = useState(90);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/.well-known/oauth-protected-resource/api/mcp", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return await res.json() as { resource: string };
      }).then((metadata) => {
        setOAuthReady(Boolean(metadata));
        setEndpoint(metadata?.resource ?? `${window.location.origin}/api/mcp`);
      }).catch(() => { setOAuthReady(false); setEndpoint(`${window.location.origin}/api/mcp`); });
  }, []);

  async function createKey(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null); setSecret(null); setCopied(null);
    try {
      const res = await fetch("/api/agent-keys", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, access, expiresInDays: days }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to create key.");
      setSecret(data.secret); setName("");
      setKeys(await fetchAgentKeys());
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to create key."); }
    finally { setBusy(false); }
  }

  async function revokeKey(id: string) {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/agent-keys", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unable to revoke key.");
      setSecret(null); setKeys(await fetchAgentKeys());
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to revoke key."); }
    finally { setBusy(false); }
  }

  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); }
    catch { setError("Copy manually; clipboard access is unavailable."); }
  }

  const inputStyle = "w-full rounded-lg border border-[#e6e6e3] bg-white px-3 py-2 text-sm";
  const buttonStyle = "rounded-lg bg-[#9ce069] px-4 py-2 text-sm font-medium text-[#292929] disabled:opacity-50";
  return <div className="mx-auto max-w-4xl space-y-6 p-6 text-[#292929]">
    <div><h1 className="text-2xl font-semibold">AI agents</h1>
      <p className="mt-2 text-sm text-[#5d5d5d]">Connect your agent to Kult and let it run campaigns, publish content, reply to conversations, and manage your workspace.</p></div>
    <section className="rounded-xl border border-[#e6e6e3] bg-white p-5">
      <h2 className="font-medium">Connect ChatGPT</h2>
      <p className="mt-2 text-sm text-[#5d5d5d]">Connect your Kult account once, then ask ChatGPT to manage campaigns, publishing, conversations, and your workspace.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><code className="break-all rounded bg-[#f3f3f0] p-3 text-sm">{endpoint}</code>
        <button className={buttonStyle} onClick={() => copy(endpoint, "URL")}>{copied === "URL" ? "Copied" : "Copy URL"}</button></div>
      <a className="mt-4 inline-block text-sm underline" href="https://chatgpt.com/plugins" target="_blank" rel="noreferrer">Open ChatGPT Plugins</a>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[#5d5d5d]">
        <li>Open ChatGPT Plugins on the web, choose Add custom MCP server, and enter Kult with this URL and OAuth authentication. Your administrator provides the OAuth client settings.</li>
        <li>Sign in with your Kult account and approve the requested access. Kult applies your current workspace role to every action.</li>
        <li>Install Kult, select it with @ in a chat, and describe the outcome you want, such as “Create a campaign for my newest reel and check its delivery.”</li>
      </ol>
      {oauthReady === null ? <p className="mt-3 text-xs" role="status">Checking connection availability…</p> : !oauthReady &&
        <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">ChatGPT connection setup is pending. Ask your Kult administrator to finish OAuth setup.</p>}
      <p className="mt-3 text-xs text-[#5d5d5d]">ChatGPT may ask you to confirm actions that change or publish content. New social accounts also require Meta consent.</p>
    </section>
    <details className="space-y-4 rounded-xl border border-[#e6e6e3] bg-white p-5" onToggle={(event) => {
      if (!event.currentTarget.open || keysLoaded) return;
      setKeysLoaded(true);
      fetchAgentKeys().then(setKeys).catch((e) => setError(e.message)).finally(() => setLoading(false));
    }}>
      <summary className="cursor-pointer font-medium">Other MCP clients and agent keys</summary>
      <p className="text-sm text-[#5d5d5d]">For clients that accept custom headers, use this URL with an agent key.</p>
      <pre className="mt-4 overflow-x-auto rounded-lg bg-[#f3f3f0] p-4 text-xs">{JSON.stringify({ mcpServers: { kult: { type: "http", url: endpoint,
        headers: { Authorization: "Bearer YOUR_AGENT_KEY" } } } }, null, 2)}</pre>
      <p className="mt-3 text-xs text-[#5d5d5d]">Configuration syntax varies by client. Give your agent a task such as “Create a campaign for my newest reel, then monitor delivery.”</p>
    <section className="rounded-xl border border-[#e6e6e3] bg-white p-5">
      <h2 className="font-medium">Create an agent key</h2>
      <p className="mt-2 text-sm text-[#5d5d5d]">Keys use your current role in this workspace. Your personal profile and Link Studio belong to you. Copy a new key before leaving this page.</p>
      <form className="mt-4 grid items-end gap-4 sm:grid-cols-4" onSubmit={createKey}>
        <label className="text-sm">Name<input required maxLength={80} className={`${inputStyle} mt-1`} placeholder="My agent" value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-sm">Access<select className={`${inputStyle} mt-1`} value={access} onChange={(e) => setAccess(e.target.value)}><option value="write">Read and write</option><option value="read">Read only</option></select></label>
        <label className="text-sm">Expires in days<input type="number" min={1} max={365} required className={`${inputStyle} mt-1`} value={days} onChange={(e) => setDays(Number(e.target.value))} /></label>
        <button disabled={busy || !name.trim()} className={buttonStyle} type="submit">{busy ? "Working…" : "Create key"}</button>
      </form>
      {secret && <div className="mt-4 rounded-lg border border-[#9ce069] bg-[#f4fbea] p-4">
        <p className="text-sm font-medium">Save this key in your agent’s secret settings</p>
        <code className="mt-2 block break-all text-xs">{secret}</code>
        <div className="mt-3 flex gap-3"><button className={buttonStyle} onClick={() => copy(secret, "key")}>{copied === "key" ? "Copied" : "Copy key"}</button>
          <button className="text-sm underline" onClick={() => setSecret(null)}>Done, hide key</button></div>
      </div>}
    </section>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <section className="rounded-xl border border-[#e6e6e3] bg-white p-5">
      <h2 className="font-medium">Your agent keys</h2>
      {loading ? <p className="mt-4 text-sm" role="status">Loading keys…</p> : keys.length === 0 ? <p className="mt-4 text-sm text-[#5d5d5d]">No agent keys yet.</p> :
        <ul className="mt-3 divide-y divide-[#e6e6e3]">{keys.map((key) => <li key={key.id} className="flex items-center justify-between gap-4 py-4">
          <div><p className="text-sm font-medium">{key.name}</p><p className="mt-1 text-xs text-[#5d5d5d]">
            {key.revoked ? "Revoked" : key.expired ? "Expired" : key.scopes.includes("kult:write") ? "Read and write" : "Read only"}
            {key.expiration ? ` · Expires ${new Date(key.expiration).toLocaleDateString()}` : ""}
            {key.lastUsedAt ? ` · Last used ${new Date(key.lastUsedAt).toLocaleDateString()}` : " · Never used"}
          </p></div>
          {!key.revoked && !key.expired && <button disabled={busy} className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 disabled:opacity-50" onClick={() => revokeKey(key.id)}>Revoke</button>}
        </li>)}</ul>}
    </section>
    </details>
    <section className="rounded-xl border border-[#e6e6e3] bg-white p-5">
      <h2 className="font-medium">What agents can do</h2>
      <p className="mt-2 text-sm text-[#5d5d5d]">Instagram campaigns and templates, Facebook automations, publishing and media uploads, analytics and reports, inbox messages, Link Studio, workspace members, profiles, and diagnostics.</p>
      <p className="mt-3 text-sm text-[#5d5d5d]">After connecting your accounts, agents can run routine workflows. ChatGPT controls confirmations for changes. Meta requires account-owner consent for new social connections. Signup, account security, and agent key management stay with the account owner.</p>
    </section>
  </div>;
}
