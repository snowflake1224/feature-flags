"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, getActor, subscribeIdentity } from "@/lib/api";
import { Badge, StatusDot } from "@/components/ui";

export default function AppHeader() {
  const [actor, setActor] = useState("demo@flagship.dev");
  const [health, setHealth] = useState<"checking" | "ok" | "degraded" | "down">("checking");

  useEffect(() => {
    setActor(getActor());
    return subscribeIdentity(() => setActor(getActor()));
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const report = await api.health();
        if (cancelled) return;
        setHealth(report.status === "ok" ? "ok" : "degraded");
      } catch {
        if (!cancelled) setHealth("down");
      }
    }
    void load();
    const timer = window.setInterval(load, 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const tone = health === "ok" ? "ok" : health === "degraded" ? "warn" : health === "down" ? "down" : "idle";
  const healthLabel =
    health === "ok"
      ? "API healthy"
      : health === "degraded"
        ? "API degraded"
        : health === "down"
          ? "API unreachable"
          : "Checking API";

  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-primary text-sm text-primary-foreground">
            F
          </span>
          Flagship
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden sm:inline">operator console</span>
          <Badge color="indigo">{actor}</Badge>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-1" title={healthLabel}>
            <StatusDot tone={tone} />
            <span>{healthLabel}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
