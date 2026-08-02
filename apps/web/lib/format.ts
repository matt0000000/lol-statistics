const percentFormatter = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function finite(value: number): number | null {
  return Number.isFinite(value) ? Object.is(value, -0) ? 0 : value : null;
}

export function formatPercent(value: number): string {
  const normalized = finite(value);
  return normalized === null ? "—" : percentFormatter.format(normalized);
}

export function formatDelta(value: number): string {
  const normalized = finite(value);
  if (normalized === null) return "—";
  const scaled = normalized * 100;
  const sign = scaled > 0 ? "+" : scaled < 0 ? "−" : "";
  return `${sign}${Math.abs(scaled).toFixed(1)} pp`;
}

export function formatGames(value: number): string {
  return Number.isFinite(value) ? `${numberFormatter.format(Math.max(0, Math.trunc(value)))} games` : "—";
}

export function formatInterval(lower: number, upper: number): string {
  const left = formatPercent(lower);
  const right = formatPercent(upper);
  return left === "—" || right === "—" ? "—" : `${left}–${right}`;
}

export function formatAge(publishedAt: string, now = Date.now()): string {
  const published = Date.parse(publishedAt);
  if (!Number.isFinite(published)) return "—";
  const days = Math.max(0, Math.floor((now - published) / 86_400_000));
  return days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
}
