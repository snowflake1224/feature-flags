import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface OwnedEnvironment {
  id: string;
  projectId: string;
  key: string;
}

/**
 * Checks that a nested environment id belongs to the project in the route.
 * Missing rows are 404s. A real environment nested under the wrong project is
 * a 400, so callers do not write or read across projects and Prisma does not
 * surface that mismatch as a 500.
 */
@Injectable()
export class OwnershipService {
  constructor(private prisma: PrismaService) {}

  async assertEnvironmentInProject(
    projectId: string,
    environmentId: string,
  ): Promise<OwnedEnvironment> {
    const [project, environment] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: projectId },
        select: { id: true },
      }),
      this.prisma.environment.findUnique({
        where: { id: environmentId },
        select: { id: true, projectId: true, key: true },
      }),
    ]);

    if (!project) throw new NotFoundException("project not found");
    if (!environment) throw new NotFoundException("environment not found");
    if (environment.projectId !== projectId) {
      throw new BadRequestException("environment does not belong to project");
    }
    return environment;
  }
}
