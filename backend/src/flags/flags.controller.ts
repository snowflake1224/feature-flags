import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, Matches } from "class-validator";
import { AdminGuard } from "../common/admin.guard";
import { Actor } from "../common/actor.decorator";
import { FlagsService } from "./flags.service";
import { evaluate, type ClientDataset, type EvalContext } from "@flagship/sdk";
import { DatasetService } from "../dataset/dataset.service";
import { OwnershipService } from "../common/ownership.service";
import { MetricsService } from "../metrics/metrics.service";

class CreateFlagDto {
  @Matches(/^[a-zA-Z0-9-_.]+$/)
  key!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(["boolean", "string"]) kind?: "boolean" | "string";
  @IsOptional() @IsArray() variations?: unknown[];
  @IsOptional() @IsBoolean() temporary?: boolean;
  @IsOptional() @IsArray() tags?: string[];
}

class ToggleDto {
  @IsBoolean() on!: boolean;
  @IsOptional() @IsString() comment?: string;
}

@UseGuards(AdminGuard)
@Controller("projects/:projectId/flags")
export class FlagsController {
  constructor(
    private flags: FlagsService,
    private dataset: DatasetService,
    private ownership: OwnershipService,
    private metrics: MetricsService,
  ) {}

  @Post()
  create(
    @Param("projectId") projectId: string,
    @Body() dto: CreateFlagDto,
    @Actor() actor: string,
  ) {
    return this.flags.create(projectId, dto, actor);
  }

  @Get()
  list(@Param("projectId") projectId: string) {
    return this.flags.list(projectId);
  }

  @Get(":key")
  get(@Param("projectId") projectId: string, @Param("key") key: string) {
    return this.flags.get(projectId, key);
  }

  @Patch(":key/environments/:environmentId")
  updateConfig(
    @Param("projectId") projectId: string,
    @Param("key") key: string,
    @Param("environmentId") environmentId: string,
    @Body() body: Record<string, unknown>,
    @Actor() actor: string,
  ) {
    return this.flags.updateConfig(projectId, key, environmentId, body, actor);
  }

  @Post(":key/environments/:environmentId/toggle")
  toggle(
    @Param("projectId") projectId: string,
    @Param("key") key: string,
    @Param("environmentId") environmentId: string,
    @Body() dto: ToggleDto,
    @Actor() actor: string,
  ) {
    return this.flags.toggle(projectId, key, environmentId, dto.on, actor, dto.comment);
  }

  /** "Test targeting" — evaluate a flag for an arbitrary context in the UI. */
  @Post(":key/environments/:environmentId/evaluate")
  async evaluateForContext(
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
    @Param("key") key: string,
    @Body() context: EvalContext,
  ) {
    await this.ownership.assertEnvironmentInProject(projectId, environmentId);
    const ds: ClientDataset = await this.dataset.getDataset(environmentId);
    this.metrics.inc("evaluations");
    return evaluate(ds, key, context ?? { key: "anonymous" }, null);
  }

  @Delete(":key")
  remove(
    @Param("projectId") projectId: string,
    @Param("key") key: string,
    @Actor() actor: string,
  ) {
    return this.flags.remove(projectId, key, actor);
  }
}
