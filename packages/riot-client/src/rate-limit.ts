type Sleep = (milliseconds: number) => void | Promise<void>;
type Clock = () => number;

type Bucket = { limit: number; windowMs: number; blockedUntil: number };

/** Per-client Riot app/method rate-limit gate. Header errors fail open. */
export class RiotRateLimitGate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly clock: Clock, private readonly sleep: Sleep) {}

  async beforeRequest(): Promise<void> {
    const now = this.clock();
    const blockedUntil = [...this.buckets.values()].reduce((max, bucket) => Math.max(max, bucket.blockedUntil), now);
    if (blockedUntil > now && Number.isFinite(blockedUntil - now)) {
      await this.sleep(blockedUntil - now);
      // An injected sleeper may not advance an injected clock; consume this gate
      // once so a single observed limit cannot cause an unbounded local loop.
      for (const bucket of this.buckets.values()) {
        if (bucket.blockedUntil === blockedUntil) bucket.blockedUntil = now;
      }
    }
  }

  observe(headers: Headers): void {
    this.observePair("app", headers.get("X-App-Rate-Limit"), headers.get("X-App-Rate-Limit-Count"));
    this.observePair("method", headers.get("X-Method-Rate-Limit"), headers.get("X-Method-Rate-Limit-Count"));
  }

  private observePair(kind: string, limitHeader: string | null, countHeader: string | null): void {
    if (!limitHeader || !countHeader) return;
    const limits = parseBuckets(limitHeader);
    const counts = parseBuckets(countHeader);
    const now = this.clock();
    for (const [windowSeconds, limit] of limits) {
      const count = counts.get(windowSeconds);
      if (count === undefined || !Number.isFinite(limit) || limit <= 0) continue;
      const windowMs = windowSeconds * 1_000;
      if (!Number.isFinite(windowMs) || windowMs <= 0) continue;
      const key = `${kind}:${windowSeconds}`;
      const existing = this.buckets.get(key);
      const blockedUntil = count >= limit ? now + windowMs : existing?.blockedUntil ?? 0;
      this.buckets.set(key, { limit, windowMs, blockedUntil });
    }
  }
}

function parseBuckets(value: string): Map<number, number> {
  const result = new Map<number, number>();
  for (const item of value.split(",")) {
    const [rawValue, rawWindow] = item.trim().split(":");
    const parsedValue = Number(rawValue);
    const parsedWindow = Number(rawWindow);
    if (!Number.isFinite(parsedValue) || !Number.isFinite(parsedWindow) || parsedValue < 0 || parsedWindow <= 0) continue;
    result.set(parsedWindow, parsedValue);
  }
  return result;
}
