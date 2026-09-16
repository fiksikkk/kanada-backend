import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { recordAuditEvent } from "./repositories/AuditLogRepository.js";
import { getScopesForUser } from "./repositories/UserScopeAccessRepository.js";
import { findUserById } from "./repositories/UsersRepository.js";
import { resolveSessionFromCookieHeader } from "./services/SessionService.js";
import { WsGatewayService } from "./services/wsGateway/WsGatewayService.js";

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`kanada-auth-gateway listening on :${env.port}`);
});

const wsGateway = new WsGatewayService({
  recordAuditEvent,
  getScopesForUser,
  findUserById,
  resolveSessionFromCookieHeader,
  webClientOrigin: env.webClientOrigin,
  iridiServerUrl: env.iridiServerUrl,
});
wsGateway.attach(server);
