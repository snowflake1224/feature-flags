import { Engine } from "./engine";
import type { ClientDataset, EvalContext, EvalResult, FlagValue } from "./types";

export interface FlagshipClientOptions {
  /** environment SDK key, e.g. "sdk-prod-xxxx" */
  sdkKey: string;
  /** base URL of the Flagship API, e.g. http://localhost:4000 */
  baseUrl?: string;
  /** how often to re-fetch the flag set, ms */
  pollingIntervalMs?: number;
  /** how long to trust a stale dataset if the server is unreachable, ms. 0 = forever */
  maxStalenessMs?: number;
  /** optional: pre-seed with a bootstrap dataset for instant, offline start */
  bootstrap?: ClientDataset;
  logger?: Pick<Console, "warn" | "error" | "debug">;
}

type ChangeListener = () => void;

/**
 * Client SDK. Fetches the environment's flag set, then re-fetches it on an
 * interval. Evaluation is local and synchronous against the last fetched
 * copy, so a dashboard toggle takes effect on the next poll, not instantly.
 */
export class FlagshipClient {
  private engine: Engine | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
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
      pollingIntervalMs: options.pollingIntervalMs ?? 5_000,
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
    this.closed = false;
    await this.fetchDataset().catch((e) =>
      this.opts.logger.warn(`[flagship] initial fetch failed: ${e}`),
    );
    this.scheduleNextPoll();
    return this.readyPromise;
  }

  /** One fetch at a time, so a slow response can never overwrite a newer one. */
  private scheduleNextPoll() {
    if (this.closed) return;
    this.pollTimer = setTimeout(() => {
      this.fetchDataset()
        .catch((e) => this.opts.logger.warn(`[flagship] poll failed: ${e}`))
        .finally(() => this.scheduleNextPoll());
    }, this.opts.pollingIntervalMs);
  }

  /** Resolves once a dataset is available (from network or bootstrap). */
  async waitForReady(): Promise<void> {
    return this.readyPromise;
  }

  onChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async fetchDataset(): Promise<void> {
    const res = await fetch(`${this.opts.baseUrl}/sdk/dataset`, {
      headers: { Authorization: `Bearer ${this.opts.sdkKey}` },
    });
    if (!res.ok) throw new Error(`dataset fetch ${res.status}`);
    this.applyDataset((await res.json()) as ClientDataset);
  }

  private applyDataset(dataset: ClientDataset) {
    const changed = !this.engine || dataset.version !== this.engine.version;
    if (this.engine) this.engine.update(dataset);
    else this.engine = new Engine(dataset);
    this.lastUpdatedAt = Date.now();
    if (!this.ready) {
      this.ready = true;
      this.resolveReady();
    }
    if (changed) for (const l of this.listeners) l();
  }

  private isStale(): boolean {
    if (this.opts.maxStalenessMs === 0) return false;
    return Date.now() - this.lastUpdatedAt > this.opts.maxStalenessMs;
  }

  boolVariation(flagKey: string, context: EvalContext, defaultValue = false): boolean {
    return this.variation<boolean>(flagKey, context, defaultValue).value;
  }

  stringVariation(flagKey: string, context: EvalContext, defaultValue = ""): string {
    return this.variation<string>(flagKey, context, defaultValue).value;
  }

  /** Full evaluation with reason, used by the typed helpers. */
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

  close() {
    this.closed = true;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }
}
