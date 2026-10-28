"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { describeReason } from "@/lib/format";
import { evaluateLocal } from "@/lib/local-eval";
import type { ClientDataset, EvalContext, EvalResult, HealthReport } from "@/lib/types";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, StatusDot, Textarea } from "@/components/ui";

const POLL_MS = 3000;

type PollState = "idle" | "polling" | "error";

interface LogEntry {
  id: number;
  at: string;
  kind: string;
  detail: string;
}

const DEFAULT_CONTEXT = `{
  "key": "user-1",
  "email": "ada@flagship.dev"
}`;

export default function LiveDemoTab({
  projectId,
  envId,
  envName,
  sdkKey,
  production,
  onOpenTab,
}: {
  projectId: string;
  envId: string;
  envName: string;
  sdkKey: string | null;
  production: boolean;
  onOpenTab: (tab: "Flags" | "Audit log" | "Settings") => void;
}) {
  const [pollState, setPollState] = useState<PollState>(sdkKey ? "polling" : "idle");
  const [pollError, setPollError] = useState<string | null>(null);
  const [dataset, setDataset] = useState<ClientDataset | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [contextText, setContextText] = useState(DEFAULT_CONTEXT);
  const [serverByFlag, setServerByFlag] = useState<Record<string, EvalResult>>({});
  const [compareError, setCompareError] = useState<string | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglePending, setTogglePending] = useState<{ flagKey: string; on: boolean; at: number } | null>(null);
  const [health, setHealth] = useState<HealthReport | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [steps, setSteps] = useState({ fetch: false, propagate: false, evaluate: false, audit: false });
  const logId = useRef(0);
  const versionRef = useRef<number | null>(null);
  const toggleRef = useRef<{ flagKey: string; on: boolean; at: number } | null>(null);

  function pushLog(kind: string, detail: string) {
    const entry = { id: ++logId.current, at: new Date().toLocaleTimeString(), kind, detail };
    setLogs((current) => [entry, ...current].slice(0, 12));
  }

  useEffect(() => {
    if (!sdkKey) {
      setPollState("idle");
      setDataset(null);
      return;
    }
    let cancelled = false;
    let timer: number | undefined;
    const key = sdkKey;
    versionRef.current = null;

    async function poll() {
      try {
        const next = await api.getSdkDataset(key);
        if (cancelled) return;
        setPollState("polling");
        setPollError(null);
        setDataset(next);
        setLastFetchAt(new Date().toLocaleTimeString());
        setSteps((current) => ({ ...current, fetch: true }));
        const pending = toggleRef.current;
        const pendingFlag = pending ? next.flags[pending.flagKey] : undefined;
        if (versionRef.current === null) {
          pushLog("fetch", `v${next.version} · ${Object.keys(next.flags).length} flags`);
        } else if (pending && pendingFlag && pendingFlag.on === pending.on) {
          const seconds = ((Date.now() - pending.at) / 1000).toFixed(1);
          pushLog("change", `${pending.flagKey} is ${pendingFlag.on ? "on" : "off"} in v${next.version}, ${seconds}s after the toggle`);
          toggleRef.current = null;
          setTogglePending(null);
          setSteps((current) => ({ ...current, propagate: true }));
        } else if (next.version !== versionRef.current) {
          pushLog("change", `v${versionRef.current} → v${next.version}`);
        }
        versionRef.current = next.version;
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Fetch failed";
        setPollState("error");
        setPollError(message);
        pushLog("error", message);
      } finally {
        if (!cancelled) timer = window.setTimeout(() => void poll(), POLL_MS);
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
    // pushLog closes over setters only; restart polling when the key changes.
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
      const pending = { flagKey, on, at: Date.now() };
      toggleRef.current = pending;
      setTogglePending(pending);
      pushLog("toggle", `${flagKey} → ${on ? "on" : "off"} saved; waiting for the next fetch`);
    } catch (error) {
      setToggleError(error instanceof Error ? error.message : "Toggle failed");
    } finally {
      setPendingToggle(null);
    }
  }

  const tone = pollState === "polling" ? "ok" : pollState === "error" ? "down" : "idle";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">SDK view · {envName}</h2>
          <p className="text-sm text-muted-foreground">
            This tab behaves like an SDK client: it fetches the flag set every {POLL_MS / 1000} seconds and evaluates the copy it holds.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs">
          <StatusDot tone={tone} />
          {pollState}
          {dataset && <span>v{dataset.version}</span>}
          {lastFetchAt && <span>fetched {lastFetchAt}</span>}
        </span>
      </div>

      {!sdkKey && (
        <Alert tone="warning" title="No active SDK key">
          Issue one from Settings, then come back. Fetches authenticate with that environment key.
          <div className="mt-2">
            <Button size="sm" variant="outline" onClick={() => onOpenTab("Settings")}>
              Open settings
            </Button>
          </div>
        </Alert>
      )}
      {pollError && <Alert tone="danger">{pollError} Retrying on the next poll.</Alert>}
      {toggleError && <Alert tone="danger">{toggleError}</Alert>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Fetches</h3>
            <Badge color={pollState === "polling" ? "green" : "gray"}>{dataset?.environmentKey ?? envName}</Badge>
          </div>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Waiting for the first fetch…</p>
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
            <h4 className="text-xs font-medium text-muted-foreground">Kill switch</h4>
            {localResults.length === 0 && <p className="text-xs text-muted-foreground">Flags appear after the first fetch.</p>}
            {localResults.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-2 text-sm">
                <code>{item.key}</code>
                <Button
                  size="sm"
                  variant={item.on ? "danger" : "secondary"}
                  disabled={togglePending?.flagKey === item.key}
                  onClick={() => {
                    if (production) setPendingToggle(item.key);
                    else void toggle(item.key, !item.on);
                  }}
                >
                  {togglePending?.flagKey === item.key ? "Waiting for fetch…" : item.on ? "Turn off" : "Turn on"}
                </Button>
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-3">
          <h3 className="text-sm font-semibold">Evaluate</h3>
          <Field label="Context" htmlFor="live-context" hint="Evaluated in the browser against the fetched copy.">
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
            <EmptyState title="No flag set yet">Flags are evaluated locally once the first fetch completes.</EmptyState>
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
                              {mismatch && <div>Local and server differ (the local copy may be one fetch behind).</div>}
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

        <Card className="lg:col-span-2">
          <h3 className="text-sm font-semibold">Guided checklist</h3>
          <ol className="mt-3 space-y-2 text-sm">
            <Check done={steps.fetch} label="Fetched the environment flag set with the SDK key." />
            <Check done={steps.propagate} label="A toggle showed up on the next fetch." />
            <Check done={steps.evaluate} label="A server evaluation is shown next to the local result." />
            <Check done={steps.audit} label="The audit log shows who flipped the flag." />
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
      </div>

      <ConfirmDialog
        open={!!pendingToggle}
        title={pendingToggle ? `Change ${pendingToggle} in production?` : "Confirm"}
        description="Clients see the change on their next fetch. The audit log records who flipped it."
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
