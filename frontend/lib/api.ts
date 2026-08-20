const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

// Dashboard identity used for the audit trail. In a real deployment this comes
// from the signed-in user; here we default to a demo operator.
const ACTOR =
  (typeof window !== "undefined" && localStorage.getItem("flagship.actor")) || "demo@flagship.dev";

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      "x-actor-email": ACTOR,
      ...(opts.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  base: BASE,
  // projects
  listProjects: () => request<any[]>("/projects"),
  getProject: (id: string) => request<any>(`/projects/${id}`),
  createProject: (body: { key: string; name: string }) =>
    request<any>("/projects", { method: "POST", body: JSON.stringify(body) }),
  rotateKey: (environmentId: string) =>
    request<any>(`/projects/environments/${environmentId}/rotate-key`, { method: "POST" }),

  // flags
  listFlags: (projectId: string) => request<any[]>(`/projects/${projectId}/flags`),
  getFlag: (projectId: string, key: string) =>
    request<any>(`/projects/${projectId}/flags/${key}`),
  createFlag: (projectId: string, body: any) =>
    request<any>(`/projects/${projectId}/flags`, { method: "POST", body: JSON.stringify(body) }),
  updateConfig: (projectId: string, key: string, envId: string, body: any) =>
    request<any>(`/projects/${projectId}/flags/${key}/environments/${envId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  toggleFlag: (projectId: string, key: string, envId: string, on: boolean, comment?: string) =>
    request<any>(`/projects/${projectId}/flags/${key}/environments/${envId}/toggle`, {
      method: "POST",
      body: JSON.stringify({ on, comment }),
    }),
  evaluate: (projectId: string, key: string, envId: string, context: any) =>
    request<any>(`/projects/${projectId}/flags/${key}/environments/${envId}/evaluate`, {
      method: "POST",
      body: JSON.stringify(context),
    }),
  deleteFlag: (projectId: string, key: string) =>
    request<any>(`/projects/${projectId}/flags/${key}`, { method: "DELETE" }),

  // segments
  listSegments: (projectId: string, envId: string) =>
    request<any[]>(`/projects/${projectId}/environments/${envId}/segments`),
  createSegment: (projectId: string, envId: string, body: any) =>
    request<any>(`/projects/${projectId}/environments/${envId}/segments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSegment: (projectId: string, envId: string, key: string, body: any) =>
    request<any>(`/projects/${projectId}/environments/${envId}/segments/${key}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  // audit
  listAudit: (projectId: string) => request<any[]>(`/projects/${projectId}/audit?limit=200`),

  // experiments
  listExperiments: (projectId: string, envId: string) =>
    request<any[]>(`/projects/${projectId}/environments/${envId}/experiments`),
  experimentResults: (projectId: string, envId: string, key: string) =>
    request<any>(`/projects/${projectId}/environments/${envId}/experiments/${key}/results`),
};
