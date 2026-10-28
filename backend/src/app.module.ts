import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { CommonModule } from "./common/common.module";
import { DatasetModule } from "./dataset/dataset.module";
import { AuditModule } from "./audit/audit.module";
import { MetricsModule } from "./metrics/metrics.module";
import { ProjectsModule } from "./projects/projects.module";
import { FlagsModule } from "./flags/flags.module";
import { SdkModule } from "./sdk/sdk.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    // Global infrastructure
    PrismaModule,
    RedisModule,
    CommonModule,
    DatasetModule,
    AuditModule,
    MetricsModule,
    // Feature modules
    ProjectsModule,
    FlagsModule,
    SdkModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
