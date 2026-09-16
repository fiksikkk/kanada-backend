import type { Request, Response } from "express";
import { AuditEventType, recordAuditEvent } from "../repositories/AuditLogRepository.js";
import {
  MAX_CHALLENGE_ATTEMPTS,
  deleteLoginChallenge,
  findActiveLoginChallenge,
  reserveLoginChallengeAttempt,
  type LoginChallengeRow,
} from "../repositories/LoginChallengesRepository.js";
import { findUserById, type UserRow } from "../repositories/UsersRepository.js";
import { requestMeta } from "../utils/requestMeta.js";
import { clearPendingChallengeCookie, issueSession, readPendingChallengeId } from "./SessionService.js";

// Общий результат для обоих способов пройти pending-2FA (TOTP-код и
// recovery-код) - у них один и тот же challenge, одна cookie и один пул
// попыток, различается только сама проверка кода.
export enum ChallengeVerifyResult {
  Ok = "ok",
  NoChallenge = "no_challenge",
  Expired = "expired",
  TooManyAttempts = "too_many_attempts",
  InvalidCode = "invalid_code",
}

interface ChallengeWithUser {
  challenge: LoginChallengeRow;
  user: UserRow;
}

export async function loadChallengeUser(
  challengeId: string,
): Promise<ChallengeWithUser | null> {
  const challenge = await findActiveLoginChallenge(challengeId);
  if (!challenge) return null;

  const user = await findUserById(challenge.user_id);
  if (!user || !user.is_active || !user.totp_enabled || !user.totp_secret_enc) {
    return null;
  }

  return { challenge, user };
}

type ChallengeGate =
  | { ok: true; challenge: LoginChallengeRow; user: UserRow }
  | { ok: false; result: ChallengeVerifyResult };

// Общий вход для verifyTwoFactor/verifyRecoveryCode: поднимает challenge и
// юзера по pending-cookie, атомарно резервирует попытку (см.
// reserveLoginChallengeAttempt - без этого конкурентные запросы могли бы
// обойти MAX_CHALLENGE_ATTEMPTS). Дальше вызывающий сам делает свою
// проверку кода/пароля.
export async function gateLoginChallenge(
  req: Request,
  res: Response,
): Promise<ChallengeGate> {
  const challengeId = readPendingChallengeId(req);
  if (!challengeId) return { ok: false, result: ChallengeVerifyResult.NoChallenge };

  const loaded = await loadChallengeUser(challengeId);
  if (!loaded) {
    clearPendingChallengeCookie(res);
    return { ok: false, result: ChallengeVerifyResult.Expired };
  }

  const reserved = await reserveLoginChallengeAttempt(loaded.challenge.id, MAX_CHALLENGE_ATTEMPTS);
  if (!reserved) {
    await deleteLoginChallenge(loaded.challenge.id);
    clearPendingChallengeCookie(res);
    return { ok: false, result: ChallengeVerifyResult.TooManyAttempts };
  }

  return { ok: true, challenge: loaded.challenge, user: loaded.user };
}

// Успешное прохождение challenge: удаляет его, чистит pending-cookie,
// выдаёт полноценную сессию и пишет аудит-событие.
export async function completeLoginChallenge(
  req: Request,
  res: Response,
  challengeId: string,
  userId: number,
  detail?: Record<string, unknown>,
): Promise<void> {
  await deleteLoginChallenge(challengeId);
  clearPendingChallengeCookie(res);
  await issueSession(req, res, userId);
  await recordAuditEvent({
    userId,
    eventType: AuditEventType.TwoFactorSuccess,
    ...requestMeta(req),
    detail,
  });
}

export async function recordLoginChallengeFailure(
  req: Request,
  userId: number,
  detail?: Record<string, unknown>,
): Promise<void> {
  await recordAuditEvent({
    userId,
    eventType: AuditEventType.TwoFactorFailed,
    ...requestMeta(req),
    detail,
  });
}
