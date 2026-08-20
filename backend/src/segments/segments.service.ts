import { Injectable, NotFoundException } from "@nestjs/common";
import { nanoid } from "nanoid";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { DatasetService } from "../dataset/dataset.service";

export interface UpsertSegmentInput {
  key: string;
  name: string;
  description?: string;
  included?: string[];
  excluded?: string[];
  rules?: Prisma.InputJsonValue;
}

@Injectable()
export class SegmentsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private dataset: DatasetService,
  ) {}

  async list(environmentId: string) {
    return this.prisma.segment.findMany({ where: { environmentId }, orderBy: { key: "asc" } });
  }

  async create(projectId: string, environmentId: string, input: UpsertSegmentInput, actor: string) {
    const seg = await this.prisma.segment.create({
      data: {
        projectId,
        environmentId,
        key: input.key,
        name: input.name,
        description: input.description ?? "",
        included: input.included ?? [],
        excluded: input.excluded ?? [],
        rules: input.rules ?? [],
        salt: nanoid(16),
      },
    });
    await this.audit.record({
      projectId,
      environmentId,
      actor,
      action: "segment.created",
      entityType: "segment",
      entityId: seg.id,
      entityKey: seg.key,
      after: { key: seg.key, included: seg.included.length, excluded: seg.excluded.length },
    });
    await this.dataset.refresh(environmentId);
    return seg;
  }

  async update(
    projectId: string,
    environmentId: string,
    key: string,
    input: Partial<UpsertSegmentInput>,
    actor: string,
  ) {
    const existing = await this.prisma.segment.findUnique({
      where: { environmentId_key: { environmentId, key } },
    });
    if (!existing) throw new NotFoundException("segment not found");

    const updated = await this.prisma.segment.update({
      where: { environmentId_key: { environmentId, key } },
      data: {
        name: input.name ?? existing.name,
        description: input.description ?? existing.description,
        included: input.included ?? existing.included,
        excluded: input.excluded ?? existing.excluded,
        rules: input.rules ?? (existing.rules as Prisma.InputJsonValue),
      },
    });
    await this.audit.record({
      projectId,
      environmentId,
      actor,
      action: "segment.updated",
      entityType: "segment",
      entityId: updated.id,
      entityKey: updated.key,
      before: { included: existing.included, excluded: existing.excluded },
      after: { included: updated.included, excluded: updated.excluded },
    });
    await this.dataset.refresh(environmentId);
    return updated;
  }

  async remove(projectId: string, environmentId: string, key: string, actor: string) {
    const existing = await this.prisma.segment.findUnique({
      where: { environmentId_key: { environmentId, key } },
    });
    if (!existing) throw new NotFoundException("segment not found");
    await this.prisma.segment.delete({ where: { id: existing.id } });
    await this.audit.record({
      projectId,
      environmentId,
      actor,
      action: "segment.deleted",
      entityType: "segment",
      entityId: existing.id,
      entityKey: existing.key,
    });
    await this.dataset.refresh(environmentId);
    return { ok: true };
  }
}
