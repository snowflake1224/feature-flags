"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Textarea } from "@/components/ui";

export default function SegmentsTab({ projectId, envId }: { projectId: string; envId: string }) {
  const [segments, setSegments] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [included, setIncluded] = useState("");
  const [rulesText, setRulesText] = useState("[]");

  const load = useCallback(() => {
    if (!envId) return;
    api.listSegments(projectId, envId).then(setSegments);
  }, [projectId, envId]);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    await api.createSegment(projectId, envId, {
      key,
      name,
      included: included.split(",").map((s) => s.trim()).filter(Boolean),
      rules: JSON.parse(rulesText),
    });
    setCreating(false);
    setKey("");
    setName("");
    setIncluded("");
    setRulesText("[]");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Reusable cohorts of contexts you can reference from any flag&apos;s targeting rules.
        </p>
        <Button size="sm" onClick={() => setCreating((v) => !v)}>
          + New segment
        </Button>
      </div>

      {creating && (
        <Card className="space-y-3">
          <div className="flex gap-3">
            <Input placeholder="key (beta-users)" value={key} onChange={(e) => setKey(e.target.value)} />
            <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Input
            placeholder="Included keys, comma separated"
            value={included}
            onChange={(e) => setIncluded(e.target.value)}
          />
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Rules (JSON)</label>
            <Textarea rows={5} value={rulesText} onChange={(e) => setRulesText(e.target.value)} />
          </div>
          <Button onClick={create}>Create segment</Button>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {segments.map((s) => (
          <Card key={s.id}>
            <div className="flex items-center justify-between">
              <div className="font-medium">{s.name}</div>
              <Badge color="blue">{s.key}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{s.description || "—"}</p>
            <div className="mt-3 flex gap-4 text-xs text-muted-foreground">
              <span>{s.included?.length ?? 0} included</span>
              <span>{s.excluded?.length ?? 0} excluded</span>
              <span>{(s.rules ?? []).length} rules</span>
            </div>
          </Card>
        ))}
        {segments.length === 0 && <p className="text-sm text-muted-foreground">No segments yet.</p>}
      </div>
    </div>
  );
}
