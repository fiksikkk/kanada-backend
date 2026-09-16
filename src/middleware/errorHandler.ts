import type { NextFunction, Request, Response } from "express";

function isBodyParseError(err: unknown): boolean {
  return (
    err instanceof SyntaxError &&
    (err as { status?: unknown }).status === 400 &&
    (err as { type?: unknown }).type === "entity.parse.failed"
  );
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (res.headersSent) return;

  if (isBodyParseError(err)) {
    res.status(400).json({ error: "invalid_json" });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "internal_error" });
}
