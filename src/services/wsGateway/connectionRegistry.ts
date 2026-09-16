type DisconnectUserFn = (userId: number) => void;

let disconnectUserImpl: DisconnectUserFn | null = null;

export function registerWsDisconnectHandler(fn: DisconnectUserFn): void {
  disconnectUserImpl = fn;
}

export function disconnectUserWsConnections(userId: number): void {
  disconnectUserImpl?.(userId);
}
