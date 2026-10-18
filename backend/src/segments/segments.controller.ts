import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../common/admin.guard";
import { Actor } from "../common/actor.decorator";
import { SegmentsService } from "./segments.service";

@UseGuards(AdminGuard)
@Controller("projects/:projectId/environments/:environmentId/segments")
export class SegmentsController {
  constructor(private segments: SegmentsService) {}

  @Get()
  list(@Param("projectId") projectId: string, @Param("environmentId") environmentId: string) {
    return this.segments.list(projectId, environmentId);
  }

  @Post()
  create(
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
    @Body() body: Record<string, unknown>,
    @Actor() actor: string,
  ) {
    return this.segments.create(projectId, environmentId, body as never, actor);
  }

  @Patch(":key")
  update(
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
    @Param("key") key: string,
    @Body() body: Record<string, unknown>,
    @Actor() actor: string,
  ) {
    return this.segments.update(projectId, environmentId, key, body as never, actor);
  }

  @Delete(":key")
  remove(
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
    @Param("key") key: string,
    @Actor() actor: string,
  ) {
    return this.segments.remove(projectId, environmentId, key, actor);
  }
}
