// Fixed-window лимитер на входящие сообщения одного браузерного
// соединения
export class InboundRateLimiter {
  private windowStart = Date.now();
  private count = 0;

  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs: number,
  ) {}

  allow(): boolean {
    const now = Date.now();
    if (now - this.windowStart >= this.windowMs) {
      this.windowStart = now;
      this.count = 0;
    }

    this.count += 1;
    return this.count <= this.maxPerWindow;
  }
}
