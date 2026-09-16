import type { Request } from "express";

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export function requestMeta(req: Request): RequestMeta {
  return {
    ipAddress: req.ip ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}
