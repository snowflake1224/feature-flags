import EventSource from "eventsource";
import { Engine } from "./engine";
import type { ClientDataset, EvalContext, EvalResult, FlagValue } from "./types";

export type DataSourceMode = "streaming" | "polling";

export interface FlagshipClientOptions {
  /** environment SDK key, e.g. "sdk-prod-xxxx" */
  sdkKey: string;
  /** base URL of the Flagship API, e.g. http://localhost:4000 */
  baseUrl?: string;
  /** streaming (SSE, near-real-time) or polling */
  mode?: DataSourceMode;
  /** polling interval in ms (polling mode only) */
  pollingIntervalMs?: number;
  /** how long to trust a stale dataset if the server is unreachable, ms. 0 = forever */
  maxStalenessMs?: number;
  /** optional: pre-seed with a bootstrap dataset for instant, offline start */
  bootstrap?: ClientDataset;
  logger?: Pick<Console, "warn" | "error" | "debug">;
}

type ChangeListener = () => void;

/**
 * Client SDK. Downloads the environment ruleset once, then keeps it fresh via
 * SSE streaming (default) or interval polling. Evaluation is local and
 * synchronous — a flag read never blocks on the network, which is what keeps
 * p99 read latency in the microseconds.
 */
export class FlagshipClient {
  private engine: Engine | null = null;
  private es: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastUpdatedAt = 0;
  private ready = false;
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private listeners = new Set<ChangeListener>();
  private readonly opts: Required<Omit<FlagshipClientOptions, "bootstrap" | "logger">> & {
    bootstrap?: ClientDataset;
    logger: Pick<Console, "warn" | "error" | "debug">;
  };

  constructor(options: FlagshipClientOptions) {
    this.opts = {
      baseUrl: options.baseUrl ?? "http://localhost:4000",
      mode: options.mode ?? "streaming",
      pollingIntervalMs: options.pollingIntervalMs ?? 15_000,
      maxStalenessMs: options.maxStalenessMs ?? 0,
      sdkKey: options.sdkKey,
      bootstrap: options.bootstrap,
      logger: options.logger ?? console,
    };
    this.readyPromise = new Promise((res) => (this.resolveReady = res));
    if (options.bootstrap) {
      this.engine = new Engine(options.bootstrap);
      this.lastUpdatedAt = Date.now();
    }
  }

  async start(): Promise<void> {
    await this.fetchDataset().catch((e) =>
      this.opts.logger.warn(`[flagship] initial fetch failed: ${e}`),
    );
    if (this.opts.mode === "streaming") {
      this.connectStream();
    } else {
      this.pollTimer = setInterval(() => {
        void this.fetchDataset();
      }, this.opts.pollingIntervalMs);
    }
    return this.readyPromise;
  }

  /** Resolves once a dataset is available (from network or bootstrap). */
  async waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private headers() {
    return { Authorization: `Bearer ${this.opts.sdkKey}`, "Content-Type": "application/json" };
  }

  private async fetchDataset(): Promise<void> {
    const res = await fetch(`${this.opts.baseUrl}/sdk/dataset`, { headers: this.headers() });
    if (!res.ok) throw new Error(`dataset fetch ${res.status}`);
    const dataset = (await res.json()) as ClientDataset;
    this.applyDataset(dataset);
  }

  private applyDataset(dataset: ClientDataset) {
    if (this.engine && dataset.version < this.engine.version) {
      // Ignore out-of-order updates.
      return;
    }
    if (this.engine) this.engine.update(dataset);
    else this.engine = new Engine(dataset);
    this.lastUpdatedAt = Date.now();
    if (!this.ready) {
      this.ready = true;
      this.resolveReady();
    }
    for (const l of this.listeners) l();
  }

  private connectStream() {
    const url = `${this.opts.baseUrl}/sdk/stream`;
    this.es = new EventSource(url, { headers: this.headers() } as never);
    this.es.addEventListener("put", (ev) => {
      try {
        this.applyDataset(JSON.parse((ev as MessageEvent).data));
      } catch (e) {
        this.opts.logger.error(`[flagship] bad stream payload: ${e}`);
      }
    });
    // A lightweight "ping" that just carries the latest version; if it's newer
    // than what we hold, pull the full dataset. Keeps kill-switch latency low.
    this.es.addEventListener("patch", () => void this.fetchDataset());
    this.es.onerror = () => {
      this.opts.logger.warn("[flagship] stream error; EventSource will auto-reconnect");
    };
  }

  private isStale(): boolean {
    if (this.opts.maxStalenessMs === 0) return false;
    return Date.now() - this.lastUpdatedAt > this.opts.maxStalenessMs;
  }

  /** Boolean convenience wrapper. */
  boolVariation(flagKey: string, context: EvalContext, defaultValue = false): boolean {
    return this.variation<boolean>(flagKey, context, defaultValue).value;
  }

  stringVariation(flagKey: string, context: EvalContext, defaultValue = ""): string {
    return this.variation<string>(flagKey, context, defaultValue).value;
  }

  numberVariation(flagKey: string, context: EvalContext, defaultValue = 0): number {
    return this.variation<number>(flagKey, context, defaultValue).value;
  }

  jsonVariation<T extends FlagValue>(flagKey: string, context: EvalContext, defaultValue: T): T {
    return this.variation<T>(flagKey, context, defaultValue).value;
  }

  /** Full evaluation with reason, used by all typed helpers. */
  variation<T extends FlagValue>(
    flagKey: string,
    context: EvalContext,
    defaultValue: T,
  ): EvalResult<T> {
    if (!this.engine || this.isStale()) {
      return { value: defaultValue, variationIndex: null, reason: { kind: "ERROR" } };
    }
    return this.engine.evaluate<T>(flagKey, context, defaultValue);
  }

  allFlags(context: EvalContext): Record<string, FlagValue> {
    if (!this.engine) return {};
    const out: Record<string, FlagValue> = {};
    for (const key of this.engine.allFlagKeys()) {
      out[key] = this.engine.evaluate(key, context, null).value;
    }
    return out;
  }

  /**
   * Record an experiment event (exposure or conversion). Fire-and-forget;
   * failures are swallowed so analytics never breaks the request path.
   */
  async track(
    eventKey: string,
    context: EvalContext,
    opts: { flagKey?: string; value?: number; metadata?: Record<string, unknown> } = {},
  ): Promise<void> {
    try {
      await fetch(`${this.opts.baseUrl}/sdk/events`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          eventKey,
          contextKey: context.key,
          flagKey: opts.flagKey,
          value: opts.value,
          metadata: opts.metadata,
          ts: Date.now(),
        }),
      });
    } catch (e) {
      this.opts.logger.debug?.(`[flagship] track failed: ${e}`);
    }
  }

  close() {
    this.es?.close();
    if (this.pollTimer) clearInterval(this.pollTimer);
  }
}
