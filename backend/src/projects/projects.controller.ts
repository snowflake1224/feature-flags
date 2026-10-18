import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { IsString, Matches } from "class-validator";
import { AdminGuard } from "../common/admin.guard";
import { Actor } from "../common/actor.decorator";
import { ProjectsService } from "./projects.service";

class CreateProjectDto {
  @Matches(/^[a-z0-9-]+$/, { message: "key must be lowercase alphanumeric with dashes" })
  key!: string;

  @IsString()
  name!: string;
}

@UseGuards(AdminGuard)
@Controller("projects")
export class ProjectsController {
  constructor(private projects: ProjectsService) {}

  @Post()
  create(@Body() dto: CreateProjectDto, @Actor() actor: string) {
    return this.projects.create(dto, actor);
  }

  @Get()
  list() {
    return this.projects.list();
  }

  @Get(":projectId")
  get(@Param("projectId") projectId: string) {
    return this.projects.get(projectId);
  }

  // Static first segment, registered before ":projectId/environments/...", so the
  // legacy URL is not parsed with projectId === "environments".
  @Post("environments/:environmentId/rotate-key")
  rotate(@Param("environmentId") environmentId: string, @Actor() actor: string) {
    return this.projects.rotateSdkKey(environmentId, actor);
  }

  @Post(":projectId/environments/:environmentId/rotate-key")
  rotateForProject(
    @Param("projectId") projectId: string,
    @Param("environmentId") environmentId: string,
    @Actor() actor: string,
  ) {
    return this.projects.rotateSdkKey(environmentId, actor, projectId);
  }
}
