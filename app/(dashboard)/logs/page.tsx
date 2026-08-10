"use client";

/**
 * DM Logs Page
 *
 * Filterable, paginated table of DM logs.
 */

import { useEffect, useState, useCallback } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import StatusBadge from "@/components/status-badge";
import { TableLoadingRows } from "@/components/dashboard-loading-skeleton";
import { useDashboardDataCache } from "@/components/dashboard-data-cache";

interface DmLog {
  id: string;
  commenterId: string;
  commenterName: string | null;
  commentText: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
  automation: { name: string; keywords: string[] };
  instagramAccount: { username: string };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const STATUS_FILTERS = [
  "ALL",
  "SENT",
  "FAILED",
  "PENDING",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
  "SKIPPED_DEDUP",
];

type LogsPageData = { logs: DmLog[]; pagination: Pagination };

function logsCacheKey(page: number, status: string, accountId: string) {
  return `logs:${page}:${status}:${accountId}`;
}

export default function LogsPage() {
  const dataCache = useDashboardDataCache();
  const initialCache = dataCache.get<LogsPageData>(logsCacheKey(1, "ALL", "all"));
  const [logs, setLogs] = useState<DmLog[]>(() => initialCache?.logs ?? []);
  const [pagination, setPagination] = useState<Pagination | null>(() => initialCache?.pagination ?? null);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(() => initialCache !== null);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: "20" });
      if (statusFilter !== "ALL") params.set("status", statusFilter);
      if (selectedAccountId !== "all") {
        params.set("instagramAccountId", selectedAccountId);
      }

      const res = await fetch(`/api/logs?${params}`, { cache: "no-store" });
      const data = await res.json();
      if (data.success) {
        setLogs(data.data.logs);
        setPagination(data.data.pagination);
        dataCache.set(logsCacheKey(page, statusFilter, selectedAccountId), data.data);
        setHasLoaded(true);
      }
    } catch (err) {
      console.error("Failed to fetch logs:", err);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, selectedAccountId, dataCache]);

  useEffect(() => {
    fetch("/api/instagram/accounts", { cache: "no-store" })
      .then((res) => res.json())
      .then((payload) => {
        if (payload.success) setAccounts(payload.data.instagramAccounts ?? []);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchLogs();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchLogs]);

  function handleFilterChange(status: string) {
    const cached = dataCache.get<LogsPageData>(logsCacheKey(1, status, selectedAccountId));
    setLogs(cached?.logs ?? []);
    setPagination(cached?.pagination ?? null);
    setHasLoaded(cached !== null);
    setLoading(true);
    setStatusFilter(status);
    setPage(1);
  }

  function handleAccountChange(accountId: string) {
    const cached = dataCache.get<LogsPageData>(logsCacheKey(1, statusFilter, accountId));
    setLogs(cached?.logs ?? []);
    setPagination(cached?.pagination ?? null);
    setHasLoaded(cached !== null);
    setLoading(true);
    setSelectedAccountId(accountId);
    setPage(1);
  }

  function handlePageChange(nextPage: number) {
    const cached = dataCache.get<LogsPageData>(logsCacheKey(nextPage, statusFilter, selectedAccountId));
    setLogs(cached?.logs ?? []);
    setPagination(cached?.pagination ?? null);
    setHasLoaded(cached !== null);
    setLoading(true);
    setPage(nextPage);
  }

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              onClick={() => handleFilterChange(status)}
              className={`
                px-3 py-1.5 rounded-lg text-xs font-medium transition-all
                ${
                  statusFilter === status
                    ? "bg-accent/15 text-accent border border-accent/20"
                    : "bg-surface text-muted border border-border hover:border-border-hover hover:text-foreground"
                }
              `}
            >
              {status === "ALL" ? "All" : status.replace("SKIPPED_", "").replace("_", " ")}
            </button>
          ))}
        </div>
        {accounts.length > 1 && (
          <AccountSelect
            accounts={accounts}
            value={selectedAccountId}
            onChange={handleAccountChange}
          />
        )}
      </div>

      {/* Table */}
      <div className="panel rounded overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-6 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Commenter</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Comment</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Campaign</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Account</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Status</th>
                <th className="px-6 py-4 text-xs font-semibold text-muted uppercase tracking-wider">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading && !hasLoaded && (
                <TableLoadingRows columns={6} rows={5} />
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted">
                    No logs found
                  </td>
                </tr>
              )}
              {hasLoaded &&
                logs.map((log) => (
                  <tr key={log.id} className="hover:bg-surface-hover/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-medium text-foreground">
                        @{log.commenterName ?? log.commenterId.slice(0, 8)}
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-[200px]">
                      <span className="text-muted truncate block">{log.commentText}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-muted">{log.automation.name}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-muted">@{log.instagramAccount.username}</span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={log.status} />
                    </td>
                    <td className="px-6 py-4 text-muted whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-border">
            <p className="text-xs text-muted">
              Showing {(pagination.page - 1) * pagination.limit + 1}–
              {Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
              {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:text-foreground hover:border-border-hover transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                Previous
              </button>
              <span className="text-xs text-muted px-2">
                {page} / {pagination.totalPages}
              </span>
              <button
                disabled={page >= pagination.totalPages}
                onClick={() => handlePageChange(page + 1)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted border border-border hover:text-foreground hover:border-border-hover transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
