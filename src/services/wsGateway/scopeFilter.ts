import type { ClientMessage } from "./clientMessage.js";

type GetRoomForDevice = (deviceId: string) => number | undefined;

// Контракт с админкой (ScopeAccessEditor): scope_id ограниченного
// пользователя сравнивается со String(roomN) устройства/комнаты.
export function isRoomAllowed(
  allowedScopes: Set<string> | null,
  roomN: number,
): boolean {
  return allowedScopes === null || allowedScopes.has(String(roomN));
}

export function filterForConnection(
  raw: string,
  allowedScopes: Set<string> | null,
  getRoomForDevice: GetRoomForDevice,
): string | null {
  if (allowedScopes === null) return raw;

  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return raw;
  }
  if (typeof msg !== "object" || msg === null) return raw;
  const record = msg as Record<string, unknown>;

  switch (record.type) {
    case "devices": {
      const devices = Array.isArray(record.devices) ? record.devices : [];
      const filtered = devices.filter(
        (device) =>
          typeof device === "object" &&
          device !== null &&
          typeof (device as Record<string, unknown>).roomN === "number" &&
          isRoomAllowed(
            allowedScopes,
            (device as Record<string, unknown>).roomN as number,
          ),
      );
      return JSON.stringify({ type: "devices", devices: filtered });
    }
    case "roomStatus": {
      const room = record.room;
      if (typeof room !== "number" || !isRoomAllowed(allowedScopes, room)) {
        return null;
      }
      return raw;
    }
    case "liveStatusPush": {
      const pushRecord = record.record as Record<string, unknown> | undefined;
      const deviceId =
        pushRecord && typeof pushRecord.id === "string"
          ? pushRecord.id
          : null;
      const room = deviceId ? getRoomForDevice(deviceId) : undefined;
      if (room === undefined || !isRoomAllowed(allowedScopes, room)) {
        return null;
      }
      return raw;
    }
    case "iridiStatus":
      return raw;
    // Список имён сценариев сам по себе не несёт комнат - фильтровать
    // нечего (в отличие от sceneDetail ниже, где есть devices[].roomN).
    case "scenes":
      return raw;
    case "sceneDetail": {
      const devices = Array.isArray(record.devices) ? record.devices : [];
      const filtered = devices.filter(
        (device) =>
          typeof device === "object" &&
          device !== null &&
          typeof (device as Record<string, unknown>).roomN === "number" &&
          isRoomAllowed(
            allowedScopes,
            (device as Record<string, unknown>).roomN as number,
          ),
      );
      return JSON.stringify({ ...record, devices: filtered });
    }
    // Без per-room данных - пропускаем как есть, как iridiStatus. Без
    // явного case default вернул бы null и молча обрезал бы эти ответы
    // scope-ограниченным пользователям.
    case "sceneDeleted":
    case "sceneSchedule":
      return raw;
    default:
      return null;
  }
}

export function isCommandAllowed(
  allowedScopes: Set<string> | null,
  message: ClientMessage,
  getRoomForDevice: GetRoomForDevice,
): boolean {
  if (allowedScopes === null) return true;

  if (message.type === "getRoomStatus") {
    return isRoomAllowed(allowedScopes, message.room);
  }
  if (message.type === "setDevice") {
    const room = getRoomForDevice(message.id);
    return room !== undefined && isRoomAllowed(allowedScopes, room);
  }
  // saveScene затрагивает только перечисленные устройства - каждое
  // проверяется отдельно, тем же способом, что и setDevice, так что
  // частичное редактирование сценария (только "свои" устройства) разрешено.
  if (message.type === "saveScene") {
    const ids = [
      ...message.upsert.map((item) => item.id),
      ...message.remove,
    ];
    return ids.every((id) => {
      const room = getRoomForDevice(id);
      return room !== undefined && isRoomAllowed(allowedScopes, room);
    });
  }
  // deleteScene/runScene/setSceneSchedule действуют на сценарий целиком
  // (PlayScene применяет ВСЕ активные записи по всем комнатам разом,
  // SceneScheduler делает то же по расписанию) - у backend нет дешёвого
  // способа узнать полный состав сценария по одному только number без
  // отдельного запроса состояния, поэтому для scope-ограниченных
  // пользователей эти команды целиком под запретом (безопасный дефолт),
  // а не частично проверяются, как saveScene. Простой просмотр
  // (getScenes/getSceneDetail/getSceneSchedule) не ограничен - вернёт
  // true ниже, а под-комнатная фильтрация уже сделана в
  // filterForConnection.
  if (
    message.type === "deleteScene" ||
    message.type === "runScene" ||
    message.type === "setSceneSchedule"
  ) {
    return false;
  }
  return true;
}
