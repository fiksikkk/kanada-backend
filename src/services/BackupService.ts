import { promises as fs } from "node:fs";
import path from "node:path";

// Протокол см. Kanada Server/scripts/DB/DbBackupRestore.js - зеркальная
// реализация на стороне Node. Порядок таблиц здесь значения не имеет (Server
// сам копит их в объект по имени), но список должен совпадать с
// BACKUP_TABLES там же.
const BACKUP_TABLES = [
  "rooms",
  "room_sections",
  "knx_routers",
  "knx_devices",
  "knx_scene_values",
  "scene_schedules",
] as const;

type BackupTable = (typeof BACKUP_TABLES)[number];

interface BackupFileContents {
  createdAt: string;
  trigger: "daily" | "manual";
  tables: Partial<Record<BackupTable, unknown[]>>;
}

export interface BackupListEntry {
  file: string;
  createdAt: string;
  sizeBytes: number;
}

export interface BackupServiceDeps {
  send: (raw: string) => void;
  backupsDir: string;
  retentionDays: number;
  requestTimeoutMs?: number;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
const FILE_NAME_RE = /^kanada-\d{8}-\d{6}\.json$/;

interface PendingBackup {
  trigger: "daily" | "manual";
  requestId: string | null;
  tables: Partial<Record<BackupTable, unknown[]>>;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isBackupTable(value: unknown): value is BackupTable {
  return typeof value === "string" && (BACKUP_TABLES as readonly string[]).includes(value);
}

// Принимает JSON-дамп таблиц Kanada Server по WS (см. DbBackupRestore.js) и
// хранит его версионированными файлами на диске; умеет гонять его же
// восстановление обратно на Server. Живёт внутри WsGatewayService - "send"
// это его апстрим-соединение к iRidium Server.
export class BackupService {
  private readonly pendingBackups = new Map<string, PendingBackup>();
  private readonly pendingManualBackups = new Map<string, PendingRequest>();
  private readonly pendingRestores = new Map<string, PendingRequest>();
  private readonly requestTimeoutMs: number;

  constructor(private readonly deps: BackupServiceDeps) {
    this.requestTimeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  // true, если сообщение от апстрима - часть протокола бэкапа/restore и уже
  // обработано здесь (WsGatewayService не должен транслировать его в браузеры).
  tryHandleUpstreamMessage(raw: string): boolean {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return false;
    }
    if (typeof msg !== "object" || msg === null) return false;
    const record = msg as Record<string, unknown>;

    switch (record.type) {
      case "dbBackupBegin":
        this.handleBackupBegin(record);
        return true;
      case "dbBackupTable":
        this.handleBackupTable(record);
        return true;
      case "dbBackupEnd":
        this.handleBackupEnd(record).catch((err: unknown) => {
          console.error(`[backup] ошибка обработки dbBackupEnd: ${(err as Error).message}`);
        });
        return true;
      case "dbRestoreResult":
        this.handleRestoreResult(record);
        return true;
      default:
        return false;
    }
  }

  private handleBackupBegin(msg: Record<string, unknown>): void {
    this.pendingBackups.set(String(msg.backupId), {
      trigger: msg.trigger === "manual" ? "manual" : "daily",
      requestId: typeof msg.requestId === "string" ? msg.requestId : null,
      tables: {},
    });
  }

  private handleBackupTable(msg: Record<string, unknown>): void {
    const pending = this.pendingBackups.get(String(msg.backupId));
    if (!pending || !isBackupTable(msg.table)) return;
    pending.tables[msg.table] = Array.isArray(msg.rows) ? msg.rows : [];
  }

  private async handleBackupEnd(msg: Record<string, unknown>): Promise<void> {
    const backupId = String(msg.backupId);
    const pending = this.pendingBackups.get(backupId);
    this.pendingBackups.delete(backupId);
    if (!pending) return;

    try {
      const file = await this.writeBackupFile(pending);
      this.deps.send(JSON.stringify({ type: "dbBackupAck", backupId, success: true }));
      await this.pruneOldBackups();
      if (pending.requestId) {
        this.resolvePending(this.pendingManualBackups, pending.requestId, { file });
      }
    } catch (err) {
      const error = (err as Error).message;
      this.deps.send(JSON.stringify({ type: "dbBackupAck", backupId, success: false, error }));
      if (pending.requestId) {
        this.rejectPending(this.pendingManualBackups, pending.requestId, new Error(error));
      }
    }
  }

  private async writeBackupFile(pending: PendingBackup): Promise<string> {
    await fs.mkdir(this.deps.backupsDir, { recursive: true });
    const createdAt = new Date();
    const stamp = createdAt
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\..+/, "")
      .replace("T", "-");
    const file = `kanada-${stamp}.json`;
    const payload: BackupFileContents = {
      createdAt: createdAt.toISOString(),
      trigger: pending.trigger,
      tables: pending.tables,
    };
    await fs.writeFile(
      path.join(this.deps.backupsDir, file),
      JSON.stringify(payload, null, 2),
      "utf8",
    );
    return file;
  }

  private async pruneOldBackups(): Promise<void> {
    const entries = await this.listBackups();
    const cutoff = Date.now() - this.deps.retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of entries) {
      if (new Date(entry.createdAt).getTime() < cutoff) {
        await fs.rm(path.join(this.deps.backupsDir, entry.file)).catch(() => {});
      }
    }
  }

  async listBackups(): Promise<BackupListEntry[]> {
    await fs.mkdir(this.deps.backupsDir, { recursive: true });
    const files = (await fs.readdir(this.deps.backupsDir)).filter((f) => f.endsWith(".json"));

    const entries: BackupListEntry[] = [];
    for (const file of files) {
      const full = path.join(this.deps.backupsDir, file);
      const stat = await fs.stat(full);
      let createdAt = stat.mtime.toISOString();
      try {
        const parsed = JSON.parse(await fs.readFile(full, "utf8")) as BackupFileContents;
        if (typeof parsed.createdAt === "string") createdAt = parsed.createdAt;
      } catch {
        // повреждённый/чужой файл - всё равно покажем по mtime, не прячем
      }
      entries.push({ file, createdAt, sizeBytes: stat.size });
    }

    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return entries;
  }

  triggerManualBackup(): Promise<{ file: string }> {
    const requestId = this.generateRequestId();
    return this.registerPending<{ file: string }>(this.pendingManualBackups, requestId, () => {
      this.deps.send(JSON.stringify({ type: "backupNow", requestId }));
    });
  }

  async restoreFromFile(file: string): Promise<void> {
    const safeName = this.sanitizeFileName(file);
    const raw = await fs.readFile(path.join(this.deps.backupsDir, safeName), "utf8");
    const parsed = JSON.parse(raw) as BackupFileContents;

    const requestId = this.generateRequestId();
    await this.registerPending<void>(this.pendingRestores, requestId, () => {
      this.deps.send(JSON.stringify({ type: "dbRestoreBegin", requestId }));
      for (const table of BACKUP_TABLES) {
        this.deps.send(
          JSON.stringify({
            type: "dbRestoreTable",
            requestId,
            table,
            rows: parsed.tables[table] ?? [],
          }),
        );
      }
      this.deps.send(JSON.stringify({ type: "dbRestoreEnd", requestId }));
    });
  }

  private handleRestoreResult(msg: Record<string, unknown>): void {
    const requestId = String(msg.requestId);
    if (msg.success) {
      this.resolvePending(this.pendingRestores, requestId, undefined);
    } else {
      this.rejectPending(
        this.pendingRestores,
        requestId,
        new Error(typeof msg.error === "string" ? msg.error : "restore_failed"),
      );
    }
  }

  private sanitizeFileName(file: string): string {
    const base = path.basename(file);
    if (!FILE_NAME_RE.test(base)) {
      throw new Error("invalid_backup_file_name");
    }
    return base;
  }

  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private registerPending<T>(
    map: Map<string, PendingRequest>,
    requestId: string,
    send: () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        map.delete(requestId);
        reject(new Error("timeout"));
      }, this.requestTimeoutMs);
      map.set(requestId, { resolve: resolve as (value: unknown) => void, reject, timer });
      send();
    });
  }

  private resolvePending(map: Map<string, PendingRequest>, requestId: string, value: unknown): void {
    const pending = map.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    map.delete(requestId);
    pending.resolve(value);
  }

  private rejectPending(map: Map<string, PendingRequest>, requestId: string, err: Error): void {
    const pending = map.get(requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    map.delete(requestId);
    pending.reject(err);
  }
}
