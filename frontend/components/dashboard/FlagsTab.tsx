"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { slugKey, validateFlagKey } from "@/lib/targeting";
import type { Flag, FlagKind } from "@/lib/types";
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, Field, Input, Select, Skeleton, Toggle } from "@/components/ui";
import FlagDrawer from "./FlagDrawer";

const KINDS: FlagKind[] = ["boolean", "string", "number", "json"];

function variationsFor(kind: FlagKind) {
  if (kind === "boolean") return [true, false];
  if (kind === "number") return [1, 0];
  if (kind === "json") return [{}, {}];
  return ["on", "off"];
}

export default function FlagsTab({
  projectId,
  envId,
  production,
  envName,
}: {
  projectId: string;
  envId: string;
  production: boolean;
  envName: string;
}) {
  const [flags, setFlags] = useState<Flag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [newName, setNewName] = useState("");
  const [kind, setKind] = useState<FlagKind>("boolean");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingToggle, setPendingToggle] = useState<{ flag: Flag; on: boolean } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Flag | null>(null);

  const load = useCallback(() => {
    if (!envId) return;
    setLoading(true);
    api
      .listFlags(projectId)
      .then((next) => {
        setFlags(next);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [projectId, envId]);

  useEffect(() => {
    load();
  }, [load]);

  function configFor(flag: Flag) {
    return flag.configs?.find((config) => config.environmentId === envId);
  }

  async function toggle(flag: Flag, on: boolean) {
    setError(null);
    try {
      await api.toggleFlag(projectId, flag.key, envId, on, on ? "enabled from dashboard" : "kill switch");
      setNotice(`${flag.key} is now ${on ? "on" : "off"} in ${envName}.`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setPendingToggle(null);
    }
  }

  async function create() {
    const keyError = validateFlagKey(newKey);
    if (keyError || !newName.trim()) {
      setFormError(keyError ?? "Name is required.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.createFlag(projectId, {
        key: newKey.trim(),
        name: newName.trim(),
        kind,
        variations: variationsFor(kind),
      });
      setNewKey("");
      setNewName("");
      setKeyEdited(false);
      setCreating(false);
      setNotice(`Created ${newKey.trim()}. It starts off in every environment.`);
      load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove(flag: Flag) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteFlag(projectId, flag.key);
      setNotice(`Deleted ${flag.key}.`);
      setPendingDelete(null);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          The switch is the kill switch for {envName}. Open a flag to edit rollout, rules, prerequisites, and to test a context.
        </p>
        <Button size="sm" onClick={() => setCreating((value) => !value)} aria-expanded={creating}>
          {creating ? "Close form" : "New flag"}
        </Button>
      </div>

      {production && (
        <Alert tone="warning" title="Production">
          Toggles and deletes here publish immediately to SDK clients using this environment.
        </Alert>
      )}
      {notice && (
        <Alert tone="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {creating && (
        <Card>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Field label="Name" htmlFor="flag-name" className="min-w-[160px] flex-1">
              <Input
                id="flag-name"
                value={newName}
                onChange={(event) => {
                  const name = event.target.value;
                  setNewName(name);
                  if (!keyEdited) setNewKey(slugKey(name));
                }}
                placeholder="New checkout"
              />
            </Field>
            <Field label="Key" htmlFor="flag-key" error={formError} className="min-w-[160px] flex-1">
              <Input
                id="flag-key"
                value={newKey}
                aria-invalid={!!formError}
                onChange={(event) => {
                  setKeyEdited(true);
                  setNewKey(event.target.value);
                }}
                placeholder="new-checkout"
              />
            </Field>
            <Field label="Type" htmlFor="flag-kind">
              <Select id="flag-kind" value={kind} onChange={(event) => setKind(event.target.value as FlagKind)}>
                {KINDS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </form>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading flags">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : flags.length === 0 ? (
        <EmptyState title="No flags yet" action={<Button onClick={() => setCreating(true)}>Create a flag</Button>}>
          Flags start off in every environment, serving the last variation, so creating one does not change behavior.
        </EmptyState>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => {
            const config = configFor(flag);
            return (
              <Card key={flag.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <button type="button" className="flex-1 text-left" onClick={() => setOpenKey(flag.key)}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{flag.name}</span>
                    <Badge>{flag.kind}</Badge>
                    {flag.tags?.map((tag) => (
                      <Badge key={tag} color="blue">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <code className="text-xs text-muted-foreground">{flag.key}</code>
                </button>
                <div className="flex items-center gap-3">
                  <Badge color={config?.on ? "green" : "gray"}>{config?.on ? "on" : "off"}</Badge>
                  <span className="text-xs text-muted-foreground">v{config?.version ?? "—"}</span>
                  <Toggle
                    checked={!!config?.on}
                    label={`${config?.on ? "Turn off" : "Turn on"} ${flag.name} in ${envName}`}
                    onChange={(on) => {
                      if (production) setPendingToggle({ flag, on });
                      else void toggle(flag, on);
                    }}
                  />
                  <Button variant="ghost" size="sm" onClick={() => setPendingDelete(flag)}>
                    Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {openKey && (
        <FlagDrawer
          projectId={projectId}
          envId={envId}
          flagKey={openKey}
          production={production}
          envName={envName}
          onClose={() => {
            setOpenKey(null);
            load();
          }}
        />
      )}

      <ConfirmDialog
        open={!!pendingToggle}
        title={pendingToggle ? `${pendingToggle.on ? "Enable" : "Kill"} ${pendingToggle.flag.name} in production?` : "Confirm"}
        description="Connected clients pick this up from the dataset stream within milliseconds."
        confirmLabel={pendingToggle?.on ? "Enable in production" : "Kill in production"}
        danger={!pendingToggle?.on}
        onConfirm={() => pendingToggle && void toggle(pendingToggle.flag, pendingToggle.on)}
        onClose={() => setPendingToggle(null)}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        title={pendingDelete ? `Delete ${pendingDelete.name}?` : "Delete flag"}
        description="This removes the flag from every environment, not only the one you are viewing."
        confirmLabel="Delete flag"
        danger
        busy={busy}
        onConfirm={() => pendingDelete && void remove(pendingDelete)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
