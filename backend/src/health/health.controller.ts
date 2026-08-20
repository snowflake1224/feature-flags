import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

@Controller("health")
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Get()
  async health() {
    const checks: Record<string, string> = {};
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.postgres = "ok";
    } catch {
      checks.postgres = "down";
    }
    try {
      await this.redis.client.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "down";
    }
    const ok = Object.values(checks).every((v) => v === "ok");
    return { status: ok ? "ok" : "degraded", checks, ts: new Date().toISOString() };
  }
}
