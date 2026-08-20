import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { AdminGuard } from "../common/admin.guard";
import { AuditService } from "./audit.service";

@UseGuards(AdminGuard)
@Controller("projects/:projectId/audit")
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  list(
    @Param("projectId") projectId: string,
    @Query("limit") limit?: string,
    @Query("entityId") entityId?: string,
  ) {
    return this.audit.list(projectId, {
      limit: limit ? Number(limit) : undefined,
      entityId,
    });
  }
}
