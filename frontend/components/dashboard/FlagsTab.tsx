"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Toggle } from "@/components/ui";
import FlagDrawer from "./FlagDrawer";

export default function FlagsTab({ projectId, envId }: { projectId: string; envId: string }) {
  const [flags, setFlags] = useState<any[]>([]);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [kind, setKind] = useState("boolean");

  const load = useCallback(() => {
    if (!envId) return;
    api.listFlags(projectId).then(setFlags);
  }, [projectId, envId]);

  useEffect(() => {
    load();
  }, [load]);

  function configFor(flag: any) {
    return flag.configs?.find((c: any) => c.environmentId === envId);
  }

  async function toggle(flag: any, on: boolean) {
    await api.toggleFlag(projectId, flag.key, envId, on, on ? "enabled from dashboard" : "kill switch");
    load();
  }

  async function create() {
    const variations =
      kind === "boolean" ? [true, false] : kind === "number" ? [1, 0] : kind === "json" ? [{}, {}] : ["on", "off"];
    await api.createFlag(projectId, { key: newKey, name: newName, kind, variations });
    setNewKey("");
    setNewName("");
    setCreating(false);
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Toggle the switch to flip the kill switch for this environment. Click a flag to edit targeting.
        </p>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          + New flag
        </Button>
      </div>

      {creating && (
        <Card className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">Key</label>
            <Input value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="new-feature" />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="mb-1 block text-xs text-muted-foreground">Name</label>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New Feature" />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Type</label>
            <select
              className="h-10 rounded-lg border border-border bg-background px-3 text-sm"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="boolean">boolean</option>
              <option value="string">string</option>
              <option value="number">number</option>
              <option value="json">json</option>
            </select>
          </div>
          <Button onClick={create}>Create</Button>
        </Card>
      )}

      <div className="space-y-2">
        {flags.map((flag) => {
          const cfg = configFor(flag);
          return (
            <Card key={flag.id} className="flex items-center justify-between py-3">
              <button className="flex-1 text-left" onClick={() => setOpenKey(flag.key)}>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{flag.name}</span>
                  <Badge>{flag.kind}</Badge>
                  {flag.tags?.map((t: string) => (
                    <Badge key={t} color="blue">
                      {t}
                    </Badge>
                  ))}
                </div>
                <code className="text-xs text-muted-foreground">{flag.key}</code>
              </button>
              <div className="flex items-center gap-3">
                <Badge color={cfg?.on ? "green" : "gray"}>{cfg?.on ? "on" : "off"}</Badge>
                <span className="text-xs text-muted-foreground">v{cfg?.version}</span>
                <Toggle checked={!!cfg?.on} onChange={(v) => toggle(flag, v)} />
              </div>
            </Card>
          );
        })}
        {flags.length === 0 && <p className="text-sm text-muted-foreground">No flags yet.</p>}
      </div>

      {openKey && (
        <FlagDrawer
          projectId={projectId}
          envId={envId}
          flagKey={openKey}
          onClose={() => {
            setOpenKey(null);
            load();
          }}
        />
      )}
    </div>
  );
}
