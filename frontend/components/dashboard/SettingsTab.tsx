"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card } from "@/components/ui";

export default function SettingsTab({ project, onChange }: { project: any; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function rotate(envId: string) {
    setBusy(envId);
    await api.rotateKey(envId);
    onChange();
    setBusy(null);
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        SDK keys authenticate a client to a single environment&apos;s dataset. Rotating disables
        old keys immediately.
      </p>
      {project.environments.map((env: any) => (
        <Card key={env.id}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge color={env.production ? "red" : "green"}>{env.key}</Badge>
              <span className="font-medium">{env.name}</span>
            </div>
            <Button size="sm" variant="outline" disabled={busy === env.id} onClick={() => rotate(env.id)}>
              {busy === env.id ? "Rotating…" : "Rotate key"}
            </Button>
          </div>
          <div className="mt-3 space-y-1">
            {(env.sdkKeys ?? []).map((k: any) => (
              <div key={k.id} className="flex items-center gap-2 text-sm">
                <code className={`rounded bg-muted px-2 py-1 ${k.active ? "" : "line-through opacity-50"}`}>
                  {k.key}
                </code>
                <Badge color={k.active ? "green" : "gray"}>{k.active ? "active" : "revoked"}</Badge>
                <span className="text-xs text-muted-foreground">{k.kind}</span>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
