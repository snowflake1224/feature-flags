import { describe, expect, it, vi } from "vitest";
import { DatasetService } from "../src/dataset/dataset.service";
import { SegmentsService } from "../src/segments/segments.service";

function flagConfig(version: number, key = "checkout") {
  return {
    version,
    on: true,
    offVariation: 1,
    fallthrough: { variation: 0 },
    targets: [],
    rules: [],
    prerequisites: [],
    salt: "salt",
    flag: { key, variations: [true, false] },
  };
}

function segmentRow(key: string, version: number) {
  return { key, version, included: [], excluded: [], rules: [], salt: "seg" };
}

function datasetService(
  configs: ReturnType<typeof flagConfig>[],
  segments: ReturnType<typeof segmentRow>[],
) {
  const prisma = {
    environment: { findUniqueOrThrow: async () => ({ id: "env", key: "production" }) },
    flagConfig: { findMany: async () => configs },
    segment: { findMany: async () => segments },
  };
  return new DatasetService(prisma as never, {} as never);
}

describe("segment versions in the dataset", () => {
  it("changes the dataset version when only a segment revision changes", async () => {
    const before = await datasetService([flagConfig(2)], [segmentRow("beta-users", 1)]).buildDataset(
      "env",
    );
    const after = await datasetService([flagConfig(2)], [segmentRow("beta-users", 2)]).buildDataset(
      "env",
    );
    expect(before.version).toBe(2 + 1_000_000 + 1);
    expect(after.version).toBe(before.version + 1);
  });

  it("keeps flag versions and segment count in the aggregate", async () => {
    const dataset = await datasetService(
      [flagConfig(2, "checkout"), flagConfig(3, "pricing")],
      [segmentRow("beta", 1), segmentRow("staff", 4)],
    ).buildDataset("env");
    expect(dataset.version).toBe(5 + 2_000_000 + 5);
  });

  it("is the flag sum when the environment has no segments", async () => {
    const dataset = await datasetService([flagConfig(4)], []).buildDataset("env");
    expect(dataset.version).toBe(4);
  });
});

describe("segment update revision", () => {
  function segmentsService() {
    const existing = {
      id: "seg-1",
      projectId: "proj",
      key: "beta-users",
      name: "Beta",
      description: "",
      included: ["ada"],
      excluded: [],
      rules: [],
    };
    const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      ...existing,
      ...data,
      version: 2,
    }));
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
      id: "seg-2",
      ...data,
    }));
    const prisma = {
      segment: { findUnique: vi.fn(async () => existing), update, create },
    };
    const ownership = {
      assertEnvironmentInProject: vi.fn(async () => ({
        id: "env",
        projectId: "proj",
        key: "production",
      })),
    };
    const audit = { record: vi.fn(async () => undefined) };
    const dataset = { refresh: vi.fn(async () => undefined) };
    const svc = new SegmentsService(prisma as never, audit as never, dataset as never, ownership as never);
    return { svc, update, create, dataset };
  }

  it("increments version atomically on update", async () => {
    const { svc, update, dataset } = segmentsService();
    await svc.update("proj", "env", "beta-users", { name: "Beta users" }, "ada");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Beta users",
          version: { increment: 1 },
        }),
      }),
    );
    expect(dataset.refresh).toHaveBeenCalledWith("env");
  });

  it("creates a segment at version 1", async () => {
    const { svc, create } = segmentsService();
    await svc.create("proj", "env", { key: "staff", name: "Staff" }, "ada");
    expect(create.mock.calls[0]?.[0].data.version).toBe(1);
  });
});
