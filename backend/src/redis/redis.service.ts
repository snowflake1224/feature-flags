import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

/**
 * Thin Redis wrapper for the compiled per-environment flag set, so polling
 * SDK clients usually skip Postgres. Every write rebuilds the cached entry.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  private readonly url = process.env.REDIS_URL ?? "redis://localhost:6379";

  constructor() {
    this.client = new Redis(this.url, { maxRetriesPerRequest: null, lazyConnect: true });
  }

  async onModuleInit() {
    await this.client.connect().catch(() => undefined);
  }

  async onModuleDestroy() {
    this.client.disconnect();
  }

  private datasetKey(environmentId: string) {
    return `flagship:dataset:${environmentId}`;
  }

  async cacheDataset(environmentId: string, dataset: unknown, ttlSeconds = 3600) {
    await this.client.set(this.datasetKey(environmentId), JSON.stringify(dataset), "EX", ttlSeconds);
  }

  async getCachedDataset<T>(environmentId: string): Promise<T | null> {
    const raw = await this.client.get(this.datasetKey(environmentId));
    return raw ? (JSON.parse(raw) as T) : null;
  }
}
