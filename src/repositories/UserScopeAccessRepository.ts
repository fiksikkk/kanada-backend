import { pool, withTransaction } from "../db/pool.js";

export interface UserScopeAccessRow {
  user_id: number;
  scope_id: string;
  granted_at: Date;
}

export async function getScopesForUser(userId: number): Promise<string[]> {
  const { rows } = await pool.query<Pick<UserScopeAccessRow, "scope_id">>(
    "SELECT scope_id FROM auth.user_scope_access WHERE user_id = $1 ORDER BY scope_id",
    [userId],
  );
  return rows.map((row) => row.scope_id);
}

// Заменяет весь набор разрешённых scope_id одним махом (не diff) - админ
// всегда присылает полный итоговый список из формы, а не отдельные
// add/remove.
export async function replaceScopesForUser(
  userId: number,
  scopeIds: string[],
): Promise<void> {
  await withTransaction(async (client) => {
    await client.query("DELETE FROM auth.user_scope_access WHERE user_id = $1", [
      userId,
    ]);
    for (const scopeId of scopeIds) {
      await client.query(
        "INSERT INTO auth.user_scope_access (user_id, scope_id) VALUES ($1, $2)",
        [userId, scopeId],
      );
    }
  });
}
