import { pool, withTransaction } from "../db/pool.js";

export interface TotpRecoveryCodeRow {
  id: number;
  user_id: number;
  code_hash: string;
  used_at: Date | null;
  created_at: Date;
}

export async function insertRecoveryCodeHashes(
  userId: number,
  codeHashes: string[],
): Promise<void> {
  await withTransaction(async (client) => {
    for (const hash of codeHashes) {
      await client.query(
        "INSERT INTO auth.totp_recovery_codes (user_id, code_hash) VALUES ($1, $2)",
        [userId, hash],
      );
    }
  });
}

export async function findUnusedRecoveryCodes(
  userId: number,
): Promise<TotpRecoveryCodeRow[]> {
  const { rows } = await pool.query<TotpRecoveryCodeRow>(
    "SELECT * FROM auth.totp_recovery_codes WHERE user_id = $1 AND used_at IS NULL",
    [userId],
  );
  return rows;
}

export async function markRecoveryCodeUsed(id: number): Promise<void> {
  await pool.query(
    "UPDATE auth.totp_recovery_codes SET used_at = now() WHERE id = $1",
    [id],
  );
}

export async function deleteRecoveryCodesForUser(userId: number): Promise<void> {
  await pool.query("DELETE FROM auth.totp_recovery_codes WHERE user_id = $1", [
    userId,
  ]);
}
