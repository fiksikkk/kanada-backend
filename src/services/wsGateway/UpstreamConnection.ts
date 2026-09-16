import { WebSocket } from "ws";

export interface UpstreamConnectionDeps {
  url: string;
  reconnectDelayMs?: number;
  onMessage: (raw: string) => void;
  onStatusChange: (connected: boolean) => void;
}

const DEFAULT_RECONNECT_DELAY_MS = 3000;

// Апстрим к iRidium - одно общее соединение на весь процесс: серверный
// WsGatewayBridge.js держит MaxClients:1, поэтому N браузерных сокетов
// мультиплексируются здесь поверх одного always-on соединения.
export class UpstreamConnection {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;
  private readonly pendingOutgoing: string[] = [];
  private readonly deviceRoomById = new Map<string, number>();
  private readonly reconnectDelayMs: number;

  constructor(private readonly deps: UpstreamConnectionDeps) {
    this.reconnectDelayMs = deps.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  }

  connect(): void {
    console.log(`[ws-upstream] подключаюсь к ${this.deps.url}...`);
    const socket = new WebSocket(this.deps.url);
    this.socket = socket;

    socket.on("open", () => {
      console.log(`[ws-upstream] подключено (${this.deps.url})`);
      this.connected = true;
      this.deps.onStatusChange(true);
      for (const raw of this.pendingOutgoing.splice(0)) {
        socket.send(raw);
      }
    });

    socket.on("message", (data) => {
      const raw = data.toString();
      this.updateDeviceCache(raw);
      this.deps.onMessage(raw);
    });

    socket.on("close", (code, reason) => {
      console.warn(
        `[ws-upstream] соединение закрыто (code=${code}${reason.length ? `, reason=${reason.toString()}` : ""}), реконнект через ${this.reconnectDelayMs}мс`,
      );
      this.connected = false;
      this.deps.onStatusChange(false);
      this.scheduleReconnect();
    });

    // "close" всегда следует за "error" - реконнект планируется только там,
    // иначе можно случайно завести два параллельных upstream-сокета.
    socket.on("error", (err) => {
      console.error(`[ws-upstream] ошибка соединения с ${this.deps.url}: ${err.message}`);
      socket.close();
    });
  }

  send(raw: string): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      console.log(`[ws-upstream] -> ${raw}`);
      this.socket.send(raw);
    } else {
      console.warn(`[ws-upstream] апстрим не открыт, ставлю в очередь: ${raw}`);
      this.pendingOutgoing.push(raw);
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  // id устройства -> его комната, из последнего "devices" от апстрима -
  // нужно, т.к. setDevice/liveStatusPush несут только id устройства.
  getRoomForDevice(deviceId: string): number | undefined {
    return this.deviceRoomById.get(deviceId);
  }

  private scheduleReconnect(): void {
    this.socket = null;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  private updateDeviceCache(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== "object" || msg === null) return;
    const record = msg as Record<string, unknown>;
    if (record.type !== "devices" || !Array.isArray(record.devices)) return;

    this.deviceRoomById.clear();
    for (const device of record.devices) {
      if (
        typeof device === "object" &&
        device !== null &&
        typeof (device as Record<string, unknown>).id === "string" &&
        typeof (device as Record<string, unknown>).roomN === "number"
      ) {
        this.deviceRoomById.set(
          (device as Record<string, unknown>).id as string,
          (device as Record<string, unknown>).roomN as number,
        );
      }
    }
  }
}
