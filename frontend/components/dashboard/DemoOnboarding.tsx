"use client";

import { useEffect, useState } from "react";
import { CopyButton, Button } from "@/components/ui";

const DISMISS_PREFIX = "flagship.onboarding.dismissed.";

export default function DemoOnboarding({
  projectId,
  projectKey,
  onOpenTab,
}: {
  projectId: string;
  projectKey: string;
  onOpenTab: (tab: "Flags" | "Live demo" | "Audit log" | "Settings") => void;
}) {
  const storageKey = `${DISMISS_PREFIX}${projectId}`;
  const [open, setOpen] = useState(projectKey === "demo");

  useEffect(() => {
    const dismissed = window.localStorage.getItem(storageKey) === "1";
    setOpen(!dismissed && projectKey === "demo");
  }, [storageKey, projectKey]);

  if (!open) {
    return (
      <button type="button" className="text-xs text-primary underline" onClick={() => setOpen(true)}>
        Show demo guide
      </button>
    );
  }

  const demo = projectKey === "demo";

  return (
    <section className="rounded-lg border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{demo ? "Five-minute demo" : "How this console fits together"}</h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {demo
              ? "Start in production. Open Live demo, turn new-checkout off, watch the next fetch pick it up, then read who flipped it in the audit log."
              : "Create a flag, turn it on, then open Live demo to see the next fetch pick it up."}
          </p>
        </div>
        <button
          type="button"
          className="text-xs text-muted-foreground underline"
          onClick={() => {
            window.localStorage.setItem(storageKey, "1");
            setOpen(false);
          }}
        >
          Dismiss
        </button>
      </div>
      <ol className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <li>1. Flags: <code>new-checkout</code> is a 20% sticky rollout plus one rule. Production asks you to confirm.</li>
        <li>2. Live demo: polls the flag set every 3 seconds and evaluates it in the browser.</li>
        <li>
          3. Contexts to try: an email ending in <code>@flagship.dev</code> (rule match), or any other key (rollout).
        </li>
        <li>4. Audit log: every toggle records who flipped it.</li>
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => onOpenTab("Flags")}>
          Flags
        </Button>
        <Button size="sm" variant="secondary" onClick={() => onOpenTab("Live demo")}>
          Live demo
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("Audit log")}>
          Audit
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOpenTab("Settings")}>
          SDK keys
        </Button>
      </div>
      {demo && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <code className="rounded bg-background px-2 py-1">node examples/node-demo/index.mjs</code>
          <CopyButton value="node examples/node-demo/index.mjs" label="Copy Node" />
        </div>
      )}
    </section>
  );
}
