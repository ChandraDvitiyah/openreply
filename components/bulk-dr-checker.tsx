"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUpRight, Check, Download, Globe2, Info, LoaderCircle, Search, ShieldCheck } from "lucide-react";
import { domainRatingsCsv, MAX_DR_DOMAINS, MAX_DR_INPUT_LENGTH, parseDomains, type DomainRatingResult } from "@/lib/seo/domains";

type CheckResponse = { results: DomainRatingResult[]; checkedAt: string };
const PAGE_SIZE = 50;

export default function BulkDrChecker({ configured }: { configured: boolean }) {
  const [input, setInput] = useState("");
  const [report, setReport] = useState<CheckResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("rating-desc");
  const [page, setPage] = useState(0);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => requestRef.current?.abort(), []);

  const parsed = parseDomains(input);
  const overLimit = parsed.domains.length > MAX_DR_DOMAINS;
  const canCheck = configured && parsed.domains.length > 0 && !parsed.invalid.length && !overLimit && !loading;
  const rated = report?.results.filter((row) => row.rating !== null) ?? [];
  const average = rated.length ? (rated.reduce((sum, row) => sum + row.rating!, 0) / rated.length).toFixed(1) : "—";
  const filtered = (report?.results ?? []).filter((row) => row.domain.includes(search.toLowerCase().trim())).sort((a, b) => {
    if (sort === "domain") return a.domain.localeCompare(b.domain);
    if (a.rating === null) return b.rating === null ? a.domain.localeCompare(b.domain) : 1;
    if (b.rating === null) return -1;
    return (sort === "rating-asc" ? a.rating - b.rating : b.rating - a.rating) || a.domain.localeCompare(b.domain);
  });
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  async function checkDomains(event: React.FormEvent) {
    event.preventDefault();
    if (!canCheck || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/seo/bulk-dr", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to check these domains. Please try again.");
      setReport(data as CheckResponse);
      setSearch("");
      setPage(0);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Unable to reach the checker. Please try again.");
    } finally {
      requestRef.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  function exportResults() {
    if (!report) return;
    const blob = new Blob(["\uFEFF", domainRatingsCsv(report.results, report.checkedAt)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kult-domain-ratings-${report.checkedAt.slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <p className="mb-3 text-[12px] text-[#5d5d5d]">SEO <span className="mx-2 text-[#9e9e9e]">/</span> Domain authority</p>
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#dcebd2] bg-[#eff8e9]"><Globe2 aria-hidden="true" size={20} strokeWidth={1.7} /></span>
            <div>
              <h2>Know the strength of every domain.</h2>
              <p className="mt-1 text-[13px] leading-relaxed text-[#5d5d5d]">Check Domain Rating in bulk. Compare websites and find your next opportunity.</p>
            </div>
          </div>
        </div>
        <span className={`mt-1 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] ${configured ? "border-[#dcebd2] bg-[#eff8e9] text-[#1e5653]" : "border-[#e6e6e3] bg-white text-[#5d5d5d]"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${configured ? "bg-[#1e5653]" : "bg-[#9e9e9e]"}`} />
          {configured ? "Ahrefs configured" : "Ahrefs setup needed"}
        </span>
      </div>

      {!configured && (
        <div className="flex items-start gap-3 rounded-2xl border border-[#e9dfc7] bg-[#fbf8ee] px-4 py-3 text-[13px] leading-relaxed text-[#9a6700]">
          <Info aria-hidden="true" size={14} className="mt-0.5 shrink-0" strokeWidth={1.8} />
          <p><span className="font-medium">Connect Ahrefs to start checking.</span> Your workspace administrator needs to finish the Ahrefs connection. You can prepare your domain list below.</p>
        </div>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <form onSubmit={checkDomains} className="panel overflow-hidden rounded-2xl">
          <div className="border-b border-[#e6e6e3] px-5 py-4">
            <h3>Your domains</h3>
            <p id="domain-help" className="mt-1 text-[12px] leading-relaxed text-[#5d5d5d]">One domain per line, or separated by commas.<br />Up to 1,000 unique domains per check.</p>
          </div>
          <div className="p-5">
            <label htmlFor="domain-list" className="sr-only">Domains or website URLs</label>
            <textarea id="domain-list" value={input} disabled={loading} maxLength={MAX_DR_INPUT_LENGTH} spellCheck={false} autoCapitalize="none" autoCorrect="off"
              onChange={(event) => { setInput(event.target.value); setError(null); }}
              aria-describedby={`domain-help domain-count${parsed.invalid.length || overLimit ? " domain-validation" : ""}`}
              aria-invalid={parsed.invalid.length > 0 || overLimit}
              placeholder={"example.com\nahrefs.com\nhttps://yourwebsite.com"}
              className="min-h-[260px] w-full resize-y border border-[#e6e6e3] bg-[#f7f7f5] p-3 text-[13px] leading-7 placeholder:text-[#9e9e9e] focus:outline-2 focus:outline-[#292929] disabled:opacity-60" />
            <div id="domain-count" className="mt-2 flex flex-wrap justify-between gap-2 text-[12px] text-[#5d5d5d]">
              <span className={overLimit ? "text-[#b42318]" : ""}>{parsed.domains.length.toLocaleString()} / 1,000 domains</span>
              {parsed.duplicates > 0 && <span>{parsed.duplicates} duplicate{parsed.duplicates === 1 ? "" : "s"} removed</span>}
            </div>
            {(parsed.invalid.length > 0 || overLimit) && (
              <p id="domain-validation" className="mt-3 break-words text-[12px] leading-relaxed text-[#b42318]">
                {overLimit ? "Limit your list to 1,000 unique domains. " : ""}
                {parsed.invalid.length > 0 && `Correct ${parsed.invalid.length} invalid entr${parsed.invalid.length === 1 ? "y" : "ies"}: ${parsed.invalid.slice(0, 3).join(", ")}${parsed.invalid.length > 3 ? "…" : ""}`}
              </p>
            )}
            <div className="mt-3 flex items-center justify-between text-[12px] text-[#5d5d5d]">
              <button type="button" disabled={loading} onClick={() => { setInput("ahrefs.com\nwikipedia.org\ngithub.com"); setError(null); }} className="underline decoration-[#9e9e9e] underline-offset-4 hover:text-[#292929] disabled:opacity-50">Use sample domains</button>
              <button type="button" disabled={!input || loading} onClick={() => { setInput(""); setError(null); }} className="hover:text-[#292929] disabled:opacity-40">Clear</button>
            </div>
            <button type="submit" disabled={!canCheck} className="button-primary mt-5 w-full gap-2 disabled:cursor-not-allowed disabled:opacity-45">
              {loading ? <><LoaderCircle aria-hidden="true" size={14} className="animate-spin" strokeWidth={1.8} /> Checking domains…</> : <>Check Domain Rating <ArrowRight aria-hidden="true" size={14} strokeWidth={1.8} /></>}
            </button>
            {error && <p role="alert" className="mt-3 text-[13px] leading-relaxed text-[#b42318]">{error}</p>}
            <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-[#9e9e9e]"><ShieldCheck aria-hidden="true" size={14} className="mt-0.5 shrink-0" strokeWidth={1.8} />URLs are reduced to domains. Subdomains are kept; duplicates are checked once.</p>
          </div>
          <div className="border-t border-[#e6e6e3] bg-[#f7f7f5] px-5 py-4">
            <a href="https://ahrefs.com/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[12px] text-[#5d5d5d] hover:text-[#292929]">Domain Rating by Ahrefs <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} /></a>
          </div>
        </form>

        <section className="panel min-w-0 overflow-hidden rounded-2xl" aria-label="Domain rating results" aria-busy={loading}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e6e3] px-5 py-4">
            <div>
              <h3>Domain ratings</h3>
              <p className="mt-1 text-[12px] text-[#5d5d5d]">{report ? `Last check · ${new Date(report.checkedAt).toLocaleString()}` : "Your domain comparison starts here"}</p>
            </div>
            <button type="button" disabled={!report?.results.length || loading} onClick={exportResults} className="button-secondary gap-2 disabled:opacity-40"><Download aria-hidden="true" size={14} strokeWidth={1.8} /> Export all</button>
          </div>

          <p role="status" className="sr-only">{loading ? "Checking domains with Ahrefs." : report ? `${rated.length} ratings returned. ${report.results.length - rated.length} unavailable.` : "Enter domains to begin."}</p>
          {loading ? (
            <div className="flex min-h-[410px] flex-col items-center justify-center px-6 text-center">
              <LoaderCircle aria-hidden="true" size={20} className="mb-5 animate-spin text-[#5d5d5d]" strokeWidth={1.7} />
              <h3>Checking {parsed.domains.length.toLocaleString()} domains</h3>
              <p className="mt-2 text-[13px] text-[#5d5d5d]">Getting the latest available ratings from Ahrefs…</p>
            </div>
          ) : !report ? (
            <div className="flex min-h-[410px] flex-col items-center justify-center px-6 py-12 text-center">
              <div className="relative mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-[#e6e6e3] bg-[#f7f7f5]">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-white"><Globe2 aria-hidden="true" size={20} strokeWidth={1.7} className="text-[#5d5d5d]" /></div>
                <span className="absolute -right-2 -bottom-2 grid h-7 w-7 place-items-center rounded-full border-4 border-white bg-[#9ce069]"><Check aria-hidden="true" size={14} strokeWidth={1.8} /></span>
              </div>
              <h3>A little research. A clearer picture.</h3>
              <p className="mt-2 max-w-xs text-[13px] leading-relaxed text-[#5d5d5d]">Add your domains and run a check to compare their backlink strength, side by side.</p>
              <div className="mt-6 flex flex-wrap justify-center gap-x-5 gap-y-2 text-[12px] text-[#9e9e9e]"><span>01 &nbsp; Add domains</span><span>02 &nbsp; Check ratings</span><span>03 &nbsp; Export results</span></div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-3 border-b border-[#e6e6e3] bg-[#f7f7f5] px-5 py-4">
                {[{ label: "Domains checked", value: report.results.length }, { label: "Average DR", value: average }, { label: "Ratings available", value: rated.length }].map(({ label, value }) => <div key={label}><p className="text-[12px] text-[#5d5d5d]">{label}</p><p className="mt-1 text-[24px] font-medium tabular-nums">{value}</p></div>)}
              </div>
              <div className="flex flex-wrap gap-3 px-5 py-4">
                <div className="relative min-w-0 flex-1"><Search aria-hidden="true" size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-[#9e9e9e]" strokeWidth={1.8} /><input aria-label="Search results" placeholder="Search domains" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} className="h-9 w-full min-w-32 border bg-white pr-3 pl-9" /></div>
                <select aria-label="Sort results" value={sort} onChange={(event) => { setSort(event.target.value); setPage(0); }} className="h-9 border bg-white px-3"><option value="rating-desc">Highest DR first</option><option value="rating-asc">Lowest DR first</option><option value="domain">Domain A–Z</option></select>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="border-y border-[#e6e6e3] bg-[#f7f7f5]"><tr><th scope="col" className="px-5 py-3">Domain</th><th scope="col" className="px-5 py-3">Domain Rating</th><th scope="col" className="px-5 py-3 text-right">Status</th></tr></thead>
                  <tbody className="divide-y divide-[#e6e6e3]">
                    {visible.map((row) => <tr key={row.domain} className="hover:bg-[#f7f7f5]">
                      <td className="max-w-64 break-all px-5 py-4 font-medium">{row.domain}</td>
                      <td className="px-5 py-4"><div className="flex items-center gap-3"><span className="w-9 shrink-0 tabular-nums">{row.rating === null ? "—" : Number(row.rating.toFixed(1))}</span><span aria-hidden="true" className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-[#e6e6e3] sm:block"><span className="block h-full rounded-full bg-[#9ce069]" style={{ width: `${row.rating ?? 0}%` }} /></span></div></td>
                      <td className="px-5 py-4 text-right"><span className={`whitespace-nowrap text-[12px] ${row.rating === null ? "text-[#9e9e9e]" : "text-[#1e5653]"}`}>{row.rating === null ? "Unavailable" : "Checked"}</span></td>
                    </tr>)}
                    {!visible.length && <tr><td colSpan={3} className="px-5 py-12 text-center text-[#5d5d5d]">No domains match your search.</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6e6e3] px-5 py-3 text-[12px] text-[#5d5d5d]">
                <span>{filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} of {filtered.length.toLocaleString()} domains</span>
                {pageCount > 1 && <div className="flex items-center gap-3"><button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="disabled:opacity-35">Previous</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)} className="disabled:opacity-35">Next</button></div>}
              </div>
            </>
          )}
          <div className="flex items-start gap-2 border-t border-[#e6e6e3] px-5 py-4 text-[12px] leading-relaxed text-[#9e9e9e]"><Info aria-hidden="true" size={14} className="mt-0.5 shrink-0" strokeWidth={1.8} /><p>DR measures backlink strength on a logarithmic scale from 0 to 100. It is a comparative metric, not a Google ranking factor.</p></div>
        </section>
      </div>
    </div>
  );
}
