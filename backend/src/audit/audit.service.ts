import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditInput {
  projectId: string;
  environmentId?: string | null;
  actor: string;
  action: string;
  entityType: string;
  entityId: string;
  entityKey?: string;
  comment?: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Append-only audit log. Every mutating service method records who changed
 * what, with a before/after snapshot, so the dashboard can render a full
 * history and diffs for compliance and incident review.
 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async record(input: AuditInput) {
    await this.prisma.auditLog.create({
      data: {
        projectId: input.projectId,
        environmentId: input.environmentId ?? null,
        actor: input.actor || "system",
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        entityKey: input.entityKey ?? "",
        comment: input.comment ?? "",
        before: (input.before ?? undefined) as never,
        after: (input.after ?? undefined) as never,
      },
    });
  }

  async list(projectId: string, opts: { limit?: number; entityId?: string } = {}) {
    return this.prisma.auditLog.findMany({
      where: { projectId, ...(opts.entityId ? { entityId: opts.entityId } : {}) },
      orderBy: { createdAt: "desc" },
      take: Math.min(opts.limit ?? 100, 500),
    });
  }
}
