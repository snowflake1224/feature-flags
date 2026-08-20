import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

/**
 * Thin Redis wrapper providing:
 *  - a shared command connection (cache reads/writes)
 *  - a dedicated subscriber connection for pub/sub fan-out to SSE streams
 *
 * Redis is used two ways in Flagship:
 *  1. Dataset cache (data plane): compiled per-environment rulesets so the SDK
 *     endpoints never touch Postgres on the hot path.
 *  2. Change stream (control -> data plane): every publish notifies connected
 *     SDK streams so kill switches propagate in ~milliseconds.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  readonly subscriber: Redis;
  private readonly url = process.env.REDIS_URL ?? "redis://localhost:6379";

  constructor() {
    this.client = new Redis(this.url, { maxRetriesPerRequest: null, lazyConnect: true });
    this.subscriber = new Redis(this.url, { maxRetriesPerRequest: null, lazyConnect: true });
  }

  async onModuleInit() {
    await this.client.connect().catch(() => undefined);
    await this.subscriber.connect().catch(() => undefined);
  }

  async onModuleDestroy() {
    this.client.disconnect();
    this.subscriber.disconnect();
  }

  private datasetKey(sdkKeyOrEnvId: string) {
    return `flagship:dataset:${sdkKeyOrEnvId}`;
  }

  private channel(environmentId: string) {
    return `flagship:changes:${environmentId}`;
  }

  async cacheDataset(environmentId: string, dataset: unknown, ttlSeconds = 3600) {
    await this.client.set(
      this.datasetKey(environmentId),
      JSON.stringify(dataset),
      "EX",
      ttlSeconds,
    );
  }

  async getCachedDataset<T>(environmentId: string): Promise<T | null> {
    const raw = await this.client.get(this.datasetKey(environmentId));
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async invalidateDataset(environmentId: string) {
    await this.client.del(this.datasetKey(environmentId));
  }

  /** Notify all subscribers (SSE streams) that an environment changed. */
  async publishChange(environmentId: string, payload: { version: number }) {
    await this.client.publish(this.channel(environmentId), JSON.stringify(payload));
  }

  subscribeToChanges(environmentId: string, handler: (payload: { version: number }) => void) {
    const chan = this.channel(environmentId);
    const listener = (incoming: string, message: string) => {
      if (incoming === chan) {
        try {
          handler(JSON.parse(message));
        } catch {
          /* ignore malformed */
        }
      }
    };
    void this.subscriber.subscribe(chan);
    this.subscriber.on("message", listener);
    return () => {
      this.subscriber.off("message", listener);
      void this.subscriber.unsubscribe(chan);
    };
  }
}
