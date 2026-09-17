import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { recordAuditEvent } from "./repositories/AuditLogRepository.js";
import { getScopesForUser } from "./repositories/UserScopeAccessRepository.js";
import { findUserById } from "./repositories/UsersRepository.js";
import { resolveSessionFromCookieHeader } from "./services/SessionService.js";
import { WsGatewayService } from "./services/wsGateway/WsGatewayService.js";

const wsGateway = new WsGatewayService({
  recordAuditEvent,
  getScopesForUser,
  findUserById,
  resolveSessionFromCookieHeader,
  webClientOrigin: env.webClientOrigin,
  iridiServerUrl: env.iridiServerUrl,
  backupsDir: env.backupsDir,
  backupRetentionDays: env.backupRetentionDays,
});

const app = createApp({
  backupService: wsGateway.backupService,
  adminNotifications: wsGateway.adminNotifications,
});

const server = app.listen(env.port, () => {
  console.log(`kanada-auth-gateway listening on :${env.port}`);
});

wsGateway.attach(server);
