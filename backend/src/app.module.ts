import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma/prisma.module";
import { RedisModule } from "./redis/redis.module";
import { CommonModule } from "./common/common.module";
import { DatasetModule } from "./dataset/dataset.module";
import { AuditModule } from "./audit/audit.module";
import { EventsModule } from "./events/events.module";
import { ProjectsModule } from "./projects/projects.module";
import { FlagsModule } from "./flags/flags.module";
import { SegmentsModule } from "./segments/segments.module";
import { SdkModule } from "./sdk/sdk.module";
import { ExperimentsModule } from "./experiments/experiments.module";
import { HealthController } from "./health/health.controller";

@Module({
  imports: [
    // Global infrastructure
    PrismaModule,
    RedisModule,
    CommonModule,
    DatasetModule,
    AuditModule,
    EventsModule,
    // Feature modules
    ProjectsModule,
    FlagsModule,
    SegmentsModule,
    SdkModule,
    ExperimentsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
