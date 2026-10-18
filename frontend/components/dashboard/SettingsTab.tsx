"use client";

import { useEffect, useState } from "react";
import { api, getActor, getAdminKey, setActor, setAdminKey } from "@/lib/api";
import { activeSdkKey } from "@/lib/format";
import type { Environment, Project } from "@/lib/types";
import { Alert, Badge, Button, Card, ConfirmDialog, CopyButton, Field, Input } from "@/components/ui";

export default function SettingsTab({ project, onChange }: { project: Project; onChange: () => void }) {
  const [actor, setActorValue] = useState("");
  const [adminKey, setAdminValue] = useState("");
  const [identityMessage, setIdentityMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingRotate, setPendingRotate] = useState<Environment | null>(null);

  useEffect(() => {
    setActorValue(getActor());
    setAdminValue(getAdminKey());
  }, []);

  function saveIdentity() {
    setActor(actor.trim() || "demo@flagship.dev");
    setAdminKey(adminKey);
    setActorValue(getActor());
    setIdentityMessage("Saved in this browser. The next request sends these headers.");
  }

  async function rotate(env: Environment) {
    setBusy(env.id);
    setError(null);
    try {
      await api.rotateKey(project.id, env.id);
      onChange();
      setPendingRotate(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rotation failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Operator identity</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The actor email is stored as <code>x-actor-email</code> on audit records. If the API has <code>ADMIN_API_KEY</code> set, paste it here. It is sent as <code>x-api-key</code> and kept only in local storage.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Actor email" htmlFor="actor-email">
            <Input id="actor-email" value={actor} onChange={(event) => setActorValue(event.target.value)} autoComplete="off" />
          </Field>
          <Field label="Admin API key" htmlFor="admin-key" hint="Leave blank when the server is running without ADMIN_API_KEY.">
            <Input
              id="admin-key"
              type="password"
              value={adminKey}
              autoComplete="off"
              onChange={(event) => setAdminValue(event.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveIdentity}>Save identity</Button>
          <Button
            variant="outline"
            onClick={() => {
              setAdminValue("");
              setAdminKey("");
              setIdentityMessage("Admin key cleared.");
            }}
          >
            Clear admin key
          </Button>
        </div>
        {identityMessage && <Alert tone="success">{identityMessage}</Alert>}
      </Card>

      <Alert tone="warning" title="Key rotation is not instant for every process">
        Rotating revokes the previous SDK key and issues a new one. API processes cache a successful key lookup for about 30 seconds, so a revoked key can still authenticate until that cache entry expires. Update running SDKs promptly.
      </Alert>
      {error && <Alert tone="danger">{error}</Alert>}

      {project.environments.map((env) => {
        const current = activeSdkKey(env);
        return (
          <Card key={env.id} className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge color={env.production ? "red" : "green"}>{env.key}</Badge>
                <span className="font-medium">{env.name}</span>
                {env.production && <Badge color="amber">production</Badge>}
              </div>
              <Button size="sm" variant="outline" disabled={busy === env.id} onClick={() => setPendingRotate(env)}>
                {busy === env.id ? "Rotating…" : "Rotate key"}
              </Button>
            </div>
            <div className="space-y-2">
              {(env.sdkKeys ?? []).map((sdkKey) => (
                <div key={sdkKey.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <code className={`rounded bg-muted px-2 py-1 ${sdkKey.active ? "" : "line-through opacity-50"}`}>
                    {sdkKey.key}
                  </code>
                  <Badge color={sdkKey.active ? "green" : "gray"}>{sdkKey.active ? "active" : "revoked"}</Badge>
                  <span className="text-xs text-muted-foreground">{sdkKey.kind}</span>
                  {sdkKey.active && <CopyButton value={sdkKey.key} label={`Copy ${env.key} key`} />}
                </div>
              ))}
              {(env.sdkKeys ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">No SDK keys yet. Rotate to issue one.</p>
              )}
            </div>
            {current && <Quickstart sdkKey={current} />}
          </Card>
        );
      })}

      <ConfirmDialog
        open={!!pendingRotate}
        title={pendingRotate ? `Rotate the ${pendingRotate.name} SDK key?` : "Rotate key"}
        description="The current key is revoked. Clients may still authenticate for up to 30 seconds while the in-process auth cache expires. Live demo on this page will need the new key."
        confirmLabel="Rotate key"
        danger={!!pendingRotate?.production}
        busy={!!busy}
        onConfirm={() => pendingRotate && void rotate(pendingRotate)}
        onClose={() => setPendingRotate(null)}
      />
    </div>
  );
}

function Quickstart({ sdkKey }: { sdkKey: string }) {
  const base = api.base;
  const node = `import { FlagshipClient } from "@flagship/sdk";

const client = new FlagshipClient({
  sdkKey: "${sdkKey}",
  baseUrl: "${base}",
});
await client.start();
console.log(client.boolVariation("new-checkout", { key: "user-1" }, false));`;
  const python = `from flagship import FlagshipClient

client = FlagshipClient(sdk_key="${sdkKey}", base_url="${base}")
client.start()
print(client.bool_variation("new-checkout", {"key": "user-1"}, False))
client.close()`;
  const curl = `curl -s -H "Authorization: Bearer ${sdkKey}" ${base}/sdk/dataset`;

  return (
    <details className="rounded-lg border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">SDK quickstart</summary>
      <div className="mt-3 space-y-3">
        <Snippet label="cURL dataset" code={curl} />
        <Snippet label="Node" code={node} />
        <Snippet label="Python" code={python} />
      </div>
    </details>
  );
}

function Snippet({ label, code }: { label: string; code: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <CopyButton value={code} label={`Copy ${label}`} />
      </div>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">{code}</pre>
    </div>
  );
}
