"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { activeSdkKey } from "@/lib/format";
import type { Project } from "@/lib/types";
import { Alert, Badge, Skeleton, TabList } from "@/components/ui";
import FlagsTab from "./FlagsTab";
import SegmentsTab from "./SegmentsTab";
import ExperimentsTab from "./ExperimentsTab";
import AuditTab from "./AuditTab";
import SettingsTab from "./SettingsTab";
import LiveDemoTab from "./LiveDemoTab";
import DemoOnboarding from "./DemoOnboarding";

const TABS = [
  { id: "Flags", label: "Flags" },
  { id: "Segments", label: "Segments" },
  { id: "Experiments", label: "Experiments" },
  { id: "Live demo", label: "Live demo" },
  { id: "Audit log", label: "Audit log" },
  { id: "Settings", label: "Settings" },
] as const;

type Tab = (typeof TABS)[number]["id"];

export default function ProjectDashboard({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [envId, setEnvId] = useState("");
  const [tab, setTab] = useState<Tab>("Flags");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveMounted, setLiveMounted] = useState(false);

  function load() {
    setLoading(true);
    api
      .getProject(projectId)
      .then((next) => {
        setProject(next);
        setEnvId((current) => {
          if (current && next.environments.some((env) => env.id === current)) return current;
          const preferred = next.environments.find((env) => env.production) ?? next.environments[0];
          return preferred?.id ?? "";
        });
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (tab === "Live demo") setLiveMounted(true);
  }, [tab]);

  useEffect(() => {
    if (!project) return;
    document.title = `${project.name} — Flagship`;
    return () => {
      document.title = "Flagship — Feature Flags";
    };
  }, [project]);

  if (loading && !project) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading project">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <Alert tone="danger" title="Could not load this project">
        {error ?? "Project missing."}{" "}
        <button type="button" className="underline" onClick={load}>
          Retry
        </button>{" "}
        <Link href="/" className="underline">
          Back to projects
        </Link>
      </Alert>
    );
  }

  const env = project.environments.find((item) => item.id === envId);
  const production = !!env?.production;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-muted-foreground hover:underline">
            Projects
          </Link>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <div className="text-xs text-muted-foreground">{project.key}</div>
        </div>
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <span className="text-xs text-muted-foreground" id="env-label">
            Environment
          </span>
          <div className="flex overflow-hidden rounded-lg border border-border" role="group" aria-labelledby="env-label">
            {project.environments.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={item.id === envId}
                onClick={() => setEnvId(item.id)}
                className={`px-3 py-1.5 text-sm ${
                  item.id === envId ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
              >
                {item.key}
                {item.production ? " · prod" : ""}
              </button>
            ))}
          </div>
        </div>
      </div>

      {env && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Working in</span>
          <Badge color={env.production ? "red" : "green"}>{env.name}</Badge>
          {env.production && <span className="text-xs text-amber-800">Changes publish to live SDK clients.</span>}
        </div>
      )}

      <DemoOnboarding projectId={project.id} projectKey={project.key} onOpenTab={setTab} />

      <TabList tabs={[...TABS]} value={tab} onChange={(next) => {
  if (next === "Live demo") setLiveMounted(true);
  setTab(next);
}} label="Project sections" />

      {tab !== "Live demo" && (
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="space-y-4">
          {tab === "Flags" && envId && (
            <FlagsTab projectId={projectId} envId={envId} production={production} envName={env?.name ?? "this environment"} />
          )}
          {tab === "Segments" && envId && (
            <SegmentsTab projectId={projectId} envId={envId} production={production} envName={env?.name ?? "this environment"} />
          )}
          {tab === "Experiments" && envId && (
            <ExperimentsTab
              projectId={projectId}
              envId={envId}
              envName={env?.name ?? "this environment"}
              onOpenLive={() => setTab("Live demo")}
            />
          )}
          {tab === "Audit log" && <AuditTab projectId={projectId} />}
          {tab === "Settings" && <SettingsTab project={project} onChange={load} />}
        </div>
      )}

      {liveMounted && envId && (
        <div role="tabpanel" id="panel-Live demo" aria-labelledby="tab-Live demo" hidden={tab !== "Live demo"}>
          <LiveDemoTab
            projectId={projectId}
            envId={envId}
            envName={env?.name ?? "this environment"}
            sdkKey={activeSdkKey(env)}
            production={production}
            projectKey={project.key}
            onOpenTab={setTab}
          />
        </div>
      )}
    </div>
  );
}
