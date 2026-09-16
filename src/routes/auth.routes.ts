import { Router, type Request } from "express";
import { findUserById } from "../repositories/UsersRepository.js";
import { LoginResult, login } from "../services/LoginService.js";
import { ChallengeVerifyResult } from "../services/LoginChallengeGate.js";
import { verifyRecoveryCode } from "../services/RecoveryCodeService.js";
import {
  ConfirmTotpOutcome,
  beginTotpSetup,
  confirmTotpSetup,
  verifyTwoFactor,
} from "../services/TwoFactorAuthService.js";
import { destroySession, resolveSession } from "../services/SessionService.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireCsrf } from "../middleware/csrf.js";
import { loginRateLimiter, twoFactorRateLimiter } from "../middleware/rateLimiter.js";

export const authRouter = Router();

authRouter.post("/login", loginRateLimiter, async (req, res) => {
  const { username, password } = req.body as {
    username?: unknown;
    password?: unknown;
  };

  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await login(req, res, username, password);

  switch (result) {
    case LoginResult.Ok:
      res.json({ authenticated: true, requires2fa: false });
      return;
    case LoginResult.Requires2fa:
      res.json({ authenticated: false, requires2fa: true });
      return;
    case LoginResult.Locked:
      res.status(423).json({ error: "account_locked" });
      return;
    case LoginResult.Inactive:
      res.status(403).json({ error: "account_inactive" });
      return;
    case LoginResult.InvalidCredentials:
      res.status(401).json({ error: "invalid_credentials" });
      return;
  }
});

function readCode(req: Request): string | null {
  const { code } = req.body as { code?: unknown };
  return typeof code === "string" ? code : null;
}

authRouter.post("/2fa/verify", twoFactorRateLimiter, async (req, res) => {
  const code = readCode(req);
  if (!code) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await verifyTwoFactor(req, res, code);
  switch (result) {
    case ChallengeVerifyResult.Ok:
      res.json({ authenticated: true });
      return;
    case ChallengeVerifyResult.NoChallenge:
    case ChallengeVerifyResult.Expired:
      res.status(401).json({ error: "challenge_expired" });
      return;
    case ChallengeVerifyResult.TooManyAttempts:
      res.status(429).json({ error: "too_many_attempts" });
      return;
    case ChallengeVerifyResult.InvalidCode:
      res.status(401).json({ error: "invalid_code" });
      return;
  }
});

authRouter.post("/2fa/recovery", twoFactorRateLimiter, async (req, res) => {
  const code = readCode(req);
  if (!code) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await verifyRecoveryCode(req, res, code);
  switch (result) {
    case ChallengeVerifyResult.Ok:
      res.json({ authenticated: true });
      return;
    case ChallengeVerifyResult.NoChallenge:
    case ChallengeVerifyResult.Expired:
      res.status(401).json({ error: "challenge_expired" });
      return;
    case ChallengeVerifyResult.TooManyAttempts:
      res.status(429).json({ error: "too_many_attempts" });
      return;
    case ChallengeVerifyResult.InvalidCode:
      res.status(401).json({ error: "invalid_code" });
      return;
  }
});

authRouter.post("/2fa/setup", requireAuth, requireCsrf, async (req, res) => {
  if (req.user!.totp_enabled) {
    res.status(409).json({ error: "2fa_already_enabled" });
    return;
  }

  const setup = await beginTotpSetup(req.user!);
  res.json(setup);
});

authRouter.post("/2fa/confirm", requireAuth, requireCsrf, async (req, res) => {
  const code = readCode(req);
  if (!code) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await confirmTotpSetup(req.user!, code);
  switch (result.outcome) {
    case ConfirmTotpOutcome.Ok:
      res.json({ enabled: true, recoveryCodes: result.recoveryCodes });
      return;
    case ConfirmTotpOutcome.AlreadyEnabled:
      res.status(409).json({ error: "2fa_already_enabled" });
      return;
    case ConfirmTotpOutcome.NoPendingSecret:
      res.status(409).json({ error: "no_pending_secret" });
      return;
    case ConfirmTotpOutcome.InvalidCode:
      res.status(401).json({ error: "invalid_code" });
      return;
  }
});

authRouter.post("/logout", requireAuth, requireCsrf, async (req, res) => {
  await destroySession(req, res);
  res.json({ authenticated: false });
});

authRouter.get("/session", async (req, res) => {
  const session = await resolveSession(req);
  if (!session) {
    res.json({ authenticated: false });
    return;
  }

  const user = await findUserById(session.user_id);
  if (!user || !user.is_active) {
    res.json({ authenticated: false });
    return;
  }

  res.json({
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      totpEnabled: user.totp_enabled,
    },
  });
});
