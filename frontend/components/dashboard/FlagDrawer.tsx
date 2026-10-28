"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { describeReason } from "@/lib/format";
import { asArray, validateTargetingRules } from "@/lib/targeting";
import type { EvalResult, Flag, FlagValue, Prerequisite, Target, TargetingRule, VariationOrRollout } from "@/lib/types";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Drawer,
  Field,
  Input,
  Select,
  Skeleton,
  Textarea,
} from "@/components/ui";
import RuleBuilder from "./RuleBuilder";

export default function FlagDrawer({
  projectId,
  envId,
  flagKey,
  production,
  envName,
  onClose,
}: {
  projectId: string;
  envId: string;
  flagKey: string;
  production: boolean;
  envName: string;
  onClose: () => void;
}) {
  const [flag, setFlag] = useState<Flag | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [offVariation, setOffVariation] = useState(1);
  const [mode, setMode] = useState<"single" | "rollout">("single");
  const [singleVariation, setSingleVariation] = useState(0);
  const [weights, setWeights] = useState<number[]>([100]);
  const [bucketBy, setBucketBy] = useState("");
  const [rules, setRules] = useState<TargetingRule[]>([]);
  const [rulesError, setRulesError] = useState<string | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [prerequisites, setPrerequisites] = useState<Prerequisite[]>([]);
  const [comment, setComment] = useState("edited targeting from dashboard");
  const [siblingFlags, setSiblingFlags] = useState<Flag[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ctxText, setCtxText] = useState('{\n  "key": "user-1",\n  "email": "ada@flagship.dev"\n}');
  const [evalResult, setEvalResult] = useState<EvalResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    api
      .getFlag(projectId, flagKey)
      .then((loaded) => {
        if (cancelled) return;
        setFlag(loaded);
        const config = loaded.configs?.find((item) => item.environmentId === envId);
        const variations = loaded.variations ?? [];
        const fallthrough = (config?.fallthrough ?? {}) as VariationOrRollout;
        const nextWeights = variations.map(() => 0);
        if (fallthrough.rollout?.variations?.length) {
          for (const weighted of fallthrough.rollout.variations) {
            if (nextWeights[weighted.variation] !== undefined) nextWeights[weighted.variation] = weighted.weight;
          }
          setMode("rollout");
          setBucketBy(fallthrough.rollout.bucketBy ?? "");
        } else {
          const variation = fallthrough.variation ?? 0;
          if (nextWeights[variation] !== undefined) nextWeights[variation] = 100;
          setMode("single");
          setSingleVariation(variation);
          setBucketBy("");
        }
        setWeights(nextWeights.length ? nextWeights : [100]);
        setOffVariation(config?.offVariation ?? Math.max(variations.length - 1, 0));
        setRules(asArray<TargetingRule>(config?.rules));
        setTargets(asArray<Target>(config?.targets));
        setPrerequisites(asArray<Prerequisite>(config?.prerequisites));
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    api.listFlags(projectId).then(setSiblingFlags).catch(() => setSiblingFlags([]));
    return () => {
      cancelled = true;
    };
  }, [projectId, flagKey, envId]);

  const variations: FlagValue[] = flag?.variations ?? [];
  const weightSum = weights.reduce((sum, weight) => sum + (Number.isFinite(weight) ? weight : 0), 0);

  function fallthroughPayload(): VariationOrRollout {
    if (mode === "rollout") {
      return {
        rollout: {
          variations: weights.map((weight, variation) => ({ variation, weight: Number(weight) || 0 })),
          ...(bucketBy.trim() ? { bucketBy: bucketBy.trim() } : {}),
        },
      };
    }
    return { variation: singleVariation };
  }

  async function save() {
    if (!flag) return;
    const ruleMessage = rulesError ?? validateTargetingRules(rules);
    if (ruleMessage) {
      setErr(ruleMessage);
      return;
    }
    setSaving(true);
    setErr(null);
    try {
      await api.updateConfig(projectId, flagKey, envId, {
        offVariation,
        fallthrough: fallthroughPayload(),
        rules,
        targets: targets
          .map((target) => ({
            variation: target.variation,
            values: target.values.map((value) => value.trim()).filter(Boolean),
          }))
          .filter((target) => target.values.length > 0),
        prerequisites: prerequisites.filter((item) => item.flagKey.trim()),
        comment: comment.trim() || undefined,
      });
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
      setConfirmSave(false);
    }
  }

  async function remove() {
    setSaving(true);
    setErr(null);
    try {
      await api.deleteFlag(projectId, flagKey);
      onClose();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Delete failed");
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  async function runTest() {
    setErr(null);
    try {
      const context = JSON.parse(ctxText) as { key?: string };
      if (!context.key) throw new Error("Context JSON needs a key.");
      setEvalResult(await api.evaluate(projectId, flagKey, envId, context as { key: string }));
    } catch (error) {
      setEvalResult(null);
      setErr(error instanceof Error ? error.message : "Evaluation failed");
    }
  }

  return (
    <>
      <Drawer
        open
        title={flag?.name ?? flagKey}
        description={
          flag ? (
            <span>
              <code>{flag.key}</code>
              {flag.description ? ` · ${flag.description}` : ""} · {envName}
            </span>
          ) : (
            "Loading flag configuration"
          )
        }
        onClose={onClose}
      >
        {loadError && <Alert tone="danger" title="Could not load this flag">{loadError}</Alert>}
        {!flag && !loadError && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading flag">
            <Skeleton className="h-8 w-2/3" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
        {flag && (
          <div className="space-y-6">
            {production && (
              <Alert tone="warning" title="Production environment">
                Saving publishes a new flag set. SDK clients pick it up on their next fetch.
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              {variations.map((value, index) => (
                <Badge key={index} color="blue">
                  {index}: {JSON.stringify(value)}
                </Badge>
              ))}
              <Badge>v{flag.configs?.find((item) => item.environmentId === envId)?.version ?? "?"}</Badge>
            </div>

            <section className="grid gap-3 sm:grid-cols-2">
              <Field label="Off variation" hint="Served when the kill switch is off or a prerequisite fails.">
                <Select value={offVariation} onChange={(event) => setOffVariation(Number(event.target.value))}>
                  {variations.map((value, index) => (
                    <option key={index} value={index}>
                      {index}: {JSON.stringify(value)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Default">
                <Select
                  value={mode === "rollout" ? "rollout" : String(singleVariation)}
                  onChange={(event) => {
                    if (event.target.value === "rollout") {
                      setMode("rollout");
                      if (weights.every((weight) => weight === 0)) {
                        setWeights(variations.map((_, index) => (index === 0 ? 100 : 0)));
                      }
                    } else {
                      setMode("single");
                      setSingleVariation(Number(event.target.value));
                    }
                  }}
                >
                  {variations.map((value, index) => (
                    <option key={index} value={index}>
                      Always variation {index}: {JSON.stringify(value)}
                    </option>
                  ))}
                  <option value="rollout">Percentage rollout</option>
                </Select>
              </Field>
            </section>

            {mode === "rollout" && (
              <section className="space-y-3 rounded-lg border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-medium">Rollout weights</h3>
                  <span className={weightSum === 100 ? "text-xs text-muted-foreground" : "text-xs text-amber-700"}>
                    Sum {weightSum}%{weightSum === 100 ? "" : " · last variation absorbs the remainder"}
                  </span>
                </div>
                {variations.length === 2 && (
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      aria-label={`Percent receiving ${JSON.stringify(variations[0])}`}
                      value={weights[0] ?? 0}
                      onChange={(event) => {
                        const first = Number(event.target.value);
                        setWeights([first, 100 - first]);
                      }}
                      className="flex-1"
                    />
                    <span className="w-12 text-right text-sm">{weights[0] ?? 0}%</span>
                  </div>
                )}
                <div className="grid gap-2 sm:grid-cols-2">
                  {variations.map((value, index) => (
                    <Field key={index} label={`${index}: ${JSON.stringify(value)}`}>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={weights[index] ?? 0}
                        onChange={(event) => {
                          const next = weights.slice();
                          next[index] = Number(event.target.value);
                          setWeights(next);
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <Field label="Bucket by" hint="Context attribute used for the sticky hash. Blank uses the context key.">
                  <Input value={bucketBy} placeholder="key" onChange={(event) => setBucketBy(event.target.value)} />
                </Field>
                <p className="text-xs text-muted-foreground">
                  Buckets use SHA-1 of flag key, salt, and the bucket value, so raising a percentage keeps users already inside it.
                </p>
              </section>
            )}

            <RuleBuilder
              rules={rules}
              onChange={setRules}
              variations={variations}
              onValidity={setRulesError}
            />

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Individual targets</h3>
              {targets.map((target, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <Field label="Variation" className="w-40">
                    <Select
                      value={target.variation}
                      aria-label={`Target ${index + 1} variation`}
                      onChange={(event) => {
                        const next = targets.slice();
                        next[index] = { ...target, variation: Number(event.target.value) };
                        setTargets(next);
                      }}
                    >
                      {variations.map((value, variation) => (
                        <option key={variation} value={variation}>
                          {variation}: {JSON.stringify(value)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Context keys" className="min-w-[200px] flex-1">
                    <Input
                      value={target.values.join(", ")}
                      aria-label={`Target ${index + 1} keys`}
                      onChange={(event) => {
                        const next = targets.slice();
                        next[index] = {
                          ...target,
                          values: event.target.value.split(",").map((item) => item.trim()),
                        };
                        setTargets(next);
                      }}
                    />
                  </Field>
                  <Button variant="ghost" size="sm" onClick={() => setTargets(targets.filter((_, i) => i !== index))}>
                    Remove
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setTargets([...targets, { variation: 0, values: [] }])}>
                Add target
              </Button>
            </section>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">Prerequisites</h3>
              <p className="text-xs text-muted-foreground">
                If a prerequisite is off or serves a different variation, this flag serves its off variation.
              </p>
              {prerequisites.map((item, index) => (
                <div key={index} className="flex flex-wrap items-end gap-2">
                  <Field label="Flag" className="min-w-[180px] flex-1">
                    <Input
                      list="prereq-flags"
                      value={item.flagKey}
                      aria-label={`Prerequisite ${index + 1} flag`}
                      onChange={(event) => {
                        const next = prerequisites.slice();
                        next[index] = { ...item, flagKey: event.target.value };
                        setPrerequisites(next);
                      }}
                    />
                  </Field>
                  <Field label="Must serve variation" className="w-40">
                    <Input
                      type="number"
                      min={0}
                      value={item.variation}
                      aria-label={`Prerequisite ${index + 1} variation`}
                      onChange={(event) => {
                        const next = prerequisites.slice();
                        next[index] = { ...item, variation: Number(event.target.value) };
                        setPrerequisites(next);
                      }}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setPrerequisites(prerequisites.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setPrerequisites([...prerequisites, { flagKey: "", variation: 0 }])}>
                Add prerequisite
              </Button>
              <datalist id="prereq-flags">
                {siblingFlags
                  .filter((item) => item.key !== flag.key)
                  .map((item) => (
                    <option key={item.id} value={item.key}>
                      {item.name}
                    </option>
                  ))}
              </datalist>
            </section>

            <Field label="Audit comment">
              <Input value={comment} onChange={(event) => setComment(event.target.value)} />
            </Field>

            {err && <Alert tone="danger">{err}</Alert>}

            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  if (production) setConfirmSave(true);
                  else void save();
                }}
                disabled={saving || !!rulesError}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="danger" className="sm:ml-auto" onClick={() => setConfirmDelete(true)}>
                Delete flag
              </Button>
            </div>

            <section className="rounded-lg border border-border bg-muted/40 p-4">
              <h3 className="mb-2 text-sm font-semibold">Test targeting</h3>
              {flag.key === "new-checkout" && (
                <p className="mb-2 text-xs text-muted-foreground">
                  Try an <code>@flagship.dev</code> email (rule match), then remove the email and change the key to see the 20% rollout.
                </p>
              )}
              <Textarea rows={5} value={ctxText} onChange={(event) => setCtxText(event.target.value)} className="font-mono" aria-label="Evaluation context JSON" />
              <div className="mt-2">
                <Button size="sm" variant="secondary" onClick={() => void runTest()}>
                  Evaluate on server
                </Button>
              </div>
              {evalResult && (
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">Value</dt>
                    <dd className="font-mono text-base">{JSON.stringify(evalResult.value)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Variation index</dt>
                    <dd>{evalResult.variationIndex ?? "none"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Reason</dt>
                    <dd>
                      <Badge color="blue">{evalResult.reason.kind}</Badge>
                      <span className="mt-1 block text-xs text-muted-foreground">{describeReason(evalResult.reason)}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Detail</dt>
                    <dd className="text-xs">
                      {evalResult.reason.ruleId && <div>rule {evalResult.reason.ruleId}</div>}
                      {evalResult.reason.ruleIndex !== undefined && <div>rule index {evalResult.reason.ruleIndex}</div>}
                      {evalResult.reason.prerequisiteKey && <div>prerequisite {evalResult.reason.prerequisiteKey}</div>}
                      {evalResult.reason.errorKind && <div>error {evalResult.reason.errorKind}</div>}
                      {evalResult.flagVersion !== undefined && <div>flag version {evalResult.flagVersion}</div>}
                    </dd>
                  </div>
                </dl>
              )}
            </section>
          </div>
        )}
      </Drawer>
      <ConfirmDialog
        open={confirmSave}
        title={`Save ${flagKey} in production?`}
        description="SDK clients pick up the new flag set on their next fetch (every few seconds)."
        confirmLabel="Save in production"
        busy={saving}
        onConfirm={() => void save()}
        onClose={() => setConfirmSave(false)}
      />
      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${flag?.name ?? flagKey}?`}
        description={`This removes the flag from every environment, including ${envName}.`}
        confirmLabel="Delete flag"
        danger
        busy={saving}
        onConfirm={() => void remove()}
        onClose={() => setConfirmDelete(false)}
      />
    </>
  );
}
