import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";

type ChangeHandler = (payload: { version: number }) => void;

/** One SSE subscription. Identity, not the handler function, is the reference. */
interface ChannelRegistration {
  handler: ChangeHandler;
}

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
 *
 * The subscriber connection is process-wide. Listeners are tracked per channel
 * so one stream disconnect removes only that registration; Redis UNSUBSCRIBE
 * runs when the last registration for the channel is gone.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;
  readonly subscriber: Redis;
  private readonly url = process.env.REDIS_URL ?? "redis://localhost:6379";
  private readonly channelListeners = new Map<string, Set<ChannelRegistration>>();
  /** Serializes SUBSCRIBE/UNSUBSCRIBE so an in-flight subscribe cannot drop a newer listener. */
  private readonly channelQueue = new Map<string, Promise<void>>();
  private routerAttached = false;

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

  subscribeToChanges(environmentId: string, handler: ChangeHandler) {
    this.attachRouter();
    const chan = this.channel(environmentId);
    let registrations = this.channelListeners.get(chan);
    const wasEmpty = !registrations || registrations.size === 0;
    if (!registrations) {
      registrations = new Set();
      this.channelListeners.set(chan, registrations);
    }
    const registration: ChannelRegistration = { handler };
    registrations.add(registration);
    if (wasEmpty) {
      this.enqueueChannelOp(chan, async () => {
        if ((this.channelListeners.get(chan)?.size ?? 0) === 0) return;
        await this.subscriber.subscribe(chan);
      });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.channelListeners.get(chan);
      current?.delete(registration);
      if (current && current.size === 0) {
        this.channelListeners.delete(chan);
      }
      if ((this.channelListeners.get(chan)?.size ?? 0) > 0) return;
      this.enqueueChannelOp(chan, async () => {
        if ((this.channelListeners.get(chan)?.size ?? 0) > 0) return;
        await this.subscriber.unsubscribe(chan);
      });
    };
  }

  private attachRouter() {
    if (this.routerAttached) return;
    this.routerAttached = true;
    this.subscriber.on("message", (incoming: string, message: string) => {
      const registrations = this.channelListeners.get(incoming);
      if (!registrations || registrations.size === 0) return;
      let payload: { version: number };
      try {
        payload = JSON.parse(message) as { version: number };
      } catch {
        return;
      }
      for (const registration of [...registrations]) {
        try {
          registration.handler(payload);
        } catch {
          /* one listener must not block the rest of the channel */
        }
      }
    });
  }

  private enqueueChannelOp(channel: string, op: () => Promise<void>) {
    const prev = this.channelQueue.get(channel) ?? Promise.resolve();
    const next = prev.then(op, op).then(
      () => undefined,
      () => undefined,
    );
    this.channelQueue.set(channel, next);
  }
}
