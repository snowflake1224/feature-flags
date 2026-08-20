"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Button, Card, Badge, Input } from "@/components/ui";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");

  async function load() {
    setLoading(true);
    try {
      setProjects(await api.listProjects());
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create() {
    if (!key || !name) return;
    await api.createProject({ key, name });
    setKey("");
    setName("");
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="text-sm text-muted-foreground">
          Each project has isolated environments, flags, and SDK keys.
        </p>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50 text-sm text-red-700">
          Could not reach API at <code>{api.base}</code>: {error}
        </Card>
      )}

      <Card className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Key</label>
          <Input placeholder="mobile-app" value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
          <Input placeholder="Mobile App" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button onClick={create}>Create project</Button>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} href={`/projects/${p.id}`}>
              <Card className="transition hover:border-primary/50 hover:shadow-md">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-muted-foreground">{p.key}</div>
                  </div>
                  <Badge color="blue">{p._count?.flags ?? 0} flags</Badge>
                </div>
                <div className="mt-3 flex gap-2">
                  {p.environments?.map((e: any) => (
                    <Badge key={e.id} color={e.production ? "red" : "green"}>
                      {e.key}
                    </Badge>
                  ))}
                </div>
              </Card>
            </Link>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No projects yet. Create one above, or run the backend seed script.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
