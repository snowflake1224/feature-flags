"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Textarea } from "@/components/ui";

export default function FlagDrawer({
  projectId,
  envId,
  flagKey,
  onClose,
}: {
  projectId: string;
  envId: string;
  flagKey: string;
  onClose: () => void;
}) {
  const [flag, setFlag] = useState<any>(null);
  const [cfg, setCfg] = useState<any>(null);
  const [rollout, setRollout] = useState<number>(0);
  const [rulesText, setRulesText] = useState("[]");
  const [targetsText, setTargetsText] = useState("[]");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // test targeting
  const [ctxText, setCtxText] = useState('{\n  "key": "user-123",\n  "country": "US"\n}');
  const [evalResult, setEvalResult] = useState<any>(null);

  useEffect(() => {
    api.getFlag(projectId, flagKey).then((f) => {
      setFlag(f);
      const c = f.configs.find((x: any) => x.environmentId === envId);
      setCfg(c);
      const ft = c?.fallthrough ?? {};
      if (ft.rollout) {
        const on = ft.rollout.variations.find((v: any) => v.variation === 0);
        setRollout(on?.weight ?? 0);
      } else {
        setRollout(ft.variation === 0 ? 100 : 0);
      }
      setRulesText(JSON.stringify(c?.rules ?? [], null, 2));
      setTargetsText(JSON.stringify(c?.targets ?? [], null, 2));
    });
  }, [projectId, flagKey, envId]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const isBoolean = flag.kind === "boolean";
      const fallthrough =
        isBoolean && rollout > 0 && rollout < 100
          ? {
              rollout: {
                variations: [
                  { variation: 0, weight: rollout },
                  { variation: 1, weight: 100 - rollout },
                ],
              },
            }
          : { variation: rollout >= 100 ? 0 : rollout <= 0 ? 1 : 0 };
      await api.updateConfig(projectId, flagKey, envId, {
        fallthrough,
        rules: JSON.parse(rulesText),
        targets: JSON.parse(targetsText),
        comment: "edited targeting from dashboard",
      });
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    try {
      const ctx = JSON.parse(ctxText);
      setEvalResult(await api.evaluate(projectId, flagKey, envId, ctx));
    } catch (e: any) {
      setErr(e.message);
    }
  }

  if (!flag) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">{flag.name}</h2>
            <code className="text-xs text-muted-foreground">{flag.key}</code>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕
          </Button>
        </div>

        <div className="mb-4 flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Variations:</span>
          {(flag.variations as any[]).map((v, i) => (
            <Badge key={i} color="blue">
              {i}: {JSON.stringify(v)}
            </Badge>
          ))}
        </div>

        {flag.kind === "boolean" && (
          <section className="mb-6">
            <label className="mb-1 block text-sm font-medium">
              Default rollout (percent served <code>true</code>)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={rollout}
                onChange={(e) => setRollout(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-12 text-right text-sm font-medium">{rollout}%</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Uses stable per-user hashing, so users stay in their bucket as you ramp up.
            </p>
          </section>
        )}

        <section className="mb-6">
          <label className="mb-1 block text-sm font-medium">Targeting rules (JSON)</label>
          <Textarea rows={8} value={rulesText} onChange={(e) => setRulesText(e.target.value)} />
          <p className="mt-1 text-xs text-muted-foreground">
            Array of {"{ id, clauses:[{attribute, op, values}], variation | rollout }"}. Ops include
            in, contains, semverGreaterThan, segmentMatch, …
          </p>
        </section>

        <section className="mb-6">
          <label className="mb-1 block text-sm font-medium">Individual targets (JSON)</label>
          <Textarea rows={4} value={targetsText} onChange={(e) => setTargetsText(e.target.value)} />
        </section>

        {err && <div className="mb-4 text-sm text-red-600">{err}</div>}

        <div className="mb-8 flex gap-2">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save & propagate"}
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </div>

        <section className="rounded-lg border border-border bg-muted/40 p-4">
          <h3 className="mb-2 text-sm font-semibold">Test targeting</h3>
          <Textarea rows={5} value={ctxText} onChange={(e) => setCtxText(e.target.value)} />
          <div className="mt-2 flex items-center gap-3">
            <Button size="sm" variant="secondary" onClick={runTest}>
              Evaluate
            </Button>
            {evalResult && (
              <div className="text-sm">
                <span className="font-medium">value: </span>
                <code>{JSON.stringify(evalResult.value)}</code>
                <span className="ml-3 text-muted-foreground">reason: {evalResult.reason?.kind}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
