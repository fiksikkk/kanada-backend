export type ClientMessage =
  | { type: "getDevices" }
  | { type: "getRoomStatus"; room: number }
  | {
      type: "setDevice";
      id: string;
      field: "switch" | "brightness" | "move" | "stop" | "position";
      value: boolean | number;
    };

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
    default:
      return null;
  }
}
