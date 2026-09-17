import { pool } from "../db/pool.js";

export type NotificationSeverity = "info" | "warning" | "error";

export interface AdminNotificationRow {
  id: number;
  type: string;
  severity: NotificationSeverity;
  title: string;
  detail: Record<string, unknown> | null;
  created_at: Date;
  read_at: Date | null;
}

export interface CreateNotificationInput {
  type: string;
  severity: NotificationSeverity;
  title: string;
  detail?: Record<string, unknown>;
}

export async function createNotification(
  input: CreateNotificationInput,
): Promise<AdminNotificationRow> {
  const { rows } = await pool.query<AdminNotificationRow>(
    `INSERT INTO auth.admin_notifications (type, severity, title, detail)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      input.type,
      input.severity,
      input.title,
      input.detail ? JSON.stringify(input.detail) : null,
    ],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Failed to insert admin notification");
  }
  return row;
}

export async function listNotifications(
  limit: number,
  beforeId?: number,
): Promise<AdminNotificationRow[]> {
  const { rows } = await pool.query<AdminNotificationRow>(
    beforeId
      ? "SELECT * FROM auth.admin_notifications WHERE id < $1 ORDER BY id DESC LIMIT $2"
      : "SELECT * FROM auth.admin_notifications ORDER BY id DESC LIMIT $1",
    beforeId ? [beforeId, limit] : [limit],
  );
  return rows;
}

export async function countUnreadNotifications(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM auth.admin_notifications WHERE read_at IS NULL",
  );
  return Number(rows[0]?.count ?? 0);
}

export async function markNotificationRead(id: number): Promise<void> {
  await pool.query(
    "UPDATE auth.admin_notifications SET read_at = now() WHERE id = $1 AND read_at IS NULL",
    [id],
  );
}

export async function markAllNotificationsRead(): Promise<void> {
  await pool.query(
    "UPDATE auth.admin_notifications SET read_at = now() WHERE read_at IS NULL",
  );
}
