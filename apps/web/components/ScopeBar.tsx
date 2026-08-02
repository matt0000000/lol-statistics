import type { PublicMeta } from "@lol/public-api";

export function ScopeBar({ meta, warming = false }: { meta?: PublicMeta | null; warming?: boolean }) {
  const dateLabel = (value: string) => new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const state = warming || !meta ? "Dataset warming" : `Published ${dateLabel(meta.publishedAt)}`;
  return (
    <aside className="scope-bar" aria-label="Current data scope">
      <span className="scope-title">Scope</span>
      <span aria-label="TR1 · Ranked Solo · Emerald+">TR1 · Ranked Solo · Emerald+</span>
      {meta ? <span>Patch {meta.patch.version}</span> : <span>Current patch</span>}
      {meta ? <span>Data through {dateLabel(meta.collectedAt)}</span> : null}
      <span className={warming || !meta ? "scope-status is-warming" : "scope-status"}>{state}</span>
    </aside>
  );
}
