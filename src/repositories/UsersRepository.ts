import { pool } from "../db/pool.js";

export enum UserRole {
  Admin = "admin",
  User = "user",
}

export interface UserRow {
  id: number;
  username: string;
  display_name: string | null;
  password_hash: string;
  role: UserRole;
  totp_secret_enc: string | null;
  totp_enabled: boolean;
  totp_confirmed_at: Date | null;
  failed_login_attempts: number;
  locked_until: Date | null;
  is_active: boolean;
  scope_restricted: boolean;
  created_at: Date;
  updated_at: Date;
}

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function findUserByUsername(
  username: string,
): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    "SELECT * FROM auth.users WHERE username = $1",
    [username],
  );
  return rows[0] ?? null;
}

export async function findUserById(id: number): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    "SELECT * FROM auth.users WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

export async function listUsers(): Promise<UserRow[]> {
  const { rows } = await pool.query<UserRow>(
    "SELECT * FROM auth.users ORDER BY username",
  );
  return rows;
}

export async function createUser(
  username: string,
  passwordHash: string,
  role: UserRole = UserRole.User,
): Promise<UserRow> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO auth.users (username, password_hash, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [username, passwordHash, role],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to insert user");
  }
  return row;
}

export async function updateUserRoleAndActive(
  userId: number,
  role: UserRole,
  isActive: boolean,
  scopeRestricted: boolean,
): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(
    `UPDATE auth.users
     SET role = $2, is_active = $3, scope_restricted = $4, updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [userId, role, isActive, scopeRestricted],
  );
  return rows[0] ?? null;
}

export async function deleteUser(userId: number): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM auth.users WHERE id = $1", [
    userId,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function countAdmins(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM auth.users WHERE role = 'admin' AND is_active = true",
  );
  return Number(rows[0]?.count ?? 0);
}

export async function registerFailedLogin(userId: number): Promise<void> {
  await pool.query(
    `UPDATE auth.users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $2
             THEN now() + ($3 || ' minutes')::interval
           ELSE locked_until
         END,
         updated_at = now()
     WHERE id = $1`,
    [userId, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES],
  );
}

export async function resetFailedLogins(userId: number): Promise<void> {
  await pool.query(
    `UPDATE auth.users
     SET failed_login_attempts = 0, locked_until = NULL, updated_at = now()
     WHERE id = $1`,
    [userId],
  );
}

export function isLocked(user: UserRow): boolean {
  return user.locked_until !== null && user.locked_until.getTime() > Date.now();
}

export async function setPendingTotpSecret(
  userId: number,
  encryptedSecret: string,
): Promise<void> {
  await pool.query(
    "UPDATE auth.users SET totp_secret_enc = $2, updated_at = now() WHERE id = $1",
    [userId, encryptedSecret],
  );
}

export async function confirmTotpEnabled(userId: number): Promise<void> {
  await pool.query(
    `UPDATE auth.users
     SET totp_enabled = true, totp_confirmed_at = now(), updated_at = now()
     WHERE id = $1`,
    [userId],
  );
}

export async function resetTotp(userId: number): Promise<void> {
  await pool.query(
    `UPDATE auth.users
     SET totp_secret_enc = NULL, totp_enabled = false, totp_confirmed_at = NULL, updated_at = now()
     WHERE id = $1`,
    [userId],
  );
}
