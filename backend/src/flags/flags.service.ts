import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { nanoid } from "nanoid";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DatasetService } from "../dataset/dataset.service";

export interface CreateFlagInput {
  key: string;
  name: string;
  description?: string;
  kind?: "boolean" | "string" | "number" | "json";
  variations?: unknown[];
  temporary?: boolean;
  tags?: string[];
}

export interface UpdateConfigInput {
  on?: boolean;
  offVariation?: number;
  fallthrough?: Prisma.InputJsonValue;
  targets?: Prisma.InputJsonValue;
  rules?: Prisma.InputJsonValue;
  prerequisites?: Prisma.InputJsonValue;
  comment?: string;
}

@Injectable()
export class FlagsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private dataset: DatasetService,
  ) {}

  async create(projectId: string, input: CreateFlagInput, actor: string) {
    const variations =
      input.variations ?? (input.kind === "boolean" || !input.kind ? [true, false] : []);
    if (variations.length < 1) {
      throw new BadRequestException("a flag needs at least one variation");
    }

    const environments = await this.prisma.environment.findMany({ where: { projectId } });

    const flag = await this.prisma.flag.create({
      data: {
        projectId,
        key: input.key,
        name: input.name,
        description: input.description ?? "",
        kind: input.kind ?? "boolean",
        variations: variations as Prisma.InputJsonValue,
        temporary: input.temporary ?? true,
        tags: input.tags ?? [],
        // Start OFF in every environment, serving the last variation (typically
        // "false"/control), so creating a flag never changes behavior.
        configs: {
          create: environments.map((env) => ({
            environmentId: env.id,
            on: false,
            offVariation: variations.length - 1,
            fallthrough: { variation: 0 } as Prisma.InputJsonValue,
            targets: [] as Prisma.InputJsonValue,
            rules: [] as Prisma.InputJsonValue,
            prerequisites: [] as Prisma.InputJsonValue,
            salt: nanoid(16),
            version: 1,
          })),
        },
      },
      include: { configs: true },
    });

    await this.audit.record({
      projectId,
      actor,
      action: "flag.created",
      entityType: "flag",
      entityId: flag.id,
      entityKey: flag.key,
      after: { key: flag.key, kind: flag.kind, variations },
    });

    for (const env of environments) await this.dataset.refresh(env.id);
    return flag;
  }

  async list(projectId: string) {
    return this.prisma.flag.findMany({
      where: { projectId },
      orderBy: { updatedAt: "desc" },
      include: { configs: { include: { environment: true } } },
    });
  }

  async get(projectId: string, key: string) {
    const flag = await this.prisma.flag.findUnique({
      where: { projectId_key: { projectId, key } },
      include: { configs: { include: { environment: true } } },
    });
    if (!flag) throw new NotFoundException("flag not found");
    return flag;
  }

  async updateConfig(
    projectId: string,
    key: string,
    environmentId: string,
    input: UpdateConfigInput,
    actor: string,
  ) {
    const flag = await this.get(projectId, key);
    const existing = flag.configs.find((c) => c.environmentId === environmentId);
    if (!existing) throw new NotFoundException("flag config not found for environment");

    const data: Prisma.FlagConfigUpdateInput = { version: { increment: 1 } };
    if (input.on !== undefined) data.on = input.on;
    if (input.offVariation !== undefined) data.offVariation = input.offVariation;
    if (input.fallthrough !== undefined) data.fallthrough = input.fallthrough;
    if (input.targets !== undefined) data.targets = input.targets;
    if (input.rules !== undefined) data.rules = input.rules;
    if (input.prerequisites !== undefined) data.prerequisites = input.prerequisites;

    const updated = await this.prisma.flagConfig.update({
      where: { flagId_environmentId: { flagId: flag.id, environmentId } },
      data,
    });

    await this.audit.record({
      projectId,
      environmentId,
      actor,
      action: "flag.updated",
      entityType: "flag",
      entityId: flag.id,
      entityKey: flag.key,
      comment: input.comment,
      before: {
        on: existing.on,
        offVariation: existing.offVariation,
        fallthrough: existing.fallthrough,
        targets: existing.targets,
        rules: existing.rules,
        prerequisites: existing.prerequisites,
      },
      after: {
        on: updated.on,
        offVariation: updated.offVariation,
        fallthrough: updated.fallthrough,
        targets: updated.targets,
        rules: updated.rules,
        prerequisites: updated.prerequisites,
      },
    });

    await this.dataset.refresh(environmentId);
    return updated;
  }

  /**
   * The kill switch. Isolated from updateConfig so it can be a single, fast,
   * heavily-audited operation. Flips `on` and immediately fans out the change.
   */
  async toggle(
    projectId: string,
    key: string,
    environmentId: string,
    on: boolean,
    actor: string,
    comment?: string,
  ) {
    const flag = await this.get(projectId, key);
    const existing = flag.configs.find((c) => c.environmentId === environmentId);
    if (!existing) throw new NotFoundException("flag config not found for environment");

    const updated = await this.prisma.flagConfig.update({
      where: { flagId_environmentId: { flagId: flag.id, environmentId } },
      data: { on, version: { increment: 1 } },
    });

    await this.audit.record({
      projectId,
      environmentId,
      actor,
      action: on ? "flag.enabled" : "flag.killswitch",
      entityType: "flag",
      entityId: flag.id,
      entityKey: flag.key,
      comment,
      before: { on: existing.on },
      after: { on: updated.on },
    });

    await this.dataset.refresh(environmentId);
    return updated;
  }

  async remove(projectId: string, key: string, actor: string) {
    const flag = await this.get(projectId, key);
    const envIds = flag.configs.map((c) => c.environmentId);
    await this.prisma.flag.delete({ where: { id: flag.id } });
    await this.audit.record({
      projectId,
      actor,
      action: "flag.deleted",
      entityType: "flag",
      entityId: flag.id,
      entityKey: flag.key,
      before: { key: flag.key },
    });
    for (const envId of envIds) await this.dataset.refresh(envId);
    return { ok: true };
  }
}
