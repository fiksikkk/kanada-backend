import type { Request, Response } from "express";
import {
  findUnusedRecoveryCodes,
  markRecoveryCodeUsed,
} from "../repositories/TotpRecoveryCodesRepository.js";
import { verifyPassword } from "../utils/hash.js";
import {
  ChallengeVerifyResult,
  completeLoginChallenge,
  gateLoginChallenge,
  recordLoginChallengeFailure,
} from "./LoginChallengeGate.js";

export async function verifyRecoveryCode(
  req: Request,
  res: Response,
  code: string,
): Promise<ChallengeVerifyResult> {
  const gate = await gateLoginChallenge(req, res);
  if (!gate.ok) return gate.result;
  const { challenge, user } = gate;

  // Не больше 8 неиспользованных кодов на юзера - последовательная
  // проверка дешевле, чем городить параллелизм.
  const candidates = await findUnusedRecoveryCodes(user.id);
  let matchedId: number | null = null;
  for (const candidate of candidates) {
    if (await verifyPassword(candidate.code_hash, code)) {
      matchedId = candidate.id;
      break;
    }
  }

  if (matchedId === null) {
    await recordLoginChallengeFailure(req, user.id, { via: "recovery_code" });
    return ChallengeVerifyResult.InvalidCode;
  }

  await markRecoveryCodeUsed(matchedId);
  await completeLoginChallenge(req, res, challenge.id, user.id, { via: "recovery_code" });

  return ChallengeVerifyResult.Ok;
}
