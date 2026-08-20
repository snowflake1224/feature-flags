"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Card } from "@/components/ui";

const ACTION_COLOR: Record<string, "green" | "red" | "blue" | "amber" | "gray"> = {
  "flag.killswitch": "red",
  "flag.enabled": "green",
  "flag.created": "blue",
  "flag.updated": "amber",
  "flag.deleted": "red",
};

export default function AuditTab({ projectId }: { projectId: string }) {
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    api.listAudit(projectId).then(setLogs);
  }, [projectId]);

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Every control-plane change is recorded here with actor and before/after snapshot.
      </p>
      {logs.map((l) => (
        <Card key={l.id} className="py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge color={ACTION_COLOR[l.action] ?? "gray"}>{l.action}</Badge>
              <span className="text-sm font-medium">{l.entityType}</span>
              <code className="text-xs text-muted-foreground">{l.entityKey}</code>
            </div>
            <span className="text-xs text-muted-foreground">
              {new Date(l.createdAt).toLocaleString()}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            by {l.actor}
            {l.comment ? ` — ${l.comment}` : ""}
          </div>
          {(l.before || l.after) && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">diff</summary>
              <div className="mt-1 grid grid-cols-2 gap-2">
                <pre className="overflow-x-auto rounded bg-red-50 p-2 text-red-800">
                  {JSON.stringify(l.before ?? {}, null, 2)}
                </pre>
                <pre className="overflow-x-auto rounded bg-green-50 p-2 text-green-800">
                  {JSON.stringify(l.after ?? {}, null, 2)}
                </pre>
              </div>
            </details>
          )}
        </Card>
      ))}
      {logs.length === 0 && <p className="text-sm text-muted-foreground">No audit entries yet.</p>}
    </div>
  );
}
