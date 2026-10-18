"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { diffRecords } from "@/lib/diff";
import type { AuditEntry } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select, Skeleton } from "@/components/ui";

const ACTION_COLOR: Record<string, "green" | "red" | "blue" | "amber" | "gray"> = {
  "flag.killswitch": "red",
  "flag.enabled": "green",
  "flag.created": "blue",
  "flag.updated": "amber",
  "flag.deleted": "red",
  "segment.created": "blue",
  "segment.updated": "amber",
  "segment.deleted": "red",
  "experiment.created": "blue",
  "sdkkey.rotated": "amber",
};

export default function AuditTab({ projectId }: { projectId: string }) {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState("all");
  const [action, setAction] = useState("all");
  const [query, setQuery] = useState("");
  const [showUnchanged, setShowUnchanged] = useState(false);

  function load() {
    setLoading(true);
    api
      .listAudit(projectId, { limit: 200 })
      .then((next) => {
        setLogs(next);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const entityTypes = useMemo(() => Array.from(new Set(logs.map((log) => log.entityType))).sort(), [logs]);
  const actions = useMemo(() => Array.from(new Set(logs.map((log) => log.action))).sort(), [logs]);

  const filtered = logs.filter((log) => {
    if (entityType !== "all" && log.entityType !== entityType) return false;
    if (action !== "all" && log.action !== action) return false;
    if (!query.trim()) return true;
    const haystack = `${log.entityKey} ${log.actor} ${log.comment ?? ""} ${log.action}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Control-plane writes are appended with the actor from Settings and a before/after snapshot.
        </p>
        <Button size="sm" variant="outline" onClick={load}>
          Refresh
        </Button>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Entity" htmlFor="audit-entity">
          <Select id="audit-entity" value={entityType} onChange={(event) => setEntityType(event.target.value)}>
            <option value="all">All entities</option>
            {entityTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Action" htmlFor="audit-action">
          <Select id="audit-action" value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="all">All actions</option>
            {actions.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Search" htmlFor="audit-search" className="sm:col-span-2">
          <Input
            id="audit-search"
            value={query}
            placeholder="key, actor, or comment"
            onChange={(event) => setQuery(event.target.value)}
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} />
        Show unchanged fields in diffs
      </label>

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading audit log">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState title={logs.length === 0 ? "No audit entries yet" : "No entries match these filters"}>
          {logs.length === 0
            ? "Create or toggle a flag and the write will show up here."
            : "Clear a filter to see the rest of the trail."}
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => (
            <Card key={log.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={ACTION_COLOR[log.action] ?? "gray"}>{log.action}</Badge>
                  <span className="text-sm font-medium">{log.entityType}</span>
                  <code className="text-xs text-muted-foreground">{log.entityKey}</code>
                </div>
                <time className="text-xs text-muted-foreground" dateTime={log.createdAt}>
                  {new Date(log.createdAt).toLocaleString()}
                </time>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                by {log.actor}
                {log.comment ? ` — ${log.comment}` : ""}
              </div>
              <AuditDiff before={log.before} after={log.after} showUnchanged={showUnchanged} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AuditDiff({
  before,
  after,
  showUnchanged,
}: {
  before: unknown;
  after: unknown;
  showUnchanged: boolean;
}) {
  if (before == null && after == null) return null;
  const rows = diffRecords(before, after);
  const visible = showUnchanged ? rows : rows.filter((row) => row.before !== row.after);
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted-foreground">
        {visible.length} changed field{visible.length === 1 ? "" : "s"}
      </summary>
      {visible.length === 0 ? (
        <p className="mt-2 text-muted-foreground">No field-level changes. The raw snapshot is below.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[32rem] border-collapse text-left">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-2 font-medium">Field</th>
                <th className="py-1 pr-2 font-medium">Before</th>
                <th className="py-1 font-medium">After</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 40).map((row) => (
                <tr key={row.path} className="border-t border-border align-top">
                  <td className="py-1 pr-2 font-mono">{row.path}</td>
                  <td className="py-1 pr-2 text-red-800">{row.before}</td>
                  <td className="py-1 text-green-800">{row.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length > 40 && (
            <p className="mt-1 text-muted-foreground">Showing 40 of {visible.length} fields.</p>
          )}
        </div>
      )}
      <div className="mt-2 grid gap-2 lg:grid-cols-2">
        <pre className="overflow-x-auto rounded bg-red-50 p-2 text-red-900">{JSON.stringify(before ?? {}, null, 2)}</pre>
        <pre className="overflow-x-auto rounded bg-green-50 p-2 text-green-900">{JSON.stringify(after ?? {}, null, 2)}</pre>
      </div>
    </details>
  );
}
