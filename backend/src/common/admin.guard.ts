import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import type { Request } from "express";

/**
 * Dashboard/API auth for the control plane.
 *
 * If ADMIN_API_KEY is set, callers must present it via `x-api-key`. In local
 * dev (no ADMIN_API_KEY) the guard is permissive so the dashboard works out of
 * the box. The acting user's email is read from `x-actor-email` purely for the
 * audit trail — swap this for real OIDC/JWT in production.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const required = process.env.ADMIN_API_KEY;
    if (required) {
      const provided = req.header("x-api-key");
      if (provided !== required) {
        throw new UnauthorizedException("invalid admin api key");
      }
    }
    return true;
  }
}
