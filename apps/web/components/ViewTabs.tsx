import Link from "next/link";
import type { Role, StatsSort, StatsView } from "@lol/public-api";

const VIEWS: readonly [StatsView, string][] = [["items", "Items"], ["pairs", "2-item builds"], ["trios", "3-item builds"], ["boots", "Boots"]];

export function statsHref(basePath: string, role: Role, view: StatsView, sort: StatsSort, includeLowConfidence: boolean): string {
  const params = new URLSearchParams({ role });
  if (view !== "items") params.set("view", view);
  if (sort !== "adjusted") params.set("sort", sort);
  if (includeLowConfidence) params.set("lowConfidence", "1");
  const query = params.toString();
  return `${basePath}${query ? `?${query}` : ""}`;
}

export function ViewTabs({ basePath, role, view, sort, includeLowConfidence }: { basePath: string; role: Role; view: StatsView; sort: StatsSort; includeLowConfidence: boolean }) {
  return <nav className="view-tabs" aria-label="Statistics view">
    {VIEWS.map(([value, label]) => <Link key={value} href={statsHref(basePath, role, value, sort, includeLowConfidence)} aria-current={view === value ? "page" : undefined}>{label}</Link>)}
  </nav>;
}
