import { notFound, permanentRedirect } from "next/navigation";
import type { PublicChampion, PublicMeta, PublicQueries, PublicQueryError, PublicStatsResponse, Role, StatsSort, StatsView } from "@lol/public-api";
import { isRole, normalizeChampionSlug, statsSortSchema, statsViewSchema } from "@lol/public-api";
import { RoleSelector, roleLabel } from "../../../components/RoleSelector";
import { ScopeBar } from "../../../components/ScopeBar";
import { StatsTable } from "../../../components/StatsTable";
import { ViewTabs } from "../../../components/ViewTabs";
import { productionPublicQueries } from "../../../lib/route-factory";

export type SearchParams = Record<string, string | string[] | undefined>;
export const dynamic = "force-dynamic";

export type ChampionPageResolution =
  | { kind: "warming" }
  | { kind: "notFound" }
  | { kind: "error" }
  | { kind: "redirect"; location: string }
  | { kind: "ready"; champion: PublicChampion; meta: PublicMeta | null; warming: boolean; selectedRole: Role | null; unavailableRole: string | null; stats: PublicStatsResponse | null; statsError: PublicQueryError["code"] | "error" | null };

function roleState(champion: PublicChampion, searchParams: SearchParams): Pick<ChampionPageResolution & { kind: "ready" }, "selectedRole" | "unavailableRole"> {
  const rawRole = searchParams.role;
  const roleValue = Array.isArray(rawRole) ? null : rawRole;
  const selectedRole: Role | null = roleValue && isRole(roleValue) && champion.roles.includes(roleValue) ? roleValue : null;
  const unavailableRole = rawRole !== undefined && (Array.isArray(rawRole) || !isRole(roleValue) || !champion.roles.includes(roleValue))
    ? (typeof roleValue === "string" && isRole(roleValue) ? roleValue : "That role selection")
    : null;
  return { selectedRole, unavailableRole };
}

function canonicalLocation(champion: PublicChampion, requestedSlug: string, searchParams: SearchParams): string | undefined {
  if (requestedSlug === champion.slug) return undefined;
  const params = new URLSearchParams();
  const parsed = parseStatsParams(searchParams);
  if (parsed.role) params.set("role", parsed.role);
  if (parsed.view !== "items") params.set("view", parsed.view);
  if (parsed.sort !== "adjusted") params.set("sort", parsed.sort);
  if (parsed.lowConfidence) params.set("lowConfidence", "1");
  const query = params.toString();
  return `/champions/${encodeURIComponent(champion.slug)}${query ? `?${query}` : ""}`;
}

export function parseStatsParams(searchParams: SearchParams): { role: Role | null; view: StatsView; sort: StatsSort; lowConfidence: boolean } {
  const roleValue = searchParams.role;
  const role = typeof roleValue === "string" && isRole(roleValue) ? roleValue : null;
  const rawView = searchParams.view;
  const view = typeof rawView === "string" && statsViewSchema.safeParse(rawView).success ? rawView as StatsView : "items";
  const rawSort = searchParams.sort;
  const sort = typeof rawSort === "string" && statsSortSchema.safeParse(rawSort).success ? rawSort as StatsSort : "adjusted";
  const rawLow = searchParams.lowConfidence;
  return { role, view, sort, lowConfidence: rawLow === "1" };
}

/** Pure server resolver, kept separate so redirect/not-found behavior is testable without Next navigation. */
export async function resolveChampionPage(input: { slug: string; searchParams: SearchParams; queries: PublicQueries }): Promise<ChampionPageResolution> {
  if (!normalizeChampionSlug(input.slug)) return { kind: "notFound" };
  let championResult: PublicChampion | PublicQueryError;
  try { championResult = await input.queries.championBySlug(input.slug); }
  catch { return { kind: "error" }; }
  if ("code" in championResult) return championResult.code === "dataset_warming" ? { kind: "warming" } : { kind: "notFound" };
  const location = canonicalLocation(championResult, input.slug, input.searchParams);
  if (location) return { kind: "redirect", location };
  let metaResult: Awaited<ReturnType<PublicQueries["meta"]>>;
  try { metaResult = await input.queries.meta(); }
  catch { return { kind: "error" }; }
  if ("code" in metaResult && metaResult.code !== "dataset_warming") return { kind: "error" };
  const role = roleState(championResult, input.searchParams);
  let stats: PublicStatsResponse | null = null;
  let statsError: PublicQueryError["code"] | "error" | null = null;
  const parsed = parseStatsParams(input.searchParams);
  // A role is intentionally mandatory. Invalid, duplicate, or unavailable
  // values render the selector without issuing a broad/default stats query.
  if (role.selectedRole) {
    try {
      const result = await input.queries.stats({ championId: championResult.championId, role: role.selectedRole, view: parsed.view, sort: parsed.sort, includeLowConfidence: parsed.lowConfidence });
      if ("code" in result) statsError = result.code;
      else stats = result;
    } catch { statsError = "error"; }
  }
  return { kind: "ready", champion: championResult, meta: "code" in metaResult ? null : metaResult, warming: "code" in metaResult, ...role, stats, statsError };
}

export default async function ChampionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const resolution = await resolveChampionPage({ slug, searchParams: query, queries: productionPublicQueries() });
  if (resolution.kind === "notFound") notFound();
  if (resolution.kind === "redirect") permanentRedirect(resolution.location);
  if (resolution.kind === "warming") return <main className="site-shell"><ScopeBar warming /><div className="warming-panel"><p className="eyebrow">Dataset warming</p><h1>Champion data is being prepared.</h1><p>Check back shortly for the current published patch.</p></div></main>;
  if (resolution.kind === "error") return <main className="site-shell"><div className="state-page"><p className="eyebrow">Temporarily unavailable</p><h1>Champion data is unavailable.</h1><p>Please try again shortly.</p></div></main>;
  const { champion, meta, warming, selectedRole, unavailableRole, stats, statsError } = resolution;
  return (
    <main className="site-shell champion-page">
      <ScopeBar meta={meta} warming={warming} />
      <div className="champion-identity">
        <img src={champion.iconUrl} alt={`${champion.name} champion icon`} width={96} height={96} />
        <div><p className="eyebrow">Champion profile</p><h1>{champion.name}</h1><p className="role-summary">Published roles: {champion.roles.map(roleLabel).join(" · ")}</p></div>
      </div>
      <RoleSelector championSlug={champion.slug} roles={champion.roles} selectedRole={selectedRole} unavailableRole={unavailableRole} />
      {selectedRole ? <section className="stats-workspace" aria-labelledby="stats-heading"><p className="eyebrow">{roleLabel(selectedRole)} statistics</p><h2 id="stats-heading">Completed-item evidence</h2><ViewTabs basePath={`/champions/${encodeURIComponent(champion.slug)}`} role={selectedRole} view={stats?.view ?? parseStatsParams(query).view} sort={stats?.sort ?? parseStatsParams(query).sort} includeLowConfidence={stats?.includeLowConfidence ?? parseStatsParams(query).lowConfidence} />{stats ? <StatsTable response={stats} basePath={`/champions/${encodeURIComponent(champion.slug)}`} /> : statsError === "dataset_warming" ? <div className="stats-placeholder" role="status"><p>Statistics are warming up for this publication.</p></div> : statsError === "champion_not_found" || statsError === "role_not_found" ? <div className="stats-placeholder" role="status"><p>Statistics are not available for this champion and role.</p></div> : statsError === "error" ? <div className="stats-placeholder" role="status"><p>Statistics are temporarily unavailable.</p></div> : null}</section> : null}
    </main>
  );
}
