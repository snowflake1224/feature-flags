import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../common/admin.guard";
import { Actor } from "../common/actor.decorator";
import { ExperimentsService, type CreateExperimentInput } from "./experiments.service";

@UseGuards(AdminGuard)
@Controller("projects/:projectId/environments/:environmentId/experiments")
export class ExperimentsController {
  constructor(private experiments: ExperimentsService) {}

  @Get()
  list(@Param("environmentId") environmentId: string) {
    return this.experiments.list(environmentId);
  }

  @Post()
  create(
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
    @Body() body: CreateExperimentInput,
    @Actor() actor: string,
  ) {
    return this.experiments.create(projectId, environmentId, body, actor);
  }

  @Get(":key/results")
  results(@Param("environmentId") environmentId: string, @Param("key") key: string) {
    return this.experiments.results(environmentId, key);
  }
}
