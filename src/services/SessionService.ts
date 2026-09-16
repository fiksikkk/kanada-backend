import crypto from "node:crypto";
import { parseCookie as parseCookieHeader } from "cookie";
import { unsign } from "cookie-signature";
import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { requestMeta } from "../utils/requestMeta.js";
import {
  createSession,
  findActiveSessionByTokenHash,
  revokeSessionByTokenHash,
  touchSession,
  type SessionRow,
} from "../repositories/SessionsRepository.js";

const SESSION_COOKIE = "kanada_sid";
const CSRF_COOKIE = "kanada_csrf";
const PENDING_COOKIE = "kanada_pending";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;
const PENDING_COOKIE_PATH = "/auth/2fa";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

interface CookieOptionsInput {
  maxAgeMs: number;
  path?: string;
  httpOnly?: boolean;
  signed?: boolean;
}

// Общие security-флаги (secure/sameSite) для всех cookie этого сервиса в
// одном месте - session, CSRF и pending-challenge cookie отличаются только
// httpOnly/signed/path/TTL.
function cookieOptions({
  maxAgeMs,
  path = "/",
  httpOnly = true,
  signed = true,
}: CookieOptionsInput) {
  return {
    httpOnly,
    secure: env.isProduction,
    sameSite: "lax" as const,
    signed,
    path,
    maxAge: maxAgeMs,
  };
}

export async function issueSession(
  req: Request,
  res: Response,
  userId: number,
): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const csrfSecret = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await createSession({
    userId,
    tokenHash: hashToken(token),
    csrfSecret,
    ...requestMeta(req),
    expiresAt,
  });

  res.cookie(SESSION_COOKIE, token, cookieOptions({ maxAgeMs: SESSION_TTL_MS }));
  res.cookie(
    CSRF_COOKIE,
    csrfSecret,
    cookieOptions({ maxAgeMs: SESSION_TTL_MS, httpOnly: false, signed: false }),
  );
}

export async function resolveSession(
  req: Request,
): Promise<SessionRow | null> {
  const token = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
  if (!token) return null;

  const session = await findActiveSessionByTokenHash(hashToken(token));
  if (!session) return null;

  await touchSession(session.id);
  return session;
}

// Тот же разбор подписанной cookie, что делает cookie-parser (см. app.ts)
// - но тут вручную, потому что апгрейд WS-соединения (WsGatewayService)
// происходит на голом http.Server до того, как Express-мидлвары успевают
// отработать.
export async function resolveSessionFromCookieHeader(
  cookieHeader: string | undefined,
): Promise<SessionRow | null> {
  if (!cookieHeader) return null;

  const cookies = parseCookieHeader(cookieHeader);
  const raw = cookies[SESSION_COOKIE];
  if (!raw || !raw.startsWith("s:")) return null;

  const token = unsign(raw.slice(2), env.cookieSecret);
  if (token === false) return null;

  const session = await findActiveSessionByTokenHash(hashToken(token));
  if (!session) return null;

  await touchSession(session.id);
  return session;
}

export async function destroySession(
  req: Request,
  res: Response,
): Promise<void> {
  const token = req.signedCookies?.[SESSION_COOKIE] as string | undefined;
  if (token) {
    await revokeSessionByTokenHash(hashToken(token));
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}

export function verifyCsrf(req: Request, session: SessionRow): boolean {
  const header = req.get("x-csrf-token");
  if (typeof header !== "string") return false;

  const a = Buffer.from(header);
  const b = Buffer.from(session.csrf_secret);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// "Незавершённый" логин: пароль уже проверен, 2FA - ещё нет. Челлендж
// живёт своим ID (UUID из auth.login_challenges, сам по себе непредсказуем)
// - отдельного секрета не нужно, cookie ограничена путём /auth/2fa, чтобы
// не улетала на прочие запросы.
export function issuePendingChallengeCookie(
  res: Response,
  challengeId: string,
): void {
  res.cookie(
    PENDING_COOKIE,
    challengeId,
    cookieOptions({ maxAgeMs: PENDING_TTL_MS, path: PENDING_COOKIE_PATH }),
  );
}

export function readPendingChallengeId(req: Request): string | null {
  const id = req.signedCookies?.[PENDING_COOKIE] as string | undefined;
  return id ?? null;
}

export function clearPendingChallengeCookie(res: Response): void {
  res.clearCookie(PENDING_COOKIE, { path: PENDING_COOKIE_PATH });
}
