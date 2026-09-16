import { pool } from "../db/pool.js";

export interface SessionRow {
  id: string;
  user_id: number;
  token_hash: string;
  csrf_secret: string;
  ip_address: string | null;
  user_agent: string | null;
  expires_at: Date;
  created_at: Date;
  last_seen_at: Date;
  revoked_at: Date | null;
}

export interface CreateSessionInput {
  userId: number;
  tokenHash: string;
  csrfSecret: string;
  ipAddress: string | null;
  userAgent: string | null;
  expiresAt: Date;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<SessionRow> {
  const { rows } = await pool.query<SessionRow>(
    `INSERT INTO auth.sessions (user_id, token_hash, csrf_secret, ip_address, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.userId,
      input.tokenHash,
      input.csrfSecret,
      input.ipAddress,
      input.userAgent,
      input.expiresAt,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to insert session");
  }
  return row;
}

export async function findActiveSessionByTokenHash(
  tokenHash: string,
): Promise<SessionRow | null> {
  const { rows } = await pool.query<SessionRow>(
    `SELECT * FROM auth.sessions
     WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`,
    [tokenHash],
  );
  return rows[0] ?? null;
}

export async function touchSession(id: string): Promise<void> {
  await pool.query(
    "UPDATE auth.sessions SET last_seen_at = now() WHERE id = $1",
    [id],
  );
}

export async function revokeSessionByTokenHash(
  tokenHash: string,
): Promise<void> {
  await pool.query(
    "UPDATE auth.sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [tokenHash],
  );
}

export async function revokeAllSessionsForUser(userId: number): Promise<void> {
  await pool.query(
    "UPDATE auth.sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL",
    [userId],
  );
}
