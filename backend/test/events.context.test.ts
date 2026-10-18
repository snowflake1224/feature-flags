import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ClientDataset } from "@flagship/sdk";
import { EventsService, type IncomingEvent } from "../src/events/events.service";

const dataset: ClientDataset = {
  environmentKey: "test",
  version: 1,
  segments: {},
  flags: {
    checkout: {
      key: "checkout",
      on: true,
      variations: ["new", "old"],
      offVariation: 1,
      fallthrough: { variation: 1 },
      targets: [],
      rules: [
        {
          id: "us",
          clauses: [{ attribute: "country", op: "in", values: ["US"] }],
          variation: 0,
        },
      ],
      prerequisites: [],
      salt: "salt",
      version: 1,
    },
  },
};

function service() {
  const created: Array<Record<string, unknown>> = [];
  const prisma = {
    event: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
    },
  };
  const datasets = {
    getDataset: vi.fn(async () => dataset),
  };
  return {
    created,
    datasets,
    svc: new EventsService(prisma as never, datasets as never),
  };
}

describe("event variation attribution", () => {
  it("uses the full context for attribute rules and still stores contextKey", async () => {
    const { svc, created } = service();
    await svc.ingest("env-1", {
      eventKey: "pricing_viewed",
      contextKey: "ada",
      context: { key: "ada", country: "US" },
      flagKey: "checkout",
    });
    await svc.ingest("env-1", {
      eventKey: "pricing_viewed",
      contextKey: "ada",
      flagKey: "checkout",
    });

    expect(created[0]).toMatchObject({ contextKey: "ada", variationIndex: 0, flagKey: "checkout" });
    expect(created[1]).toMatchObject({ contextKey: "ada", variationIndex: 1 });
  });

  it("accepts a context object without a separate contextKey", async () => {
    const { svc, created } = service();
    await svc.ingest("env-1", {
      eventKey: "pricing_viewed",
      context: { key: "grace", country: "US", plan: "pro" },
      flagKey: "checkout",
    });
    expect(created[0]).toMatchObject({ contextKey: "grace", variationIndex: 0 });
  });

  it("fills a missing context.key from contextKey and keeps attributes", async () => {
    const { svc, created } = service();
    const event = {
      eventKey: "pricing_viewed",
      contextKey: "ada",
      context: { country: "FR" },
      flagKey: "checkout",
    } as IncomingEvent;
    await svc.ingest("env-1", event);
    expect(created[0]).toMatchObject({ contextKey: "ada", variationIndex: 1 });
  });

  it("prefers context.key when it differs from contextKey", async () => {
    const { svc, created } = service();
    await svc.ingest("env-1", {
      eventKey: "pricing_viewed",
      contextKey: "legacy-id",
      context: { key: "ada", country: "US" },
      flagKey: "checkout",
    });
    expect(created[0]).toMatchObject({ contextKey: "ada", variationIndex: 0 });
  });

  it("attributes a batch independently and rejects events with no identity", async () => {
    const { svc, created, datasets } = service();
    await svc.ingestBatch("env-1", [
      { eventKey: "pricing_viewed", context: { key: "ada", country: "US" }, flagKey: "checkout" },
      { eventKey: "pricing_viewed", contextKey: "grace", flagKey: "checkout" },
    ]);
    expect(created.map((row) => row.variationIndex)).toEqual([0, 1]);

    await expect(svc.ingest("env-1", { eventKey: "pricing_viewed" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.ingest("env-1", { eventKey: "pricing_viewed", contextKey: "ada", context: [] as never }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(created).toHaveLength(2);
    expect(datasets.getDataset).toHaveBeenCalledTimes(2);
  });
});
