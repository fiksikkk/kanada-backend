interface ThrottleState {
  timer: ReturnType<typeof setTimeout> | null;
  pendingRaw: string | null;
  lastSentAt: number;
}

// Trailing-throttle с коалесингом (не отбрасыванием) - слайдер яркости
// шлёт setDevice на каждый onChange без собственного троттлинга, и нам
// нужно не потерять финальное значение. Ключуется по deviceId+field, а не
// по соединению - апстрим общий на все браузеры.
export class CommandThrottle {
  private readonly state = new Map<string, ThrottleState>();

  constructor(
    private readonly minIntervalMs: number,
    private readonly send: (raw: string) => void,
  ) {}

  schedule(key: string, raw: string): void {
    let state = this.state.get(key);
    if (!state) {
      state = { timer: null, pendingRaw: null, lastSentAt: -Infinity };
      this.state.set(key, state);
    }

    const elapsed = Date.now() - state.lastSentAt;
    if (elapsed >= this.minIntervalMs) {
      this.flush(state, raw);
      return;
    }

    state.pendingRaw = raw;
    if (!state.timer) {
      state.timer = setTimeout(() => {
        state.timer = null;
        const toSend = state.pendingRaw;
        if (toSend) this.flush(state, toSend);
      }, this.minIntervalMs - elapsed);
    }
  }

  private flush(state: ThrottleState, raw: string): void {
    state.lastSentAt = Date.now();
    state.pendingRaw = null;
    this.send(raw);
  }
}
