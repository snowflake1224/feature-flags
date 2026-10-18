import { BadRequestException, NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { ClientDataset } from "@flagship/sdk";
import { OwnershipService } from "../src/common/ownership.service";
import { FlagsController } from "../src/flags/flags.controller";
import { FlagsService } from "../src/flags/flags.service";
import { SegmentsService } from "../src/segments/segments.service";
import { ExperimentsService } from "../src/experiments/experiments.service";
import { ProjectsService } from "../src/projects/projects.service";

function ownershipWith(
  project: { id: string } | null,
  environment: { id: string; projectId: string; key: string } | null,
) {
  const prisma = {
    project: { findUnique: vi.fn(async () => project) },
    environment: { findUnique: vi.fn(async () => environment) },
  };
  return { prisma, svc: new OwnershipService(prisma as never) };
}

async function catchStatus(promise: Promise<unknown>) {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err as { getStatus: () => number; message: string };
  }
}

describe("environment ownership", () => {
  const environment = { id: "env-a", projectId: "proj-a", key: "production" };

  it("returns the environment when it belongs to the project", async () => {
    const { svc } = ownershipWith({ id: "proj-a" }, environment);
    await expect(svc.assertEnvironmentInProject("proj-a", "env-a")).resolves.toEqual(environment);
  });

  it("returns 404 when the project or environment does not exist", async () => {
    const missingProject = await catchStatus(
      ownershipWith(null, environment).svc.assertEnvironmentInProject("proj-a", "env-a"),
    );
    expect(missingProject).toBeInstanceOf(NotFoundException);
    expect(missingProject?.getStatus()).toBe(404);
    expect(missingProject?.message).toBe("project not found");

    const missingEnv = await catchStatus(
      ownershipWith({ id: "proj-a" }, null).svc.assertEnvironmentInProject("proj-a", "env-a"),
    );
    expect(missingEnv).toBeInstanceOf(NotFoundException);
    expect(missingEnv?.getStatus()).toBe(404);
    expect(missingEnv?.message).toBe("environment not found");
  });

  it("returns 400 when the environment belongs to another project", async () => {
    const { svc } = ownershipWith({ id: "proj-a" }, { ...environment, projectId: "proj-b" });
    const err = await catchStatus(svc.assertEnvironmentInProject("proj-a", "env-a"));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err?.getStatus()).toBe(400);
    expect(err?.message).toBe("environment does not belong to project");
  });
});

describe("ownership on write and read paths", () => {
  const mismatch = new BadRequestException("environment does not belong to project");

  it("does not create a segment when the environment is not in the project", async () => {
    const create = vi.fn();
    const prisma = { segment: { create } };
    const ownership = { assertEnvironmentInProject: vi.fn(async () => Promise.reject(mismatch)) };
    const svc = new SegmentsService(prisma as never, {} as never, { refresh: vi.fn() } as never, ownership as never);
    await expect(
      svc.create("proj-a", "env-b", { key: "beta", name: "Beta" }, "ada"),
    ).rejects.toBe(mismatch);
    expect(create).not.toHaveBeenCalled();
  });

  it("lists experiments only inside the owning project", async () => {
    const findMany = vi.fn(async () => []);
    const ownership = {
      assertEnvironmentInProject: vi.fn(async () => ({ id: "env-a", projectId: "proj-a", key: "production" })),
    };
    const svc = new ExperimentsService({ experiment: { findMany } } as never, {} as never, ownership as never);
    await svc.list("proj-a", "env-a");
    expect(ownership.assertEnvironmentInProject).toHaveBeenCalledWith("proj-a", "env-a");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { environmentId: "env-a", projectId: "proj-a" } }),
    );

    ownership.assertEnvironmentInProject.mockRejectedValueOnce(mismatch);
    await expect(svc.list("proj-a", "env-b")).rejects.toBe(mismatch);
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("does not update a flag config when ownership fails", async () => {
    const findUnique = vi.fn();
    const ownership = { assertEnvironmentInProject: vi.fn(async () => Promise.reject(mismatch)) };
    const svc = new FlagsService(
      { flag: { findUnique } } as never,
      {} as never,
      { refresh: vi.fn() } as never,
      ownership as never,
    );
    await expect(svc.updateConfig("proj-a", "checkout", "env-b", { on: true }, "ada")).rejects.toBe(
      mismatch,
    );
    await expect(svc.toggle("proj-a", "checkout", "env-b", false, "ada")).rejects.toBe(mismatch);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("does not evaluate another project's environment", async () => {
    const getDataset = vi.fn();
    const ownership = { assertEnvironmentInProject: vi.fn(async () => Promise.reject(new NotFoundException("environment not found"))) };
    const controller = new FlagsController({} as never, { getDataset } as never, ownership as never);
    await expect(
      controller.evaluateForContext("proj-a", "env-b", "checkout", { key: "ada" }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(getDataset).not.toHaveBeenCalled();
  });

  it("evaluates after the environment is confirmed", async () => {
    const empty: ClientDataset = { environmentKey: "production", version: 1, flags: {}, segments: {} };
    const getDataset = vi.fn(async () => empty);
    const ownership = {
      assertEnvironmentInProject: vi.fn(async () => ({ id: "env-a", projectId: "proj-a", key: "production" })),
    };
    const controller = new FlagsController({} as never, { getDataset } as never, ownership as never);
    const result = await controller.evaluateForContext("proj-a", "env-a", "missing", { key: "ada" });
    expect(ownership.assertEnvironmentInProject).toHaveBeenCalledWith("proj-a", "env-a");
    expect(getDataset).toHaveBeenCalledWith("env-a");
    expect(result.reason.kind).toBe("ERROR");
  });

  it("turns a missing environment on legacy key rotation into 404", async () => {
    const updateMany = vi.fn();
    const prisma = {
      environment: { findUnique: vi.fn(async () => null) },
      sdkKey: { updateMany, create: vi.fn() },
    };
    const ownership = { assertEnvironmentInProject: vi.fn() };
    const svc = new ProjectsService(prisma as never, { record: vi.fn() } as never, ownership as never);
    const err = await catchStatus(svc.rotateSdkKey("missing", "ada"));
    expect(err).toBeInstanceOf(NotFoundException);
    expect(err?.getStatus()).toBe(404);
    expect(updateMany).not.toHaveBeenCalled();
    expect(ownership.assertEnvironmentInProject).not.toHaveBeenCalled();
  });

  it("rejects scoped key rotation before disabling keys", async () => {
    const updateMany = vi.fn();
    const prisma = {
      environment: { findUnique: vi.fn() },
      sdkKey: { updateMany, create: vi.fn() },
    };
    const ownership = { assertEnvironmentInProject: vi.fn(async () => Promise.reject(mismatch)) };
    const svc = new ProjectsService(prisma as never, { record: vi.fn() } as never, ownership as never);
    await expect(svc.rotateSdkKey("env-b", "ada", "proj-a")).rejects.toBe(mismatch);
    expect(ownership.assertEnvironmentInProject).toHaveBeenCalledWith("proj-a", "env-b");
    expect(prisma.environment.findUnique).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });
});
