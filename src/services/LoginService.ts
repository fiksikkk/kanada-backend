import type { Request, Response } from "express";
import { AuditEventType, recordAuditEvent } from "../repositories/AuditLogRepository.js";
import { createLoginChallenge } from "../repositories/LoginChallengesRepository.js";
import {
  findUserByUsername,
  isLocked,
  registerFailedLogin,
  resetFailedLogins,
} from "../repositories/UsersRepository.js";
import { hashPassword, verifyPassword } from "../utils/hash.js";
import { requestMeta } from "../utils/requestMeta.js";
import { issuePendingChallengeCookie, issueSession } from "./SessionService.js";

// Даже когда юзера с таким username нет, мы всё равно проходим через
// argon2.verify - иначе время ответа выдаёт, существует ли логин, по
// разнице между "быстрым" и "медленным" путём.
const dummyPasswordHashPromise = hashPassword(
  "timing-attack-mitigation-dummy-password",
);

export enum LoginResult {
  Ok = "ok",
  Requires2fa = "requires_2fa",
  InvalidCredentials = "invalid_credentials",
  Locked = "locked",
  Inactive = "inactive",
}

export async function login(
  req: Request,
  res: Response,
  username: string,
  password: string,
): Promise<LoginResult> {
  const { ipAddress, userAgent } = requestMeta(req);

  const user = await findUserByUsername(username);
  if (!user) {
    await verifyPassword(await dummyPasswordHashPromise, password);
    await recordAuditEvent({
      userId: null,
      eventType: AuditEventType.LoginFailed,
      ipAddress,
      userAgent,
      detail: { username },
    });
    return LoginResult.InvalidCredentials;
  }

  if (!user.is_active) {
    return LoginResult.Inactive;
  }

  if (isLocked(user)) {
    await recordAuditEvent({
      userId: user.id,
      eventType: AuditEventType.Lockout,
      ipAddress,
      userAgent,
    });
    return LoginResult.Locked;
  }

  const passwordOk = await verifyPassword(user.password_hash, password);
  if (!passwordOk) {
    await registerFailedLogin(user.id);
    await recordAuditEvent({
      userId: user.id,
      eventType: AuditEventType.LoginFailed,
      ipAddress,
      userAgent,
    });
    return LoginResult.InvalidCredentials;
  }

  await resetFailedLogins(user.id);

  if (user.totp_enabled) {
    const challenge = await createLoginChallenge(user.id);
    issuePendingChallengeCookie(res, challenge.id);
    return LoginResult.Requires2fa;
  }

  await issueSession(req, res, user.id);
  await recordAuditEvent({
    userId: user.id,
    eventType: AuditEventType.LoginSuccess,
    ipAddress,
    userAgent,
  });

  return LoginResult.Ok;
}
