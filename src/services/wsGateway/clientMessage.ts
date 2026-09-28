export type SceneDayField =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface SceneUpsertRecord {
  id: string;
  active?: boolean;
  switch?: boolean;
  brightness?: number;
  position?: number;
}

export type ClientMessage =
  | { type: "getDevices" }
  | { type: "getRoomStatus"; room: number }
  | {
      type: "setDevice";
      id: string;
      field: "switch" | "brightness" | "move" | "stop" | "position";
      value: boolean | number;
    }
  | { type: "getScenes" }
  | { type: "getSceneDetail"; number: number }
  | {
      type: "saveScene";
      number: number | null;
      name: string;
      upsert: SceneUpsertRecord[];
      remove: string[];
      // Эхо в ответном sceneDetail - см. HandleWsSaveScene (SceneWsBridge.js)
      clientRequestId?: string;
    }
  | { type: "deleteScene"; number: number }
  | { type: "runScene"; number: number }
  | { type: "getSceneSchedule"; number: number }
  | {
      type: "setSceneSchedule";
      number: number;
      hour: number;
      minute: number;
      days: Partial<Record<SceneDayField, boolean>>;
    };

function parseSceneUpsertRecord(value: unknown): SceneUpsertRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string") return null;

  const upsert: SceneUpsertRecord = { id: record.id };
  if (record.active !== undefined) {
    if (typeof record.active !== "boolean") return null;
    upsert.active = record.active;
  }
  if (record.switch !== undefined) {
    if (typeof record.switch !== "boolean") return null;
    upsert.switch = record.switch;
  }
  if (record.brightness !== undefined) {
    if (typeof record.brightness !== "number") return null;
    upsert.brightness = record.brightness;
  }
  if (record.position !== undefined) {
    if (typeof record.position !== "number") return null;
    upsert.position = record.position;
  }
  return upsert;
}

const SCENE_DAY_FIELDS: SceneDayField[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

function parseSceneDays(
  value: unknown,
): Partial<Record<SceneDayField, boolean>> | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const days: Partial<Record<SceneDayField, boolean>> = {};
  for (const day of SCENE_DAY_FIELDS) {
    if (record[day] === undefined) continue;
    if (typeof record[day] !== "boolean") return null;
    days[day] = record[day] as boolean;
  }
  return days;
}

export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "object" || raw === null) return null;
  const msg = raw as Record<string, unknown>;

  switch (msg.type) {
    case "getDevices":
      return { type: "getDevices" };
    case "getRoomStatus":
      return typeof msg.room === "number"
        ? { type: "getRoomStatus", room: msg.room }
        : null;
    case "setDevice":
      if (
        typeof msg.id === "string" &&
        (msg.field === "switch" ||
          msg.field === "brightness" ||
          msg.field === "move" ||
          msg.field === "stop" ||
          msg.field === "position") &&
        (typeof msg.value === "boolean" || typeof msg.value === "number")
      ) {
        return {
          type: "setDevice",
          id: msg.id,
          field: msg.field,
          value: msg.value,
        };
      }
      return null;
    case "getScenes":
      return { type: "getScenes" };
    case "getSceneDetail":
      return typeof msg.number === "number"
        ? { type: "getSceneDetail", number: msg.number }
        : null;
    case "saveScene": {
      if (
        (msg.number !== null && typeof msg.number !== "number") ||
        typeof msg.name !== "string" ||
        !Array.isArray(msg.upsert) ||
        !Array.isArray(msg.remove) ||
        (msg.clientRequestId !== undefined &&
          (typeof msg.clientRequestId !== "string" ||
            msg.clientRequestId.length > 64))
      ) {
        return null;
      }
      const upsert: SceneUpsertRecord[] = [];
      for (const item of msg.upsert) {
        const parsed = parseSceneUpsertRecord(item);
        if (!parsed) return null;
        upsert.push(parsed);
      }
      const remove: string[] = [];
      for (const id of msg.remove) {
        if (typeof id !== "string") return null;
        remove.push(id);
      }
      return {
        type: "saveScene",
        number: (msg.number as number | null) ?? null,
        name: msg.name,
        upsert,
        remove,
        ...(typeof msg.clientRequestId === "string"
          ? { clientRequestId: msg.clientRequestId }
          : {}),
      };
    }
    case "deleteScene":
      return typeof msg.number === "number"
        ? { type: "deleteScene", number: msg.number }
        : null;
    case "runScene":
      return typeof msg.number === "number"
        ? { type: "runScene", number: msg.number }
        : null;
    case "getSceneSchedule":
      return typeof msg.number === "number"
        ? { type: "getSceneSchedule", number: msg.number }
        : null;
    case "setSceneSchedule": {
      const days = parseSceneDays(msg.days);
      if (
        typeof msg.number !== "number" ||
        typeof msg.hour !== "number" ||
        typeof msg.minute !== "number" ||
        !days
      ) {
        return null;
      }
      return {
        type: "setSceneSchedule",
        number: msg.number,
        hour: msg.hour,
        minute: msg.minute,
        days,
      };
    }
    default:
      return null;
  }
}
