import { Injectable, NotFoundException } from "@nestjs/common";
import { customAlphabet } from "nanoid";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { OwnershipService } from "../common/ownership.service";

const keyId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 12);

function sdkKey(envKey: string) {
  return `sdk-${envKey}-${keyId()}`;
}

@Injectable()
export class ProjectsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private ownership: OwnershipService,
  ) {}

  async create(input: { key: string; name: string }, actor: string) {
    const project = await this.prisma.project.create({
      data: {
        key: input.key,
        name: input.name,
        environments: {
          create: [
            { key: "production", name: "Production", production: true, color: "#ef4444" },
            { key: "development", name: "Development", production: false, color: "#22c55e" },
          ],
        },
      },
      include: { environments: true },
    });

    // Issue a server SDK key per environment.
    for (const env of project.environments) {
      await this.prisma.sdkKey.create({
        data: { environmentId: env.id, key: sdkKey(env.key), kind: "server" },
      });
    }

    await this.audit.record({
      projectId: project.id,
      actor,
      action: "project.created",
      entityType: "project",
      entityId: project.id,
      entityKey: project.key,
      after: { key: project.key, name: project.name },
    });

    return this.get(project.id);
  }

  async list() {
    return this.prisma.project.findMany({
      orderBy: { createdAt: "desc" },
      include: { environments: true, _count: { select: { flags: true } } },
    });
  }

  async get(id: string) {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { environments: { include: { sdkKeys: true } } },
    });
    if (!project) throw new NotFoundException("project not found");
    return project;
  }

  async rotateSdkKey(environmentId: string, actor: string, projectId?: string) {
    const env = projectId
      ? await this.ownership.assertEnvironmentInProject(projectId, environmentId)
      : await this.prisma.environment.findUnique({ where: { id: environmentId } });
    if (!env) throw new NotFoundException("environment not found");
    await this.prisma.sdkKey.updateMany({
      where: { environmentId, active: true },
      data: { active: false },
    });
    const created = await this.prisma.sdkKey.create({
      data: { environmentId, key: sdkKey(env.key), kind: "server" },
    });
    await this.audit.record({
      projectId: env.projectId,
      environmentId,
      actor,
      action: "sdkkey.rotated",
      entityType: "environment",
      entityId: environmentId,
      entityKey: env.key,
    });
    return created;
  }
}
