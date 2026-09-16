import type { NextFunction, Request, Response } from "express";
import { verifyCsrf } from "../services/SessionService.js";

/** Must run after requireAuth — relies on req.session being set. */
export function requireCsrf(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session || !verifyCsrf(req, req.session)) {
    res.status(403).json({ error: "csrf_mismatch" });
    return;
  }
  next();
}
