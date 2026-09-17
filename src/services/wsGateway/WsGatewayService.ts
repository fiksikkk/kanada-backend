import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Socket } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
  AuditEventType,
  recordAuditEvent,
} from "../../repositories/AuditLogRepository.js";
import { getScopesForUser } from "../../repositories/UserScopeAccessRepository.js";
import {
  findUserById,
  UserRole,
  type UserRow,
} from "../../repositories/UsersRepository.js";
import { AdminNotificationService } from "../AdminNotificationService.js";
import { BackupService } from "../BackupService.js";
import { resolveSessionFromCookieHeader } from "../SessionService.js";
import { parseClientMessage } from "./clientMessage.js";
import { CommandThrottle } from "./CommandThrottle.js";
import { registerWsDisconnectHandler } from "./connectionRegistry.js";
import { InboundRateLimiter } from "./InboundRateLimiter.js";
import { filterForConnection, isCommandAllowed } from "./scopeFilter.js";
import { UpstreamConnection } from "./UpstreamConnection.js";

const WS_PATH = "/ws";
const DEFAULT_SET_DEVICE_MIN_INTERVAL_MS = 100;
const DEFAULT_INBOUND_RATE_LIMIT = 30;
const DEFAULT_INBOUND_RATE_WINDOW_MS = 1000;
const DEFAULT_BACKUP_RETENTION_DAYS = 30;

export interface WsGatewayDeps {
  recordAuditEvent: typeof recordAuditEvent;
  getScopesForUser: typeof getScopesForUser;
  findUserById: typeof findUserById;
  resolveSessionFromCookieHeader: typeof resolveSessionFromCookieHeader;
  webClientOrigin: string;
  iridiServerUrl: string;
  upstreamReconnectDelayMs?: number;
  setLightMinIntervalMs?: number;
  inboundRateLimit?: number;
  inboundRateWindowMs?: number;
  backupsDir: string;
  backupRetentionDays?: number;
}

// allowedScopes === null значит "без ограничений" - реально ограничен
// набором scope_id только user со scope_restricted = true.
interface BrowserConnection {
  ws: WebSocket;
  user: UserRow;
  allowedScopes: Set<string> | null;
  rateLimiter: InboundRateLimiter;
}

function rejectUpgrade(
  socket: Socket,
  statusLine: string,
  body?: string,
): void {
  if (body) {
    socket.end(
      `HTTP/1.1 ${statusLine}\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
    return;
  }
  socket.end(`HTTP/1.1 ${statusLine}\r\n\r\n`);
}

function normalizeUserAgent(
  value: string | string[] | undefined,
): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export class WsGatewayService {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly browserConnections = new Set<BrowserConnection>();
  private readonly upstream: UpstreamConnection;
  private readonly throttle: CommandThrottle;
  private readonly inboundRateLimit: number;
  private readonly inboundRateWindowMs: number;
  readonly backupService: BackupService;
  readonly adminNotifications: AdminNotificationService;

  constructor(private readonly deps: WsGatewayDeps) {
    this.inboundRateLimit = deps.inboundRateLimit ?? DEFAULT_INBOUND_RATE_LIMIT;
    this.inboundRateWindowMs =
      deps.inboundRateWindowMs ?? DEFAULT_INBOUND_RATE_WINDOW_MS;
    this.upstream = new UpstreamConnection({
      url: deps.iridiServerUrl,
      reconnectDelayMs: deps.upstreamReconnectDelayMs,
      onMessage: (raw) => this.handleUpstreamMessage(raw),
      onStatusChange: (connected) => this.broadcastIridiStatus(connected),
    });
    // push/send замыкаются на this.browserConnections/this.upstream, но
    // вызываются только асинхронно на реальных сообщениях - к тому моменту
    // оба поля уже присвоены (browserConnections - вообще при объявлении).
    this.adminNotifications = new AdminNotificationService({
      push: (raw) => this.broadcastToAdmins(raw),
    });
    this.backupService = new BackupService({
      send: (raw) => this.upstream.send(raw),
      backupsDir: deps.backupsDir,
      retentionDays: deps.backupRetentionDays ?? DEFAULT_BACKUP_RETENTION_DAYS,
      notifyAdmins: (input) => this.adminNotifications.notify(input),
    });
    this.throttle = new CommandThrottle(
      deps.setLightMinIntervalMs ?? DEFAULT_SET_DEVICE_MIN_INTERVAL_MS,
      (raw) => this.upstream.send(raw),
    );
    registerWsDisconnectHandler((userId) => this.disconnectUser(userId));
  }

  // Сообщения протокола бэкапа/restore (BackupService) и ошибок самого
  // Kanada Server (serverError, см. Kanada Server/scripts/Shared/
  // HandleError.js) - служебные между Server и этим процессом, в браузеры
  // транслировать не нужно.
  private handleUpstreamMessage(raw: string): void {
    if (this.backupService.tryHandleUpstreamMessage(raw)) return;
    if (this.tryHandleServerError(raw)) return;
    this.broadcastToBrowsers(raw);
  }

  private tryHandleServerError(raw: string): boolean {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return false;
    }
    if (typeof msg !== "object" || msg === null) return false;
    const record = msg as Record<string, unknown>;
    if (record.type !== "serverError") return false;

    const context = typeof record.context === "string" ? record.context : null;
    const message = typeof record.message === "string" ? record.message : "неизвестная ошибка";
    const severity =
      record.severity === "info" || record.severity === "warning" || record.severity === "error"
        ? record.severity
        : "error";

    this.adminNotifications
      .notify({
        type: "server_error",
        severity,
        title: context ? `${context}: ${message}` : message,
        detail: { message, context, detail: record.detail ?? null },
      })
      .catch((err: unknown) => {
        console.error(`[ws] не удалось создать admin-уведомление из serverError: ${(err as Error).message}`);
      });
    return true;
  }

  private disconnectUser(userId: number): void {
    for (const conn of this.browserConnections) {
      if (conn.user.id === userId) {
        conn.ws.close(4001, "access_updated");
      }
    }
  }

  attach(httpServer: HttpServer): void {
    this.upstream.connect();
    httpServer.on(
      "upgrade",
      (req: IncomingMessage, socket: Socket, head: Buffer) => {
        this.handleUpgrade(req, socket, head).catch(() => {
          socket.destroy();
        });
      },
    );
  }

  private async handleUpgrade(
    req: IncomingMessage,
    socket: Socket,
    head: Buffer,
  ): Promise<void> {
    const url = new URL(req.url ?? "", "http://internal");
    if (url.pathname !== WS_PATH) {
      rejectUpgrade(socket, "404 Not Found");
      return;
    }

    // У WebSocket-апгрейда нет CORS браузера - без явной сверки Origin
    // произвольный сайт мог бы открыть сокет от лица залогиненного
    // пользователя чужими cookie (cross-site WebSocket hijacking).
    if (req.headers.origin !== this.deps.webClientOrigin) {
      console.warn(
        `[ws] отклонён апгрейд: Origin=${req.headers.origin ?? "(не задан)"}, а WEB_CLIENT_ORIGIN=${this.deps.webClientOrigin}`,
      );
      rejectUpgrade(socket, "403 Forbidden", "Origin mismatch");
      return;
    }

    const session = await this.deps.resolveSessionFromCookieHeader(
      req.headers.cookie,
    );
    if (!session) {
      rejectUpgrade(socket, "401 Unauthorized");
      return;
    }

    const user = await this.deps.findUserById(session.user_id);
    if (!user || !user.is_active) {
      rejectUpgrade(socket, "401 Unauthorized");
      return;
    }

    const allowedScopes = user.scope_restricted
      ? new Set(await this.deps.getScopesForUser(user.id))
      : null;

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleConnection(ws, user, allowedScopes, req);
    });
  }

  private handleConnection(
    browserWs: WebSocket,
    user: UserRow,
    allowedScopes: Set<string> | null,
    req: IncomingMessage,
  ): void {
    const ipAddress = req.socket.remoteAddress ?? null;
    const userAgent = normalizeUserAgent(req.headers["user-agent"]);

    const conn: BrowserConnection = {
      ws: browserWs,
      user,
      allowedScopes,
      rateLimiter: new InboundRateLimiter(
        this.inboundRateLimit,
        this.inboundRateWindowMs,
      ),
    };
    this.browserConnections.add(conn);
    console.log(
      `[ws] браузер подключился: user=${user.id} ip=${ipAddress ?? "?"}`,
    );
    browserWs.send(
      JSON.stringify({
        type: "iridiStatus",
        connected: this.upstream.isConnected(),
      }),
    );

    browserWs.on("message", (data) => {
      if (!conn.rateLimiter.allow()) {
        console.warn(
          `[ws] превышен лимит сообщений (user=${user.id}), сообщение отброшено`,
        );
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        console.warn(
          `[ws] невалидный JSON от браузера (user=${user.id}): ${data.toString()}`,
        );
        return;
      }

      const message = parseClientMessage(parsed);
      if (!message) {
        console.warn(
          `[ws] нераспознанное сообщение от браузера (user=${user.id}): ${JSON.stringify(parsed)}`,
        );
        return;
      }

      if (
        !isCommandAllowed(allowedScopes, message, (id) =>
          this.upstream.getRoomForDevice(id),
        )
      ) {
        console.warn(
          `[ws] отклонено вне scope: user=${user.id} (restricted) сообщение=${JSON.stringify(message)}`,
        );
        this.deps
          .recordAuditEvent({
            userId: user.id,
            eventType: AuditEventType.WsScopeDenied,
            ipAddress,
            userAgent,
            detail: message,
          })
          .catch(() => {
            // аудит не должен блокировать обработку сокета
          });
        return;
      }

      const raw = JSON.stringify(message);

      if (message.type === "setDevice") {
        this.deps
          .recordAuditEvent({
            userId: user.id,
            eventType: AuditEventType.WsCommand,
            ipAddress,
            userAgent,
            detail: message,
          })
          .catch(() => {
            // аудит не должен блокировать саму команду
          });

        this.throttle.schedule(`${message.id}:${message.field}`, raw);
        return;
      }

      this.upstream.send(raw);
    });

    browserWs.on("close", () => {
      this.browserConnections.delete(conn);
      console.log(`[ws] браузер отключился: user=${user.id}`);
    });
    browserWs.on("error", (err) => {
      this.browserConnections.delete(conn);
      console.error(
        `[ws] ошибка соединения с браузером (user=${user.id}): ${err.message}`,
      );
    });
  }

  private broadcastToBrowsers(raw: string): void {
    for (const conn of this.browserConnections) {
      if (conn.ws.readyState !== WebSocket.OPEN) continue;
      const payload = filterForConnection(raw, conn.allowedScopes, (id) =>
        this.upstream.getRoomForDevice(id),
      );
      if (payload !== null) conn.ws.send(payload);
    }
  }

  // Отдельно от broadcastToBrowsers/filterForConnection - тот фильтр по
  // комнатам (allowedScopes), а не по роли: даже нескоуп-ограниченный
  // обычный user проходит его как allowedScopes===null. Уведомления - для
  // role=admin вне зависимости от scope.
  private broadcastToAdmins(raw: string): void {
    for (const conn of this.browserConnections) {
      if (conn.ws.readyState !== WebSocket.OPEN) continue;
      if (conn.user.role !== UserRole.Admin) continue;
      conn.ws.send(raw);
    }
  }

  private broadcastIridiStatus(connected: boolean): void {
    this.broadcastToBrowsers(
      JSON.stringify({ type: "iridiStatus", connected }),
    );
  }
}
