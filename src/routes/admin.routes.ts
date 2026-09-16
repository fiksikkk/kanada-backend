import { Router } from "express";
import { requireCsrf } from "../middleware/csrf.js";
import {
  AdminCreateUserOutcome,
  AdminMutationResult,
  AdminResetTotpResult,
  AdminSetScopesResult,
  AdminUpdateRoleResult,
  createAdminUser,
  deleteAdminUser,
  listAdminUsers,
  resetUserTotp,
  setAdminUserScopes,
  updateAdminUserRole,
} from "../services/AdminService.js";
import { UserRole } from "../repositories/UsersRepository.js";

export const adminRouter = Router();

const VALID_ROLES = Object.values(UserRole);

function parseUserId(raw: unknown): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

adminRouter.get("/users", async (req, res) => {
  const users = await listAdminUsers();
  res.json({ users });
});

adminRouter.post("/users", requireCsrf, async (req, res) => {
  const { username, password, role } = req.body ?? {};
  if (
    typeof username !== "string" ||
    !username.trim() ||
    typeof password !== "string" ||
    (role !== undefined && !VALID_ROLES.includes(role))
  ) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await createAdminUser(req, req.user!, {
    username: username.trim(),
    password,
    role: role ?? UserRole.User,
  });
  switch (result.outcome) {
    case AdminCreateUserOutcome.Ok:
      res.status(201).json({ user: result.user });
      return;
    case AdminCreateUserOutcome.UsernameTaken:
      res.status(409).json({ error: "username_taken" });
      return;
    case AdminCreateUserOutcome.WeakPassword:
      res.status(400).json({ error: "weak_password" });
      return;
  }
});

adminRouter.patch("/users/:id", requireCsrf, async (req, res) => {
  const userId = parseUserId(req.params.id);
  const { role, isActive, scopeRestricted } = req.body ?? {};
  if (
    userId === null ||
    !VALID_ROLES.includes(role) ||
    typeof isActive !== "boolean" ||
    typeof scopeRestricted !== "boolean"
  ) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await updateAdminUserRole(
    req,
    req.user!,
    userId,
    role,
    isActive,
    scopeRestricted,
  );
  switch (result) {
    case AdminUpdateRoleResult.Ok:
      res.json({ updated: true });
      return;
    case AdminUpdateRoleResult.NotFound:
      res.status(404).json({ error: "user_not_found" });
      return;
    case AdminUpdateRoleResult.LastAdmin:
      res.status(409).json({ error: "last_admin" });
      return;
    case AdminUpdateRoleResult.SelfModificationForbidden:
      res.status(409).json({ error: "self_modification_forbidden" });
      return;
  }
});

adminRouter.delete("/users/:id", requireCsrf, async (req, res) => {
  const userId = parseUserId(req.params.id);
  if (userId === null) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await deleteAdminUser(req, req.user!, userId);
  switch (result) {
    case AdminMutationResult.Ok:
      res.json({ deleted: true });
      return;
    case AdminMutationResult.NotFound:
      res.status(404).json({ error: "user_not_found" });
      return;
    case AdminMutationResult.LastAdmin:
      res.status(409).json({ error: "last_admin" });
      return;
  }
});

adminRouter.put("/users/:id/scopes", requireCsrf, async (req, res) => {
  const userId = parseUserId(req.params.id);
  const { scopeIds } = req.body ?? {};
  if (
    userId === null ||
    !Array.isArray(scopeIds) ||
    !scopeIds.every((s) => typeof s === "string" && s.length > 0)
  ) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await setAdminUserScopes(req, req.user!, userId, scopeIds);
  switch (result) {
    case AdminSetScopesResult.Ok:
      res.json({ updated: true });
      return;
    case AdminSetScopesResult.NotFound:
      res.status(404).json({ error: "user_not_found" });
      return;
    case AdminSetScopesResult.NotRestricted:
      res.status(409).json({ error: "not_scope_restricted" });
      return;
  }
});

adminRouter.post("/users/:id/2fa/reset", requireCsrf, async (req, res) => {
  const userId = parseUserId(req.params.id);
  if (userId === null) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const result = await resetUserTotp(req, req.user!, userId);
  switch (result) {
    case AdminResetTotpResult.Ok:
      res.json({ reset: true });
      return;
    case AdminResetTotpResult.NotFound:
      res.status(404).json({ error: "user_not_found" });
      return;
  }
});
