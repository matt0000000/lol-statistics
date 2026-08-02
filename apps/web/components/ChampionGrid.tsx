"use client";

import type { PublicChampionSummary, PublicDatasetState, PublicMeta } from "@lol/public-api";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ScopeBar } from "./ScopeBar";
import { roleLabel } from "./RoleSelector";
import { DatasetBanner } from "./DatasetBanner";

const MAX_SEARCH_LENGTH = 80;
function fold(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function ChampionGrid({ champions, meta, warming = false, state }: { champions: PublicChampionSummary[]; meta?: PublicMeta | null; warming?: boolean; state: PublicDatasetState }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const needle = fold(query.trim().slice(0, MAX_SEARCH_LENGTH));
    if (!needle) return champions;
    return champions.filter((champion) => fold(`${champion.name} ${champion.slug}`).includes(needle));
  }, [champions, query]);
  return (
    <section aria-labelledby="champion-heading">
      <ScopeBar meta={meta} warming={warming} />
      <div className="section-heading">
        <div><p className="eyebrow">Champion index</p><h2 id="champion-heading">Find a champion</h2></div>
        <label className="search-field"> <span>Search champions</span>
          <input type="search" aria-label="Search champions" value={query} maxLength={MAX_SEARCH_LENGTH} onChange={(event) => setQuery(event.currentTarget.value.slice(0, MAX_SEARCH_LENGTH))} placeholder="Search by name" />
        </label>
      </div>
      {filtered.length === 0 && !(warming && champions.length === 0) ? <p className="empty-state" role="status">No champions match your search.</p> :
        <ul className="champion-grid" aria-label="Champions">
          {filtered.map((champion) => <li key={champion.championId}>
            <Link className="champion-card" href={`/champions/${encodeURIComponent(champion.slug)}`}>
              <img src={champion.iconUrl} alt={`${champion.name} champion icon`} width={72} height={72} loading="lazy" />
              <span className="champion-card-copy"><strong>{champion.name}</strong><span>{champion.roles.map(roleLabel).join(" · ")}</span></span>
              <span aria-hidden="true" className="card-arrow">→</span>
            </Link>
          </li>)}
        </ul>}
      <DatasetBanner state={warming || !meta ? "warming" : state} publishedAt={meta?.publishedAt} />
    </section>
  );
}
