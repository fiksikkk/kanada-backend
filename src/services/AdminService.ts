import type { Request } from "express";
import { AuditEventType, recordAuditEvent } from "../repositories/AuditLogRepository.js";
import { revokeAllSessionsForUser } from "../repositories/SessionsRepository.js";
import { deleteRecoveryCodesForUser } from "../repositories/TotpRecoveryCodesRepository.js";
import {
  getScopesForUser,
  replaceScopesForUser,
} from "../repositories/UserScopeAccessRepository.js";
import { disconnectUserWsConnections } from "./wsGateway/connectionRegistry.js";
import {
  countAdmins,
  createUser,
  deleteUser,
  findUserById,
  findUserByUsername,
  listUsers,
  resetTotp,
  updateUserRoleAndActive,
  UserRole,
  type UserRow,
} from "../repositories/UsersRepository.js";
import { hashPassword } from "../utils/hash.js";
import { requestMeta } from "../utils/requestMeta.js";

// Все admin_* аудит-события несут одинаковый "кто это сделал" в detail -
// вынесено, чтобы не повторять merge ipAddress/userAgent/adminId в каждой
// функции ниже по отдельности.
async function recordAdminAuditEvent(
  req: Request,
  admin: UserRow,
  eventType: AuditEventType,
  userId: number | null,
  detail?: Record<string, unknown>,
): Promise<void> {
  await recordAuditEvent({
    userId,
    eventType,
    ...requestMeta(req),
    detail: { adminId: admin.id, adminUsername: admin.username, ...detail },
  });
}

export enum AdminResetTotpResult {
  Ok = "ok",
  NotFound = "not_found",
}

export interface AdminUserSummary {
  id: number;
  username: string;
  displayName: string | null;
  role: UserRow["role"];
  totpEnabled: boolean;
  isActive: boolean;
  scopeRestricted: boolean;
  scopeAccess: string[];
}

export async function listAdminUsers(): Promise<AdminUserSummary[]> {
  const users = await listUsers();
  const summaries = await Promise.all(
    users.map(async (user) => ({
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      totpEnabled: user.totp_enabled,
      isActive: user.is_active,
      scopeRestricted: user.scope_restricted,
      scopeAccess: user.scope_restricted ? await getScopesForUser(user.id) : [],
    })),
  );
  return summaries;
}

const MIN_PASSWORD_LENGTH = 12;

export enum AdminCreateUserOutcome {
  Ok = "ok",
  UsernameTaken = "username_taken",
  WeakPassword = "weak_password",
}

export type AdminCreateUserResult =
  | { outcome: AdminCreateUserOutcome.Ok; user: AdminUserSummary }
  | { outcome: AdminCreateUserOutcome.UsernameTaken }
  | { outcome: AdminCreateUserOutcome.WeakPassword };

export async function createAdminUser(
  req: Request,
  admin: UserRow,
  input: { username: string; password: string; role: UserRole },
): Promise<AdminCreateUserResult> {
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    return { outcome: AdminCreateUserOutcome.WeakPassword };
  }
  if (await findUserByUsername(input.username)) {
    return { outcome: AdminCreateUserOutcome.UsernameTaken };
  }

  const passwordHash = await hashPassword(input.password);
  const user = await createUser(input.username, passwordHash, input.role);

  await recordAdminAuditEvent(req, admin, AuditEventType.AdminUserCreate, user.id, {
    role: user.role,
  });

  return {
    outcome: AdminCreateUserOutcome.Ok,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
      totpEnabled: user.totp_enabled,
      isActive: user.is_active,
      scopeRestricted: user.scope_restricted,
      scopeAccess: [],
    },
  };
}

export enum AdminMutationResult {
  Ok = "ok",
  NotFound = "not_found",
  LastAdmin = "last_admin",
}

export enum AdminUpdateRoleResult {
  Ok = "ok",
  NotFound = "not_found",
  LastAdmin = "last_admin",
  SelfModificationForbidden = "self_modification_forbidden",
}

export async function updateAdminUserRole(
  req: Request,
  admin: UserRow,
  targetUserId: number,
  role: UserRole,
  isActive: boolean,
  scopeRestricted: boolean,
): Promise<AdminUpdateRoleResult> {
  if (targetUserId === admin.id && (role !== UserRole.Admin || !isActive)) {
    return AdminUpdateRoleResult.SelfModificationForbidden;
  }

  const target = await findUserById(targetUserId);
  if (!target) {
    return AdminUpdateRoleResult.NotFound;
  }

  const demotingOrDeactivatingLastAdmin =
    target.role === UserRole.Admin &&
    target.is_active &&
    (role !== UserRole.Admin || !isActive) &&
    (await countAdmins()) <= 1;
  if (demotingOrDeactivatingLastAdmin) {
    return AdminUpdateRoleResult.LastAdmin;
  }

  // admin всегда full access - ограничение по scope для него не имеет смысла
  const effectiveScopeRestricted = role === UserRole.Admin ? false : scopeRestricted;

  await updateUserRoleAndActive(targetUserId, role, isActive, effectiveScopeRestricted);
  if (!effectiveScopeRestricted) {
    await replaceScopesForUser(targetUserId, []);
  }
  // Чтобы новые role/scope применились сразу, а не при следующем
  // случайном переподключении браузера.
  disconnectUserWsConnections(targetUserId);

  await recordAdminAuditEvent(req, admin, AuditEventType.AdminUserUpdate, targetUserId, {
    role,
    isActive,
    scopeRestricted: effectiveScopeRestricted,
  });

  return AdminUpdateRoleResult.Ok;
}

export async function deleteAdminUser(
  req: Request,
  admin: UserRow,
  targetUserId: number,
): Promise<AdminMutationResult> {
  if (targetUserId === admin.id) {
    return AdminMutationResult.LastAdmin;
  }

  const target = await findUserById(targetUserId);
  if (!target) {
    return AdminMutationResult.NotFound;
  }

  if (target.role === UserRole.Admin && target.is_active && (await countAdmins()) <= 1) {
    return AdminMutationResult.LastAdmin;
  }

  await deleteUser(targetUserId);

  await recordAdminAuditEvent(req, admin, AuditEventType.AdminUserDelete, null, {
    deletedUserId: targetUserId,
    deletedUsername: target.username,
  });

  return AdminMutationResult.Ok;
}

export enum AdminSetScopesResult {
  Ok = "ok",
  NotFound = "not_found",
  NotRestricted = "not_restricted",
}

export async function setAdminUserScopes(
  req: Request,
  admin: UserRow,
  targetUserId: number,
  scopeIds: string[],
): Promise<AdminSetScopesResult> {
  const target = await findUserById(targetUserId);
  if (!target) {
    return AdminSetScopesResult.NotFound;
  }
  if (!target.scope_restricted) {
    return AdminSetScopesResult.NotRestricted;
  }

  const uniqueScopeIds = Array.from(new Set(scopeIds));
  await replaceScopesForUser(targetUserId, uniqueScopeIds);
  disconnectUserWsConnections(targetUserId);

  await recordAdminAuditEvent(req, admin, AuditEventType.AdminScopeAccessUpdate, targetUserId, {
    scopeIds: uniqueScopeIds,
  });

  return AdminSetScopesResult.Ok;
}

// Сброс 2FA снимает всю привязку TOTP у юзера и отзывает его текущие сессии
export async function resetUserTotp(
  req: Request,
  admin: UserRow,
  targetUserId: number,
): Promise<AdminResetTotpResult> {
  const target = await findUserById(targetUserId);
  if (!target) {
    return AdminResetTotpResult.NotFound;
  }

  await resetTotp(target.id);
  await deleteRecoveryCodesForUser(target.id);
  await revokeAllSessionsForUser(target.id);

  await recordAdminAuditEvent(req, admin, AuditEventType.AdminTotpReset, target.id);

  return AdminResetTotpResult.Ok;
}
