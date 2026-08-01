export const MAX_RETRIES = 5;

export function backoffMs(attempt: number, random: () => number): number {
  const value = random();
  const jitter = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return Math.min(4_000, 250 * 2 ** attempt) * (1 + jitter * 0.2);
}

export function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
