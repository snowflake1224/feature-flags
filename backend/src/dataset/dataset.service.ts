import { Injectable } from "@nestjs/common";
import type { ClientDataset, Flag } from "@flagship/sdk";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

/**
 * Compiles the Postgres flag config into one flag set per environment and
 * caches it in Redis. Every flag write path calls `refresh()`; polling clients
 * see the change on their next fetch.
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

    const flags: Record<string, Flag> = {};
    for (const cfg of configs) {
      flags[cfg.flag.key] = {
        key: cfg.flag.key,
        on: cfg.on,
        variations: cfg.flag.variations as Flag["variations"],
        offVariation: cfg.offVariation,
        fallthrough: cfg.fallthrough as Flag["fallthrough"],
        targets: cfg.targets as unknown as Flag["targets"],
        rules: cfg.rules as unknown as Flag["rules"],
        prerequisites: cfg.prerequisites as unknown as Flag["prerequisites"],
        salt: cfg.salt,
        version: cfg.version,
      };
    }

    return {
      environmentKey: environment.key,
      version: configs.reduce((acc, c) => acc + c.version, 0),
      flags,
    };
  }

  async getDataset(environmentId: string): Promise<ClientDataset> {
    const cached = await this.redis.getCachedDataset<ClientDataset>(environmentId);
    if (cached) return cached;
    const dataset = await this.buildDataset(environmentId);
    await this.redis.cacheDataset(environmentId, dataset);
    return dataset;
  }

  /** Rebuild the cached flag set. Call after every write. */
  async refresh(environmentId: string): Promise<ClientDataset> {
    const dataset = await this.buildDataset(environmentId);
    await this.redis.cacheDataset(environmentId, dataset);
    return dataset;
  }
}
