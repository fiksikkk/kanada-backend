import type { Request, Response } from "express";
import { insertRecoveryCodeHashes } from "../repositories/TotpRecoveryCodesRepository.js";
import {
  confirmTotpEnabled,
  setPendingTotpSecret,
  type UserRow,
} from "../repositories/UsersRepository.js";
import { decryptSecret, encryptSecret, generateRecoveryCode } from "../utils/crypto.js";
import { hashPassword } from "../utils/hash.js";
import {
  ChallengeVerifyResult,
  completeLoginChallenge,
  gateLoginChallenge,
  recordLoginChallengeFailure,
} from "./LoginChallengeGate.js";
import {
  buildOtpauthUri,
  buildQrCodeDataUrl,
  generateTotpSecret,
  verifyTotpToken,
} from "./TotpService.js";

const RECOVERY_CODE_COUNT = 8;

export async function verifyTwoFactor(
  req: Request,
  res: Response,
  code: string,
): Promise<ChallengeVerifyResult> {
  const gate = await gateLoginChallenge(req, res);
  if (!gate.ok) return gate.result;
  const { challenge, user } = gate;

  const secret = decryptSecret(user.totp_secret_enc as string);
  const ok = await verifyTotpToken(code, secret);

  if (!ok) {
    await recordLoginChallengeFailure(req, user.id);
    return ChallengeVerifyResult.InvalidCode;
  }

  await completeLoginChallenge(req, res, challenge.id, user.id);
  return ChallengeVerifyResult.Ok;
}

export interface TotpSetupResponse {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

export async function beginTotpSetup(
  user: UserRow,
): Promise<TotpSetupResponse> {
  const secret = generateTotpSecret();
  await setPendingTotpSecret(user.id, encryptSecret(secret));

  const otpauthUrl = buildOtpauthUri(user.username, secret);
  const qrCodeDataUrl = await buildQrCodeDataUrl(otpauthUrl);

  return { secret, otpauthUrl, qrCodeDataUrl };
}

export enum ConfirmTotpOutcome {
  Ok = "ok",
  AlreadyEnabled = "already_enabled",
  NoPendingSecret = "no_pending_secret",
  InvalidCode = "invalid_code",
}

export type ConfirmTotpResult =
  | { outcome: ConfirmTotpOutcome.Ok; recoveryCodes: string[] }
  | { outcome: ConfirmTotpOutcome.AlreadyEnabled }
  | { outcome: ConfirmTotpOutcome.NoPendingSecret }
  | { outcome: ConfirmTotpOutcome.InvalidCode };

export async function confirmTotpSetup(
  user: UserRow,
  code: string,
): Promise<ConfirmTotpResult> {
  if (user.totp_enabled) {
    return { outcome: ConfirmTotpOutcome.AlreadyEnabled };
  }

  if (!user.totp_secret_enc) {
    return { outcome: ConfirmTotpOutcome.NoPendingSecret };
  }

  const secret = decryptSecret(user.totp_secret_enc);
  if (!(await verifyTotpToken(code, secret))) {
    return { outcome: ConfirmTotpOutcome.InvalidCode };
  }

  await confirmTotpEnabled(user.id);

  const recoveryCodes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    generateRecoveryCode(),
  );
  const hashes = await Promise.all(recoveryCodes.map((c) => hashPassword(c)));
  await insertRecoveryCodeHashes(user.id, hashes);

  return { outcome: ConfirmTotpOutcome.Ok, recoveryCodes };
}
