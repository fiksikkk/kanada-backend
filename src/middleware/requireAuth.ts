import type { NextFunction, Request, Response } from "express";
import { findUserById } from "../repositories/UsersRepository.js";
import { resolveSession } from "../services/SessionService.js";

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const session = await resolveSession(req);
  if (!session) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const user = await findUserById(session.user_id);
  if (!user || !user.is_active) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  req.session = session;
  req.user = user;
  next();
}
