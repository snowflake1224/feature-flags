"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui";
import FlagsTab from "./FlagsTab";
import SegmentsTab from "./SegmentsTab";
import ExperimentsTab from "./ExperimentsTab";
import AuditTab from "./AuditTab";
import SettingsTab from "./SettingsTab";

const TABS = ["Flags", "Segments", "Experiments", "Audit log", "Settings"] as const;
type Tab = (typeof TABS)[number];

export default function ProjectDashboard({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<any>(null);
  const [envId, setEnvId] = useState<string>("");
  const [tab, setTab] = useState<Tab>("Flags");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProject(projectId)
      .then((p) => {
        setProject(p);
        const prod = p.environments.find((e: any) => e.production) ?? p.environments[0];
        setEnvId(prod?.id ?? "");
      })
      .catch((e) => setError(e.message));
  }, [projectId]);

  if (error)
    return (
      <div className="text-sm text-red-600">
        Failed to load project: {error}. <Link href="/" className="underline">Back</Link>
      </div>
    );
  if (!project) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const env = project.environments.find((e: any) => e.id === envId);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-muted-foreground hover:underline">
            ← Projects
          </Link>
          <h1 className="text-2xl font-semibold">{project.name}</h1>
          <div className="text-xs text-muted-foreground">{project.key}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Environment</span>
          <div className="flex overflow-hidden rounded-lg border border-border">
            {project.environments.map((e: any) => (
              <button
                key={e.id}
                onClick={() => setEnvId(e.id)}
                className={`px-3 py-1.5 text-sm ${
                  e.id === envId ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
              >
                {e.key}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium ${
              tab === t
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {env && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          Viewing <Badge color={env.production ? "red" : "green"}>{env.name}</Badge>
        </div>
      )}

      {tab === "Flags" && <FlagsTab projectId={projectId} envId={envId} />}
      {tab === "Segments" && <SegmentsTab projectId={projectId} envId={envId} />}
      {tab === "Experiments" && <ExperimentsTab projectId={projectId} envId={envId} />}
      {tab === "Audit log" && <AuditTab projectId={projectId} />}
      {tab === "Settings" && <SettingsTab project={project} onChange={() => api.getProject(projectId).then(setProject)} />}
    </div>
  );
}
