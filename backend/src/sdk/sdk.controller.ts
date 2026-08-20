import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { SdkAuthService } from "../common/sdk-auth.service";
import { DatasetService } from "../dataset/dataset.service";
import { RedisService } from "../redis/redis.service";
import { EventsService, type IncomingEvent } from "../events/events.service";

/**
 * Data plane. All endpoints are authenticated by an environment SDK key
 * (Bearer token). These are the only endpoints on the hot path, so they read
 * exclusively from the Redis-backed dataset cache.
 */
@Controller("sdk")
export class SdkController {
  constructor(
    private sdkAuth: SdkAuthService,
    private dataset: DatasetService,
    private redis: RedisService,
    private events: EventsService,
  ) {}

  /** Polling clients pull the full compiled ruleset here. */
  @Get("dataset")
  async getDataset(@Req() req: Request) {
    const { environmentId } = await this.sdkAuth.resolveFromRequest(req);
    return this.dataset.getDataset(environmentId);
  }

  /**
   * Streaming clients hold this SSE connection open. On connect we push the
   * current dataset ("put"); on every change we push a lightweight "patch"
   * carrying the new version, prompting the client to re-pull. This is how
   * kill switches propagate in ~milliseconds.
   */
  @Get("stream")
  async stream(@Req() req: Request, @Res() res: Response) {
    const { environmentId } = await this.sdkAuth.resolveFromRequest(req);

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const dataset = await this.dataset.getDataset(environmentId);
    res.write(`event: put\ndata: ${JSON.stringify(dataset)}\n\n`);

    const unsubscribe = this.redis.subscribeToChanges(environmentId, (payload) => {
      res.write(`event: patch\ndata: ${JSON.stringify(payload)}\n\n`);
    });

    // Heartbeat so proxies/load balancers keep the connection alive.
    const heartbeat = setInterval(() => res.write(`: keep-alive\n\n`), 25_000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }

  /** Metric event ingestion (exposures + conversions for experiments). */
  @Post("events")
  async ingest(@Req() req: Request, @Body() body: IncomingEvent | { events: IncomingEvent[] }) {
    const { environmentId } = await this.sdkAuth.resolveFromRequest(req);
    if ("events" in body && Array.isArray(body.events)) {
      return this.events.ingestBatch(environmentId, body.events);
    }
    return this.events.ingest(environmentId, body as IncomingEvent);
  }
}
