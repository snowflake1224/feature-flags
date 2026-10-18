"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { describeReason } from "@/lib/format";
import { evaluateLocal } from "@/lib/local-eval";
import type { ClientDataset, EvalContext, EvalResult, Experiment, HealthReport } from "@/lib/types";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Select, StatusDot, Textarea } from "@/components/ui";

type Connection = "idle" | "connecting" | "live" | "reconnecting" | "error";

interface LogEntry {
  id: number;
  at: string;
  kind: string;
  detail: string;
}

const DEFAULT_CONTEXT = `{
  "key": "user-beta-1",
  "country": "DE",
  "email": "beta@flagship.dev"
}`;

export default function LiveDemoTab({
  projectId,
  envId,
  envName,
  sdkKey,
  production,
  projectKey,
  onOpenTab,
}: {
  projectId: string;
  envId: string;
  envName: string;
  sdkKey: string | null;
  production: boolean;
  projectKey: string;
  onOpenTab: (tab: "Flags" | "Experiments" | "Audit log" | "Settings") => void;
}) {
  const [connection, setConnection] = useState<Connection>(sdkKey ? "connecting" : "idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<ClientDataset | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [contextText, setContextText] = useState(DEFAULT_CONTEXT);
  const [serverByFlag, setServerByFlag] = useState<Record<string, EvalResult>>({});
  const [compareError, setCompareError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [eventKey, setEventKey] = useState(projectKey === "demo" ? "pricing_viewed" : "exposure");
  const [goalKey, setGoalKey] = useState(projectKey === "demo" ? "subscribed" : "conversion");
  const [eventFlag, setEventFlag] = useState(projectKey === "demo" ? "pricing-experiment" : "");
  const [eventValue, setEventValue] = useState("");
  const [eventMessage, setEventMessage] = useState<string | null>(null);
  const [eventError, setEventError] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [experimentKey, setExperimentKey] = useState(projectKey === "demo" ? "pricing-ab" : "");
  const [resultsNote, setResultsNote] = useState<string | null>(null);
  const [steps, setSteps] = useState({
    connect: false,
    propagate: false,
    evaluate: false,
    event: false,
    results: false,
    audit: false,
  });
  const logId = useRef(0);
  const versionRef = useRef<number | null>(null);

  function pushLog(kind: string, detail: string) {
    const entry = { id: ++logId.current, at: new Date().toLocaleTimeString(), kind, detail };
    setLogs((current) => [entry, ...current].slice(0, 12));
  }

  useEffect(() => {
    versionRef.current = version;
  }, [version]);

  useEffect(() => {
    if (!sdkKey) {
      setConnection("idle");
      setDataset(null);
      return;
    }
    let cancelled = false;
    let attempt = 0;
    let controller: AbortController | null = null;
    let timer: number | undefined;
    const key = sdkKey;

    async function handleEvent(eventName: string, data: string) {
      if (eventName === "put") {
        try {
          const next = JSON.parse(data) as ClientDataset;
          setDataset(next);
          setVersion(next.version);
          versionRef.current = next.version;
          pushLog("put", `dataset v${next.version} · ${Object.keys(next.flags).length} flags`);
        } catch {
          pushLog("put", "unreadable dataset payload");
        }
        return;
      }
      if (eventName === "patch") {
        let announced: number | undefined;
        try {
          announced = (JSON.parse(data) as { version?: number }).version;
        } catch {
          announced = undefined;
        }
        const started = performance.now();
        pushLog("patch", announced !== undefined ? `version ${announced}` : "change notice");
        try {
          const fresh = await api.getSdkDataset(key);
          if (cancelled) return;
          const elapsed = Math.round(performance.now() - started);
          setLatencyMs(elapsed);
          setDataset(fresh);
          setVersion(fresh.version);
          if (versionRef.current !== null && fresh.version !== versionRef.current) {
            setSteps((current) => ({ ...current, propagate: true }));
          }
          versionRef.current = fresh.version;
          pushLog("refresh", `v${fresh.version} in ${elapsed} ms`);
        } catch (error) {
          if (!cancelled) pushLog("refresh", error instanceof Error ? error.message : "dataset refresh failed");
        }
      }
    }

    async function connect() {
      controller = new AbortController();
      setConnection(attempt === 0 ? "connecting" : "reconnecting");
      setStreamError(null);
      try {
        await api.streamSdk(key, {
          signal: controller.signal,
          onOpen: () => {
            if (cancelled) return;
            setConnection("live");
            setSteps((current) => ({ ...current, connect: true }));
          },
          onEvent: (message) => {
            void handleEvent(message.event, message.data);
          },
        });
        if (!cancelled) schedule();
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        const message = error instanceof Error ? error.message : "Stream failed";
        setStreamError(message);
        setConnection("error");
        pushLog("error", message);
        schedule();
      }
    }

    function schedule() {
      const delay = Math.min(10000, 1000 * 2 ** attempt);
      attempt += 1;
      setConnection("reconnecting");
      timer = window.setTimeout(() => {
        if (!cancelled) void connect();
      }, delay);
    }

    void connect();
    return () => {
      cancelled = true;
      controller?.abort();
      if (timer) window.clearTimeout(timer);
    };
    // pushLog closes over setters only; reconnect when the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadHealth() {
      try {
        const report = await api.health();
        if (!cancelled) {
          setHealth(report);
          setHealthError(null);
        }
      } catch (error) {
        if (!cancelled) setHealthError(error instanceof Error ? error.message : "Health check failed");
      }
    }
    void loadHealth();
    const timer = window.setInterval(loadHealth, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    api
      .listExperiments(projectId, envId)
      .then((next) => {
        setExperiments(next);
        setExperimentKey((current) => current || next[0]?.key || "");
      })
      .catch(() => setExperiments([]));
  }, [projectId, envId]);

  const parsedContext = useMemo((): { ok: true; value: EvalContext } | { ok: false; error: string } => {
    try {
      const value = JSON.parse(contextText) as EvalContext;
      if (!value || typeof value !== "object" || typeof value.key !== "string" || !value.key) {
        return { ok: false, error: "Context JSON needs a string key." };
      }
      return { ok: true, value };
    } catch {
      return { ok: false, error: "Context JSON is invalid." };
    }
  }, [contextText]);

  const localResults = useMemo(() => {
    if (!dataset || !parsedContext.ok) return [];
    return Object.values(dataset.flags).map((flag) => ({
      key: flag.key,
      on: flag.on,
      result: evaluateLocal(dataset, flag.key, parsedContext.value, null),
    }));
  }, [dataset, parsedContext]);

  async function compare(flagKey: string) {
    if (!parsedContext.ok) {
      setCompareError(parsedContext.error);
      return;
    }
    setCompareError(null);
    try {
      const server = await api.evaluate(projectId, flagKey, envId, parsedContext.value);
      setServerByFlag((current) => ({ ...current, [flagKey]: server }));
      setSteps((current) => ({ ...current, evaluate: true }));
    } catch (error) {
      setCompareError(error instanceof Error ? error.message : "Server evaluation failed");
    }
  }

  async function toggle(flagKey: string, on: boolean) {
    setToggleError(null);
    try {
      await api.toggleFlag(projectId, flagKey, envId, on, on ? "enabled from live demo" : "kill switch from live demo");
      setPendingToggle(null);
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : "Toggle failed");
      setPendingToggle(null);
    }
  }

  async function sendEvent(name: string) {
    if (!sdkKey) return;
    if (!parsedContext.ok) {
      setEventError(parsedContext.error);
      return;
    }
    setEventError(null);
    setEventMessage(null);
    const value = eventValue.trim() === "" ? undefined : Number(eventValue);
    if (eventValue.trim() !== "" && Number.isNaN(value)) {
      setEventError("Value must be a number.");
      return;
    }
    try {
      await api.ingestSdkEvent(sdkKey, {
        eventKey: name,
        contextKey: parsedContext.value.key,
        context: parsedContext.value,
        flagKey: eventFlag.trim() || undefined,
        value,
        ts: Date.now(),
      });
      setEventMessage(`Sent ${name} for ${parsedContext.value.key}.`);
      setSteps((current) => ({ ...current, event: true }));
    } catch (error) {
      setEventError(error instanceof Error ? error.message : "Event ingestion is unavailable.");
    }
  }

  async function refreshResults() {
    if (!experimentKey) {
      setResultsNote("Create an experiment first.");
      return;
    }
    try {
      const results = await api.experimentResults(projectId, envId, experimentKey);
      const summary = results.variations
        .map((variation) => `v${variation.variationIndex} ${variation.conversions}/${variation.exposures}`)
        .join(" · ");
      setResultsNote(`${results.totalExposures} exposures${summary ? ` · ${summary}` : ""}`);
      setSteps((current) => ({ ...current, results: true }));
    } catch (error) {
      setResultsNote(error instanceof Error ? error.message : "Results are unavailable.");
    }
  }

  const tone = connection === "live" ? "ok" : connection === "error" ? "down" : connection === "idle" ? "idle" : "warn";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Data plane · {envName}</h2>
          <p className="text-sm text-muted-foreground">
            The browser holds an authenticated fetch stream. Native EventSource cannot send the SDK bearer token.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
          <StatusDot tone={tone} />
          {connection}
          {version !== null && <span>v{version}</span>}
          {latencyMs !== null && <span>{latencyMs} ms refresh</span>}
        </span>
      </div>

      {!sdkKey && (
        <Alert tone="warning" title="No active SDK key">
          Issue one from Settings, then come back. The stream authenticates with that environment key.
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => onOpenTab("Settings")}>
              Open settings
            </Button>
          </div>
        </Alert>
      )}
      {streamError && <Alert tone="danger">{streamError} The stream will retry.</Alert>}
      {toggleError && <Alert tone="danger">{toggleError}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Stream</h3>
            <Badge color={connection === "live" ? "green" : "gray"}>{dataset?.environmentKey ?? envName}</Badge>
          </div>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Waiting for the first put…</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {logs.map((entry) => (
                <li key={entry.id} className="flex gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">{entry.at}</span>
                  <Badge>{entry.kind}</Badge>
                  <span>{entry.detail}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Kill switch from this stream</h4>
            {localResults.length === 0 && <p className="text-xs text-muted-foreground">Flags appear after the dataset arrives.</p>}
            {localResults.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-2 text-sm">
                <code>{item.key}</code>
                <Button
                  size="sm"
                  variant={item.on ? "danger" : "secondary"}
                  onClick={() => {
                    if (production) setPendingToggle(item.key);
                    else void toggle(item.key, !item.on);
                  }}
                >
                  {item.on ? "Turn off" : "Turn on"}
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Evaluate</h3>
          <Field label="Context" htmlFor="live-context" hint="Sent as contextKey and as context, so attribute targeting still works when the API accepts it.">
            <Textarea
              id="live-context"
              rows={5}
              className="font-mono"
              value={contextText}
              onChange={(event) => setContextText(event.target.value)}
            />
          </Field>
          {!parsedContext.ok && <Alert tone="warning">{parsedContext.error}</Alert>}
          {compareError && <Alert tone="danger">{compareError}</Alert>}
          {localResults.length === 0 ? (
            <EmptyState title="No dataset yet">Connect the stream to evaluate flags locally in the browser.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-2 font-medium">Flag</th>
                    <th className="py-1 pr-2 font-medium">Local</th>
                    <th className="py-1 pr-2 font-medium">Reason</th>
                    <th className="py-1 font-medium">Server</th>
                  </tr>
                </thead>
                <tbody>
                  {localResults.map((item) => {
                    const server = serverByFlag[item.key];
                    const mismatch = server && JSON.stringify(server.value) !== JSON.stringify(item.result.value);
                    return (
                      <tr key={item.key} className="border-t border-border align-top">
                        <td className="py-2 pr-2 font-mono text-xs">{item.key}</td>
                        <td className="py-2 pr-2 font-mono text-xs">{JSON.stringify(item.result.value)}</td>
                        <td className="py-2 pr-2 text-xs">
                          <div>{item.result.reason.kind}</div>
                          <div className="text-muted-foreground">{describeReason(item.result.reason)}</div>
                        </td>
                        <td className="py-2 text-xs">
                          {server ? (
                            <div className={mismatch ? "text-amber-800" : undefined}>
                              <div className="font-mono">{JSON.stringify(server.value)}</div>
                              <div>{server.reason.kind}</div>
                              {mismatch && <div>Local and server differ.</div>}
                            </div>
                          ) : (
                            <Button size="sm" variant="outline" onClick={() => void compare(item.key)}>
                              Compare
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-2">
          <h3 className="text-sm font-semibold">Health</h3>
          {healthError && <Alert tone="danger">{healthError}</Alert>}
          {health ? (
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <StatusDot tone={health.status === "ok" ? "ok" : "warn"} />
                <span>{health.status}</span>
                <span className="text-xs text-muted-foreground">{new Date(health.ts).toLocaleTimeString()}</span>
              </div>
              {Object.entries(health.checks).map(([name, status]) => (
                <div key={name} className="flex items-center justify-between">
                  <span>{name}</span>
                  <Badge color={status === "ok" ? "green" : "red"}>{status}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Checking Postgres and Redis…</p>
          )}
        </Card>

        <Card className="space-y-3 lg:col-span-2">
          <h3 className="text-sm font-semibold">Event simulator</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Flag key" htmlFor="event-flag">
              <Input id="event-flag" value={eventFlag} onChange={(event) => setEventFlag(event.target.value)} />
            </Field>
            <Field label="Numeric value" htmlFor="event-value" hint="Optional. Used by numeric metrics.">
              <Input id="event-value" value={eventValue} onChange={(event) => setEventValue(event.target.value)} />
            </Field>
            <Field label="Exposure event" htmlFor="event-exposure">
              <Input id="event-exposure" value={eventKey} onChange={(event) => setEventKey(event.target.value)} />
            </Field>
            <Field label="Goal event" htmlFor="event-goal">
              <Input id="event-goal" value={goalKey} onChange={(event) => setGoalKey(event.target.value)} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!sdkKey} onClick={() => void sendEvent(eventKey)}>
              Send exposure
            </Button>
            <Button size="sm" variant="secondary" disabled={!sdkKey} onClick={() => void sendEvent(goalKey)}>
              Send goal
            </Button>
          </div>
          {eventMessage && <Alert tone="success">{eventMessage}</Alert>}
          {eventError && <Alert tone="danger">{eventError}</Alert>}
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Experiment" htmlFor="live-experiment" className="min-w-[180px] flex-1">
              <Select id="live-experiment" value={experimentKey} onChange={(event) => setExperimentKey(event.target.value)}>
                {experiments.length === 0 && <option value="">No experiments</option>}
                {experiments.map((experiment) => (
                  <option key={experiment.id} value={experiment.key}>
                    {experiment.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button size="sm" variant="outline" onClick={() => void refreshResults()}>
              Refresh results
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onOpenTab("Experiments")}>
              Open experiments
            </Button>
          </div>
          {resultsNote && <p className="text-xs text-muted-foreground">{resultsNote}</p>}
        </Card>
      </div>

      <Card>
        <h3 className="text-sm font-semibold">Guided checklist</h3>
        <ol className="mt-3 space-y-2 text-sm">
          <Check done={steps.connect} label="Stream connected and received the environment dataset." />
          <Check done={steps.propagate} label="A flag change produced a patch and a dataset refresh." />
          <Check done={steps.evaluate} label="A server evaluation reason is shown next to the local result." />
          <Check done={steps.event} label="An exposure or conversion event was accepted." />
          <Check done={steps.results} label="Experiment results were refreshed from this screen." />
          <Check done={steps.audit} label="The audit trail was opened." />
        </ol>
        <div className="mt-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setSteps((current) => ({ ...current, audit: true }));
              onOpenTab("Audit log");
            }}
          >
            Inspect audit
          </Button>
        </div>
      </Card>

      <ConfirmDialog
        open={!!pendingToggle}
        title={pendingToggle ? `Change ${pendingToggle} in production?` : "Confirm"}
        description="The kill switch publishes a patch on this stream."
        confirmLabel="Apply in production"
        danger
        onConfirm={() => {
          const flag = localResults.find((item) => item.key === pendingToggle);
          if (flag) void toggle(flag.key, !flag.on);
        }}
        onClose={() => setPendingToggle(null)}
      />
    </div>
  );
}

function Check({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={done ? "text-green-700" : "text-muted-foreground"} aria-hidden>
        {done ? "✓" : "○"}
      </span>
      <span>
        {label}
        <span className="sr-only">{done ? " done" : " not done"}</span>
      </span>
    </li>
  );
}
