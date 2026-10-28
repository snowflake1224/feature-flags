import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { FlagsService, assertSimpleRules, resolveVariations } from "../src/flags/flags.service";
import { MetricsService } from "../src/metrics/metrics.service";

describe("flag kinds", () => {
  it("boolean flags always serve [true, false]", () => {
    expect(resolveVariations("boolean", undefined)).toEqual([true, false]);
    expect(() => resolveVariations("boolean", [1, 0])).toThrow(BadRequestException);
  });

  it("string flags need string variations", () => {
    expect(resolveVariations("string", ["a", "b"])).toEqual(["a", "b"]);
    expect(() => resolveVariations("string", [{}, {}])).toThrow(BadRequestException);
    expect(() => resolveVariations("string", ["only"])).toThrow(BadRequestException);
  });
});

describe("simple audience rules", () => {
  it("accepts attribute equals and email domain clauses", () => {
    expect(() =>
      assertSimpleRules([
        { id: "r1", clauses: [{ attribute: "country", op: "in", values: ["US"] }], variation: 0 },
        { id: "r2", clauses: [{ attribute: "email", op: "endsWith", values: ["@flagship.dev"] }], variation: 0 },
      ]),
    ).not.toThrow();
  });

  it("rejects any other operator", () => {
    expect(() =>
      assertSimpleRules([{ id: "r1", clauses: [{ attribute: "version", op: "semverGreaterThan", values: ["1.0.0"] }] }]),
    ).toThrow(/'in' or 'endsWith'/);
    expect(() => assertSimpleRules([{ id: "r1", clauses: [{ attribute: "age", op: "in", values: [18] }] }])).toThrow(
      /strings/,
    );
  });
});

describe("toggle", () => {
  function service() {
    const config = { environmentId: "env-a", on: true };
    const prisma = {
      flag: { findUnique: vi.fn(async () => ({ id: "f1", key: "checkout", configs: [config] })) },
      flagConfig: { update: vi.fn(async ({ data }: { data: { on: boolean } }) => ({ ...config, on: data.on })) },
    };
    const audit = { record: vi.fn(async () => undefined) };
    const dataset = { refresh: vi.fn(async () => undefined) };
    const ownership = { assertEnvironmentInProject: vi.fn(async () => ({ id: "env-a" })) };
    const metrics = new MetricsService();
    const svc = new FlagsService(prisma as never, audit as never, dataset as never, ownership as never, metrics);
    return { svc, audit, dataset, metrics };
  }

  it("writes an audit row naming the actor and counts the kill", async () => {
    const { svc, audit, dataset, metrics } = service();
    await svc.toggle("proj-a", "checkout", "env-a", false, "ada@flagship.dev", "incident");
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "ada@flagship.dev",
        action: "flag.killswitch",
        entityKey: "checkout",
        before: { on: true },
        after: { on: false },
      }),
    );
    expect(dataset.refresh).toHaveBeenCalledWith("env-a");
    expect(metrics.render()).toContain("flagship_kills_total 1");
  });
});

describe("metrics", () => {
  it("renders counters in the Prometheus text format", () => {
    const metrics = new MetricsService();
    metrics.inc("evaluations");
    metrics.inc("evaluations");
    metrics.inc("datasetFetches");
    const text = metrics.render();
    expect(text).toContain("# TYPE flagship_evaluations_total counter");
    expect(text).toContain("flagship_evaluations_total 2");
    expect(text).toContain("flagship_dataset_fetches_total 1");
    expect(text).toContain("flagship_kills_total 0");
  });
});
