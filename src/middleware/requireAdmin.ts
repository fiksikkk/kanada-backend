import type { NextFunction, Request, Response } from "express";
import { UserRole } from "../repositories/UsersRepository.js";

/** Must run after requireAuth — relies on req.user being set. */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.user?.role !== UserRole.Admin) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}
