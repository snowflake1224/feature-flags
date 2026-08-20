import { Injectable } from "@nestjs/common";
import { evaluate } from "@flagship/sdk";
import { PrismaService } from "../prisma/prisma.service";
import { DatasetService } from "../dataset/dataset.service";

export interface IncomingEvent {
  eventKey: string;
  contextKey: string;
  flagKey?: string;
  value?: number;
  metadata?: Record<string, unknown>;
  ts?: number;
}

@Injectable()
export class EventsService {
  constructor(
    private prisma: PrismaService,
    private dataset: DatasetService,
  ) {}

  /**
   * Ingest a metric event. If a flagKey is provided, we resolve the variation
   * the context lands in *at ingest time* using the same deterministic engine,
   * so experiment analysis can group conversions by variation without the
   * client having to report it (works for key-bucketed rollouts).
   */
  async ingest(environmentId: string, event: IncomingEvent) {
    let variationIndex: number | null = null;
    if (event.flagKey) {
      const ds = await this.dataset.getDataset(environmentId);
      const res = evaluate(ds, event.flagKey, { key: event.contextKey }, null);
      variationIndex = res.variationIndex;
    }
    await this.prisma.event.create({
      data: {
        environmentId,
        eventKey: event.eventKey,
        contextKey: event.contextKey,
        flagKey: event.flagKey ?? null,
        variationIndex,
        value: event.value ?? null,
        metadata: (event.metadata ?? undefined) as never,
        ts: event.ts ? new Date(event.ts) : new Date(),
      },
    });
    return { ok: true };
  }

  async ingestBatch(environmentId: string, events: IncomingEvent[]) {
    for (const e of events) await this.ingest(environmentId, e);
    return { ok: true, count: events.length };
  }
}
