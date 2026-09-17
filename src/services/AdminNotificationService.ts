import {
  countUnreadNotifications,
  createNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type AdminNotificationRow,
  type CreateNotificationInput,
} from "../repositories/AdminNotificationsRepository.js";

const DEFAULT_LIST_LIMIT = 50;

export interface AdminNotificationServiceDeps {
  // -> WsGatewayService.broadcastToAdmins - шлётся только браузерам с
  // role=admin, не всем подряд.
  push: (raw: string) => void;
}

// Форма на проводе (camelCase) - как AdminUserSummary в AdminService.ts,
// снаружи не должно быть видно snake_case колонок Postgres.
export interface AdminNotificationDto {
  id: number;
  type: string;
  severity: AdminNotificationRow["severity"];
  title: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
  readAt: string | null;
}

function toDto(row: AdminNotificationRow): AdminNotificationDto {
  return {
    id: row.id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    detail: row.detail,
    createdAt: row.created_at.toISOString(),
    readAt: row.read_at ? row.read_at.toISOString() : null,
  };
}

// Персистентный (Postgres) + живой (WS push) канал для "что-то пошло не
// так, админу стоит знать" - изначально для неудачных бэкапов/restore
// (BackupService) и ошибок самого Kanada Server (serverError, см.
// WsGatewayService.handleUpstreamMessage), но не завязан на конкретный тип.
export class AdminNotificationService {
  constructor(private readonly deps: AdminNotificationServiceDeps) {}

  async notify(input: CreateNotificationInput): Promise<AdminNotificationDto> {
    const dto = toDto(await createNotification(input));
    this.deps.push(
      JSON.stringify({ type: "adminNotification", notification: dto }),
    );
    return dto;
  }

  async list(opts: {
    limit?: number;
    before?: number;
  } = {}): Promise<{ notifications: AdminNotificationDto[]; hasMore: boolean }> {
    const limit = opts.limit ?? DEFAULT_LIST_LIMIT;
    // Тянем на одну строку больше лимита - если она пришла, значит за
    // текущей страницей есть ещё записи (без отдельного count-запроса).
    const rows = await listNotifications(limit + 1, opts.before);
    const hasMore = rows.length > limit;
    return { notifications: rows.slice(0, limit).map(toDto), hasMore };
  }

  unreadCount(): Promise<number> {
    return countUnreadNotifications();
  }

  async markRead(id: number): Promise<void> {
    await markNotificationRead(id);
    this.deps.push(JSON.stringify({ type: "adminNotificationRead", id }));
  }

  async markAllRead(): Promise<void> {
    await markAllNotificationsRead();
    this.deps.push(JSON.stringify({ type: "adminNotificationsAllRead" }));
  }
}
