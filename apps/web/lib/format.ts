const percentFormatter = new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function finite(value: number): number | null {
  return Number.isFinite(value) ? Object.is(value, -0) ? 0 : value : null;
}

export function formatPercent(value: number): string {
  const normalized = finite(value);
  if (normalized === null) return "—";
  const rounded = Number((normalized * 100).toFixed(1)) / 100;
  return percentFormatter.format(Object.is(rounded, -0) ? 0 : rounded);
}

export function formatDelta(value: number): string {
  const normalized = finite(value);
  if (normalized === null) return "—";
  // Round before choosing the sign so values that display as zero never leak
  // a misleading negative sign (for example -0.0004 -> +0.0 pp).
  const scaled = Number((normalized * 100).toFixed(1));
  const sign = scaled >= 0 ? "+" : "−";
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

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC`
    : "—";
}
