import { notFound, permanentRedirect } from "next/navigation";
import type { PublicChampion, PublicMeta, PublicQueries, PublicQueryError, Role } from "@lol/public-api";
import { isRole, normalizeChampionSlug } from "@lol/public-api";
import { RoleSelector, roleLabel } from "../../../components/RoleSelector";
import { ScopeBar } from "../../../components/ScopeBar";
import { productionPublicQueries } from "../../../lib/route-factory";

export type SearchParams = Record<string, string | string[] | undefined>;
export const dynamic = "force-dynamic";

export type ChampionPageResolution =
  | { kind: "warming" }
  | { kind: "notFound" }
  | { kind: "error" }
  | { kind: "redirect"; location: string }
  | { kind: "ready"; champion: PublicChampion; meta: PublicMeta | null; warming: boolean; selectedRole: Role | null; unavailableRole: string | null };

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
  const rawRole = searchParams.role;
  // Duplicate/array query values are invalid and must never be copied into a redirect.
  if (typeof rawRole === "string" && isRole(rawRole)) params.set("role", rawRole);
  const query = params.toString();
  return `/champions/${encodeURIComponent(champion.slug)}${query ? `?${query}` : ""}`;
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
  return { kind: "ready", champion: championResult, meta: "code" in metaResult ? null : metaResult, warming: "code" in metaResult, ...role };
}

export default async function ChampionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<SearchParams> }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const resolution = await resolveChampionPage({ slug, searchParams: query, queries: productionPublicQueries() });
  if (resolution.kind === "notFound") notFound();
  if (resolution.kind === "redirect") permanentRedirect(resolution.location);
  if (resolution.kind === "warming") return <main className="site-shell"><ScopeBar warming /><div className="warming-panel"><p className="eyebrow">Dataset warming</p><h1>Champion data is being prepared.</h1><p>Check back shortly for the current published patch.</p></div></main>;
  if (resolution.kind === "error") return <main className="site-shell"><div className="state-page"><p className="eyebrow">Temporarily unavailable</p><h1>Champion data is unavailable.</h1><p>Please try again shortly.</p></div></main>;
  const { champion, meta, warming, selectedRole, unavailableRole } = resolution;
  return (
    <main className="site-shell champion-page">
      <ScopeBar meta={meta} warming={warming} />
      <div className="champion-identity">
        <img src={champion.iconUrl} alt={`${champion.name} champion icon`} width={96} height={96} />
        <div><p className="eyebrow">Champion profile</p><h1>{champion.name}</h1><p className="role-summary">Published roles: {champion.roles.map(roleLabel).join(" · ")}</p></div>
      </div>
      <RoleSelector championSlug={champion.slug} roles={champion.roles} selectedRole={selectedRole} unavailableRole={unavailableRole} />
      {selectedRole ? <section className="stats-placeholder" aria-labelledby="stats-heading"><p className="eyebrow">{roleLabel(selectedRole)} statistics</p><h2 id="stats-heading">Statistics are coming into focus.</h2><p>The role is selected. Detailed item and combination results will appear here in the next release.</p></section> : null}
    </main>
  );
}
