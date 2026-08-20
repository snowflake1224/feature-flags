import { Injectable } from "@nestjs/common";
import type { ClientDataset, Flag, Segment } from "@flagship/sdk";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

/**
 * Compiles the control-plane tables into a single immutable ruleset per
 * environment (the "data plane" artifact), caches it in Redis, and fans out
 * change notifications. Every flag/segment write path calls `refresh()` so the
 * cache and all connected SDK streams converge within milliseconds.
 */
@Injectable()
export class DatasetService {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async buildDataset(environmentId: string): Promise<ClientDataset> {
    const environment = await this.prisma.environment.findUniqueOrThrow({
      where: { id: environmentId },
    });

    const configs = await this.prisma.flagConfig.findMany({
      where: { environmentId },
      include: { flag: true },
    });

    const segments = await this.prisma.segment.findMany({ where: { environmentId } });

    const flags: Record<string, Flag> = {};
    for (const cfg of configs) {
      flags[cfg.flag.key] = {
        key: cfg.flag.key,
        on: cfg.on,
        variations: cfg.flag.variations as Flag["variations"],
        offVariation: cfg.offVariation,
        fallthrough: cfg.fallthrough as Flag["fallthrough"],
        targets: cfg.targets as Flag["targets"],
        rules: cfg.rules as Flag["rules"],
        prerequisites: cfg.prerequisites as Flag["prerequisites"],
        salt: cfg.salt,
        version: cfg.version,
      };
    }

    const segmentMap: Record<string, Segment> = {};
    for (const seg of segments) {
      segmentMap[seg.key] = {
        key: seg.key,
        included: seg.included,
        excluded: seg.excluded,
        rules: seg.rules as Segment["rules"],
        salt: seg.salt,
      };
    }

    // Environment-level version = sum of flag config versions + segment count.
    // Any change bumps at least one config version, so this monotonically grows.
    const version =
      configs.reduce((acc, c) => acc + c.version, 0) + segments.length * 1_000_000;

    return {
      environmentKey: environment.key,
      version,
      flags,
      segments: segmentMap,
    };
  }

  async getDataset(environmentId: string): Promise<ClientDataset> {
    const cached = await this.redis.getCachedDataset<ClientDataset>(environmentId);
    if (cached) return cached;
    const dataset = await this.buildDataset(environmentId);
    await this.redis.cacheDataset(environmentId, dataset);
    return dataset;
  }

  /** Rebuild cache and notify subscribers. Call after every write. */
  async refresh(environmentId: string): Promise<ClientDataset> {
    const dataset = await this.buildDataset(environmentId);
    await this.redis.cacheDataset(environmentId, dataset);
    await this.redis.publishChange(environmentId, { version: dataset.version });
    return dataset;
  }
}
