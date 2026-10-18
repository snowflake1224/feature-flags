import { consumeSseBuffer } from "./sse";
import type {
  AuditEntry,
  ClientDataset,
  CreateExperimentInput,
  CreateFlagInput,
  EvalContext,
  EvalResult,
  Experiment,
  ExperimentResults,
  Flag,
  FlagConfig,
  HealthReport,
  Project,
  SdkEventInput,
  Segment,
  SegmentInput,
  StreamMessage,
  UpdateConfigInput,
} from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const ACTOR_KEY = "flagship.actor";
const ADMIN_KEY = "flagship.adminKey";
const IDENTITY_EVENT = "flagship-identity";
const DEFAULT_ACTOR = "demo@flagship.dev";

function browserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/** Read on every request so Settings changes apply without a reload. */
export function getActor(): string {
  return browserStorage()?.getItem(ACTOR_KEY) || DEFAULT_ACTOR;
}

export function getAdminKey(): string {
  return browserStorage()?.getItem(ADMIN_KEY) || "";
}

export function setActor(email: string) {
  browserStorage()?.setItem(ACTOR_KEY, email.trim() || DEFAULT_ACTOR);
  window.dispatchEvent(new Event(IDENTITY_EVENT));
}

export function setAdminKey(key: string) {
  const storage = browserStorage();
  const trimmed = key.trim();
  if (!storage) return;
  if (trimmed) storage.setItem(ADMIN_KEY, trimmed);
  else storage.removeItem(ADMIN_KEY);
  window.dispatchEvent(new Event(IDENTITY_EVENT));
}

export function subscribeIdentity(listener: () => void): () => void {
  window.addEventListener(IDENTITY_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(IDENTITY_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

function adminHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-actor-email": getActor(),
  };
  const adminKey = getAdminKey();
  if (adminKey) headers["x-api-key"] = adminKey;
  return headers;
}

function messageFromBody(status: number, statusText: string, text: string): string {
  try {
    const parsed = JSON.parse(text) as { message?: string | string[] };
    const message = Array.isArray(parsed.message) ? parsed.message.join(", ") : parsed.message;
    if (message) return `${status}: ${message}`;
  } catch {
    /* body is not JSON */
  }
  const detail = text.trim();
  return detail ? `${status} ${statusText}: ${detail}` : `${status} ${statusText}`;
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { ...adminHeaders(), ...(opts.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(messageFromBody(res.status, res.statusText, await res.text()));
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

async function sdkRequest<T>(path: string, sdkKey: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sdkKey}`,
      ...(opts.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(messageFromBody(res.status, res.statusText, await res.text()));
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

export interface SdkStreamHandlers {
  signal?: AbortSignal;
  onEvent: (message: StreamMessage) => void;
  onOpen?: () => void;
}

/**
 * Authenticated dataset stream. Native EventSource cannot send Authorization,
 * so this reads the SSE body from fetch().
 */
export async function streamSdk(sdkKey: string, handlers: SdkStreamHandlers): Promise<void> {
  const res = await fetch(`${BASE}/sdk/stream`, {
    headers: { Authorization: `Bearer ${sdkKey}`, Accept: "text/event-stream" },
    cache: "no-store",
    signal: handlers.signal,
  });
  if (!res.ok || !res.body) {
    throw new Error(messageFromBody(res.status, res.statusText, await res.text()));
  }
  handlers.onOpen?.();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    buffer = consumeSseBuffer(buffer, handlers.onEvent);
  }
}

export const api = {
  base: BASE,
  listProjects: () => request<Project[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (body: { key: string; name: string }) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),
  rotateKey: (projectId: string, environmentId: string) =>
    request<{ id: string; key: string; kind: string; active: boolean }>(
      `/projects/${projectId}/environments/${environmentId}/rotate-key`,
      { method: "POST" },
    ),

  listFlags: (projectId: string) => request<Flag[]>(`/projects/${projectId}/flags`),
  getFlag: (projectId: string, key: string) => request<Flag>(`/projects/${projectId}/flags/${key}`),
  createFlag: (projectId: string, body: CreateFlagInput) =>
    request<Flag>(`/projects/${projectId}/flags`, { method: "POST", body: JSON.stringify(body) }),
  updateConfig: (projectId: string, key: string, envId: string, body: UpdateConfigInput) =>
    request<FlagConfig>(`/projects/${projectId}/flags/${key}/environments/${envId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  toggleFlag: (projectId: string, key: string, envId: string, on: boolean, comment?: string) =>
    request(`/projects/${projectId}/flags/${key}/environments/${envId}/toggle`, {
      method: "POST",
      body: JSON.stringify({ on, comment }),
    }),
  evaluate: (projectId: string, key: string, envId: string, context: EvalContext) =>
    request<EvalResult>(`/projects/${projectId}/flags/${key}/environments/${envId}/evaluate`, {
      method: "POST",
      body: JSON.stringify(context),
    }),
  deleteFlag: (projectId: string, key: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/flags/${key}`, { method: "DELETE" }),

  listSegments: (projectId: string, envId: string) =>
    request<Segment[]>(`/projects/${projectId}/environments/${envId}/segments`),
  createSegment: (projectId: string, envId: string, body: SegmentInput) =>
    request<Segment>(`/projects/${projectId}/environments/${envId}/segments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateSegment: (projectId: string, envId: string, key: string, body: Partial<SegmentInput>) =>
    request<Segment>(`/projects/${projectId}/environments/${envId}/segments/${key}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  deleteSegment: (projectId: string, envId: string, key: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/environments/${envId}/segments/${key}`, {
      method: "DELETE",
    }),

  listAudit: (projectId: string, opts?: { limit?: number; entityId?: string }) => {
    const params = new URLSearchParams();
    params.set("limit", String(opts?.limit ?? 200));
    if (opts?.entityId) params.set("entityId", opts.entityId);
    return request<AuditEntry[]>(`/projects/${projectId}/audit?${params.toString()}`);
  },

  listExperiments: (projectId: string, envId: string) =>
    request<Experiment[]>(`/projects/${projectId}/environments/${envId}/experiments`),
  createExperiment: (projectId: string, envId: string, body: CreateExperimentInput) =>
    request<Experiment>(`/projects/${projectId}/environments/${envId}/experiments`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  experimentResults: (projectId: string, envId: string, key: string) =>
    request<ExperimentResults>(
      `/projects/${projectId}/environments/${envId}/experiments/${key}/results`,
    ),

  health: () => request<HealthReport>("/health"),
  getSdkDataset: (sdkKey: string) => sdkRequest<ClientDataset>("/sdk/dataset", sdkKey),
  ingestSdkEvent: (sdkKey: string, event: SdkEventInput) =>
    sdkRequest<{ ok: boolean; count?: number }>("/sdk/events", sdkKey, {
      method: "POST",
      body: JSON.stringify(event),
    }),
  streamSdk,
};
