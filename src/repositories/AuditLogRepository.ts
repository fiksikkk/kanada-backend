import { pool } from "../db/pool.js";

export enum AuditEventType {
  LoginSuccess = "login_success",
  LoginFailed = "login_failed",
  Lockout = "lockout",
  Logout = "logout",
  TwoFactorSuccess = "2fa_success",
  TwoFactorFailed = "2fa_failed",
  AdminTotpReset = "admin_2fa_reset",
  AdminUserCreate = "admin_user_create",
  AdminUserUpdate = "admin_user_update",
  AdminUserDelete = "admin_user_delete",
  AdminScopeAccessUpdate = "admin_scope_access_update",
  WsCommand = "ws_command",
  WsScopeDenied = "ws_scope_denied",
}

export interface AuditLogEntry {
  userId: number | null;
  eventType: AuditEventType;
  ipAddress: string | null;
  userAgent: string | null;
  detail?: Record<string, unknown>;
}

export async function recordAuditEvent(entry: AuditLogEntry): Promise<void> {
  await pool.query(
    `INSERT INTO auth.audit_log (user_id, event_type, ip_address, user_agent, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      entry.userId,
      entry.eventType,
      entry.ipAddress,
      entry.userAgent,
      entry.detail ? JSON.stringify(entry.detail) : null,
    ],
  );
}
