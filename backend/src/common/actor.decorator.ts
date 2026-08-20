import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/** Extracts the acting user's identity for audit records. */
export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return req.header("x-actor-email") || req.header("x-actor") || "system";
});
