"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { slugKey, validateProjectKey } from "@/lib/targeting";
import type { Project } from "@/lib/types";
import { Alert, Badge, Button, Card, EmptyState, Field, Input, Skeleton } from "@/components/ui";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    document.title = "Projects — Flagship";
    void load();
  }, []);

  async function create() {
    const keyError = validateProjectKey(key);
    if (keyError || !name.trim()) {
      setFormError(keyError ?? "Name is required.");
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api.createProject({ key: key.trim(), name: name.trim() });
      setKey("");
      setName("");
      setKeyEdited(false);
      await load();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  const demo = projects.find((project) => project.key === "demo");

  return (
    <div className="space-y-6">
      <div className="max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-wide text-primary">Control plane</p>
        <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Projects</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Each project isolates environments, flags, segments, and SDK keys. Open one to edit targeting, watch the dataset stream, and read experiment results.
        </p>
      </div>

      {demo && (
        <Card className="border-primary/30 bg-primary/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Guided demo is ready</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {demo.name} includes a checkout rollout, a beta segment, and a pricing experiment.
              </p>
            </div>
            <Link href={`/projects/${demo.id}`}>
              <Button>Open demo</Button>
            </Link>
          </div>
        </Card>
      )}

      {error && (
        <Alert tone="danger" title="API unreachable">
          Could not reach <code>{api.base}</code>. {error}
        </Alert>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Create a project</h2>
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <Field label="Name" htmlFor="project-name" className="min-w-[160px] flex-1">
            <Input
              id="project-name"
              placeholder="Mobile App"
              value={name}
              onChange={(event) => {
                const next = event.target.value;
                setName(next);
                if (!keyEdited) setKey(slugKey(next, true));
              }}
            />
          </Field>
          <Field label="Key" htmlFor="project-key" error={formError} className="min-w-[160px] flex-1">
            <Input
              id="project-key"
              placeholder="mobile-app"
              value={key}
              aria-invalid={!!formError}
              onChange={(event) => {
                setKeyEdited(true);
                setKey(event.target.value);
              }}
            />
          </Field>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create project"}
          </Button>
        </form>
      </Card>

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading projects">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : projects.length === 0 ? (
        <EmptyState title="No projects yet">
          Create one above, or run the backend seed to load the guided demo project.
        </EmptyState>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => (
            <Link key={project.id} href={`/projects/${project.id}`} className="block rounded-lg focus-visible:outline-none">
              <Card className="h-full transition hover:border-primary/50 hover:shadow-md">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">{project.name}</div>
                    <div className="text-xs text-muted-foreground">{project.key}</div>
                  </div>
                  <div className="flex gap-2">
                    {project.key === "demo" && <Badge color="indigo">Demo</Badge>}
                    <Badge color="blue">{project._count?.flags ?? 0} flags</Badge>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {project.environments?.map((env) => (
                    <Badge key={env.id} color={env.production ? "red" : "green"}>
                      {env.key}
                    </Badge>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
