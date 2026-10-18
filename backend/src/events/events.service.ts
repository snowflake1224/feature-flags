import { BadRequestException, Injectable } from "@nestjs/common";
import { evaluate, type EvalContext } from "@flagship/sdk";
import { PrismaService } from "../prisma/prisma.service";
import { DatasetService } from "../dataset/dataset.service";

export interface IncomingEvent {
  eventKey: string;
  /**
   * Stable context id. Still accepted on its own. When `context.key` is also
   * set, that key is the identity used for storage and evaluation.
   */
  contextKey?: string;
  /** Full evaluation context. Attribute targeting uses this at ingest. */
  context?: EvalContext;
  flagKey?: string;
  value?: number;
  metadata?: Record<string, unknown>;
  ts?: number;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * One identity for the stored contextKey and the evaluation key, so experiment
 * grouping matches the variation that was actually served. `contextKey` alone
 * remains valid for older clients.
 */
export function resolveIncomingContext(event: IncomingEvent): {
  contextKey: string;
  context: EvalContext;
} {
  const raw: unknown = event.context;
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) {
    throw new BadRequestException("context must be an object");
  }
  const record = (raw ?? {}) as Record<string, unknown>;
  const key = nonEmptyString(record.key) ?? nonEmptyString(event.contextKey);
  if (!key) {
    throw new BadRequestException("event requires contextKey or context.key");
  }
  return { contextKey: key, context: { ...record, key } };
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
   * client having to report it (works for key-bucketed rollouts and attribute
   * rules).
   */
  async ingest(environmentId: string, event: IncomingEvent) {
    const { contextKey, context } = resolveIncomingContext(event);
    let variationIndex: number | null = null;
    if (event.flagKey) {
      const ds = await this.dataset.getDataset(environmentId);
      const res = evaluate(ds, event.flagKey, context, null);
      variationIndex = res.variationIndex;
    }
    await this.prisma.event.create({
      data: {
        environmentId,
        eventKey: event.eventKey,
        contextKey,
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
