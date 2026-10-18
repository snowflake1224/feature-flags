"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { formatNumber, pct } from "@/lib/format";
import { slugKey, validateFlagKey } from "@/lib/targeting";
import type { Experiment, ExperimentResults, Flag } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Select, Skeleton, Tooltip } from "@/components/ui";

export default function ExperimentsTab({
  projectId,
  envId,
  envName,
  onOpenLive,
}: {
  projectId: string;
  envId: string;
  envName: string;
  onOpenLive?: () => void;
}) {
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [results, setResults] = useState<ExperimentResults | null>(null);
  const [loading, setLoading] = useState(true);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [name, setName] = useState("");
  const [flagKey, setFlagKey] = useState("");
  const [exposureEvent, setExposureEvent] = useState("pricing_viewed");
  const [goalEvent, setGoalEvent] = useState("subscribed");
  const [metricKind, setMetricKind] = useState<"binary" | "numeric">("binary");
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(() => {
    if (!envId) return;
    setLoading(true);
    Promise.all([api.listExperiments(projectId, envId), api.listFlags(projectId)])
      .then(([nextExperiments, nextFlags]) => {
        setExperiments(nextExperiments);
        setFlags(nextFlags);
        setFlagKey((current) => current || nextFlags[0]?.key || "");
        setSelected((current) =>
          current && nextExperiments.some((item) => item.key === current) ? current : nextExperiments[0]?.key ?? null,
        );
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, envId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!selected) {
      setResults(null);
      return;
    }
    let cancelled = false;
    setResultsLoading(true);
    setResultsError(null);
    api
      .experimentResults(projectId, envId, selected)
      .then((next) => {
        if (!cancelled) setResults(next);
      })
      .catch((err: Error) => {
        if (!cancelled) {
          setResults(null);
          setResultsError(err.message);
        }
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, envId, selected, refreshToken]);

  async function create() {
    const keyError = validateFlagKey(key);
    if (keyError || !name.trim() || !flagKey || !exposureEvent.trim() || !goalEvent.trim()) {
      setFormError(keyError ?? "Name, flag, exposure event, and goal event are required.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const created = await api.createExperiment(projectId, envId, {
        key: key.trim(),
        name: name.trim(),
        flagKey,
        exposureEvent: exposureEvent.trim(),
        goalEvent: goalEvent.trim(),
        metricKind,
      });
      setCreating(false);
      setKey("");
      setName("");
      setKeyEdited(false);
      setNotice(`Created ${created.key}. Send ${created.exposureEvent} and ${created.goalEvent} events to fill results.`);
      setSelected(created.key);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  const maxRate = results ? Math.max(...results.variations.map((variation) => variation.conversionRate), 0.0001) : 1;
  const numeric = results?.experiment.metricKind === "numeric";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Experiments in {envName} group unique context keys by the variation stamped at ingest, then compare each variation with control.
        </p>
        <Button size="sm" onClick={() => setCreating((value) => !value)} aria-expanded={creating}>
          {creating ? "Close form" : "New experiment"}
        </Button>
      </div>

      <Alert tone="info" title="How significance is calculated">
        Each non-control variation is compared with variation 0 using a two-proportion z-test. Significant means a two-sided p-value under 0.05. Relative uplift is (rate − control rate) / control rate. Zero exposures return p = 1. This is a classical check, so small samples are directional.
      </Alert>
      {notice && (
        <Alert tone="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {creating && (
        <Card>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Field label="Name" htmlFor="exp-name">
              <Input
                id="exp-name"
                value={name}
                onChange={(event) => {
                  const next = event.target.value;
                  setName(next);
                  if (!keyEdited) setKey(slugKey(next));
                }}
              />
            </Field>
            <Field label="Key" htmlFor="exp-key" error={formError}>
              <Input
                id="exp-key"
                value={key}
                aria-invalid={!!formError}
                onChange={(event) => {
                  setKeyEdited(true);
                  setKey(event.target.value);
                }}
              />
            </Field>
            <Field label="Flag" htmlFor="exp-flag">
              <Select id="exp-flag" value={flagKey} onChange={(event) => setFlagKey(event.target.value)}>
                {flags.length === 0 && <option value="">No flags yet</option>}
                {flags.map((flag) => (
                  <option key={flag.id} value={flag.key}>
                    {flag.key}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Metric" htmlFor="exp-metric">
              <Select
                id="exp-metric"
                value={metricKind}
                onChange={(event) => setMetricKind(event.target.value as "binary" | "numeric")}
              >
                <option value="binary">binary conversion</option>
                <option value="numeric">numeric value</option>
              </Select>
            </Field>
            <Field label="Exposure event" htmlFor="exp-exposure">
              <Input id="exp-exposure" value={exposureEvent} onChange={(event) => setExposureEvent(event.target.value)} />
            </Field>
            <Field label="Goal event" htmlFor="exp-goal">
              <Input id="exp-goal" value={goalEvent} onChange={(event) => setGoalEvent(event.target.value)} />
            </Field>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy || flags.length === 0}>
                {busy ? "Creating…" : "Create experiment"}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {loading ? (
        <Skeleton className="h-24 w-full" />
      ) : experiments.length === 0 ? (
        <EmptyState title="No experiments in this environment" action={<Button onClick={() => setCreating(true)}>Create experiment</Button>}>
          Seed the demo project for a pricing A/B test, or create one against an existing flag.
        </EmptyState>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Experiments">
          {experiments.map((experiment) => (
            <button
              key={experiment.id}
              type="button"
              aria-pressed={selected === experiment.key}
              onClick={() => setSelected(experiment.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
                selected === experiment.key ? "border-primary bg-primary/10" : "border-border"
              }`}
            >
              {experiment.name}
            </button>
          ))}
        </div>
      )}

      {resultsError && (
        <Alert tone="danger" title="Could not load results">
          {resultsError}{" "}
          <button type="button" className="underline" onClick={() => setRefreshToken((value) => value + 1)}>
            Retry
          </button>
        </Alert>
      )}

      {resultsLoading && <Skeleton className="h-40 w-full" />}

      {results && !resultsLoading && (
        <>
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-medium">{results.experiment.name}</div>
                <div className="text-xs text-muted-foreground">
                  flag <code>{results.experiment.flagKey}</code> · exposure <code>{results.experiment.exposureEvent}</code> · goal{" "}
                  <code>{results.experiment.goalEvent}</code> · {results.experiment.metricKind}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge color="blue">{results.totalExposures.toLocaleString()} exposures</Badge>
                <Button size="sm" variant="outline" onClick={() => setRefreshToken((value) => value + 1)}>
                  Refresh
                </Button>
              </div>
            </div>
          </Card>

          {results.variations.length === 0 ? (
            <EmptyState
              title="No attributed events yet"
              action={
                onOpenLive ? (
                  <Button onClick={onOpenLive}>Simulate events</Button>
                ) : undefined
              }
            >
              Send {results.experiment.exposureEvent} and {results.experiment.goalEvent} with this flag key. The server stamps the variation from the context at ingest time.
            </EmptyState>
          ) : (
            <div className="grid gap-3">
              {results.variations.map((variation) => (
                <Card key={variation.variationIndex}>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Variation {variation.variationIndex}</span>
                      <code className="text-xs">{JSON.stringify(variation.value)}</code>
                      {variation.isControl && <Badge>control</Badge>}
                      {!variation.isControl && variation.significant && (
                        <Badge color={variation.relativeUplift >= 0 ? "green" : "red"}>
                          {variation.relativeUplift >= 0 ? "up" : "down"} · significant
                        </Badge>
                      )}
                      {!variation.isControl && !variation.significant && <Badge color="gray">not significant</Badge>}
                    </div>
                    <div className="text-sm font-semibold">{pct(variation.conversionRate)}</div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full ${variation.isControl ? "bg-gray-400" : "bg-primary"}`}
                      style={{ width: `${Math.min(100, (variation.conversionRate / maxRate) * 100)}%` }}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {variation.conversions.toLocaleString()} / {variation.exposures.toLocaleString()} converted
                    </span>
                    {!variation.isControl && (
                      <>
                        <span>
                          uplift{" "}
                          <span className={variation.relativeUplift >= 0 ? "text-green-700" : "text-red-700"}>
                            {(variation.relativeUplift * 100).toFixed(1)}%
                          </span>
                        </span>
                        <Tooltip label="Two-sided p-value from the pooled two-proportion z-test against variation 0.">
                          <span>p = {formatNumber(variation.pValue)}</span>
                        </Tooltip>
                        <Tooltip label="(variant rate − control rate) / pooled standard error.">
                          <span>z = {formatNumber(variation.z, 2)}</span>
                        </Tooltip>
                      </>
                    )}
                    <span>avg value {formatNumber(variation.avgValue, 2)}</span>
                    <span>total value {formatNumber(variation.totalValue, 2)}</span>
                    {numeric && <span>numeric metric</span>}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
