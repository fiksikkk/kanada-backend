import { pool } from "../db/pool.js";

export interface LoginChallengeRow {
  id: string;
  user_id: number;
  attempts: number;
  expires_at: Date;
  created_at: Date;
}

const CHALLENGE_TTL_MINUTES = 5;
export const MAX_CHALLENGE_ATTEMPTS = 5;

export async function createLoginChallenge(
  userId: number,
): Promise<LoginChallengeRow> {
  const { rows } = await pool.query<LoginChallengeRow>(
    `INSERT INTO auth.login_challenges (user_id, expires_at)
     VALUES ($1, now() + ($2 || ' minutes')::interval)
     RETURNING *`,
    [userId, CHALLENGE_TTL_MINUTES],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to insert login challenge");
  }
  return row;
}

export async function findActiveLoginChallenge(
  id: string,
): Promise<LoginChallengeRow | null> {
  const { rows } = await pool.query<LoginChallengeRow>(
    "SELECT * FROM auth.login_challenges WHERE id = $1 AND expires_at > now()",
    [id],
  );
  return rows[0] ?? null;
}

export async function reserveLoginChallengeAttempt(
  id: string,
  maxAttempts: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    "UPDATE auth.login_challenges SET attempts = attempts + 1 WHERE id = $1 AND attempts < $2",
    [id, maxAttempts],
  );
  return (rowCount ?? 0) > 0;
}

export async function deleteLoginChallenge(id: string): Promise<void> {
  await pool.query("DELETE FROM auth.login_challenges WHERE id = $1", [id]);
}
