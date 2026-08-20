import { Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";
import { PrismaService } from "../prisma/prisma.service";

export interface ResolvedSdkKey {
  environmentId: string;
  environmentKey: string;
  projectId: string;
  kind: string;
}

/**
 * Resolves an SDK key (from `Authorization: Bearer <key>` or `x-sdk-key`) to
 * an environment. Cached in-process to keep the data-plane auth check off the
 * database on the hot path.
 */
@Injectable()
export class SdkAuthService {
  private cache = new Map<string, { value: ResolvedSdkKey; expires: number }>();
  private readonly ttlMs = 30_000;

  constructor(private prisma: PrismaService) {}

  extractKey(req: Request): string | null {
    const header = req.header("authorization");
    if (header?.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
    return req.header("x-sdk-key") ?? null;
  }

  async resolve(key: string | null): Promise<ResolvedSdkKey> {
    if (!key) throw new UnauthorizedException("missing SDK key");
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;

    const record = await this.prisma.sdkKey.findUnique({
      where: { key },
      include: { environment: true },
    });
    if (!record || !record.active) throw new UnauthorizedException("invalid SDK key");

    const resolved: ResolvedSdkKey = {
      environmentId: record.environmentId,
      environmentKey: record.environment.key,
      projectId: record.environment.projectId,
      kind: record.kind,
    };
    this.cache.set(key, { value: resolved, expires: Date.now() + this.ttlMs });
    return resolved;
  }

  async resolveFromRequest(req: Request): Promise<ResolvedSdkKey> {
    return this.resolve(this.extractKey(req));
  }
}
