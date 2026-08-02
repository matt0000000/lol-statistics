import { notFound } from "next/navigation";
import type { Role } from "@lol/public-api";
import { RoleSelector, roleLabel } from "../../../components/RoleSelector";
import { ScopeBar } from "../../../components/ScopeBar";
import { productionPublicQueries } from "../../../lib/route-factory";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const ROLES = new Set<Role>(["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]);
export const dynamic = "force-dynamic";
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("tr-TR");

export default async function ChampionPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: SearchParams }) {
  const { slug } = await params;
  const queries = productionPublicQueries();
  const summaries = await queries.champions();
  if (!Array.isArray(summaries)) {
    return <main className="site-shell"><ScopeBar warming /><div className="warming-panel"><p className="eyebrow">Dataset warming</p><h1>Champion data is being prepared.</h1><p>Check back shortly for the current published patch.</p></div></main>;
  }
  const summary = summaries.find((entry) => fold(entry.slug) === fold(slug));
  if (!summary) notFound();
  const championResult = await queries.champion(summary.championId);
  if (!("championId" in championResult)) notFound();
  const champion = championResult;
  const query = await searchParams;
  const rawRole = query.role;
  const roleValue = Array.isArray(rawRole) ? null : rawRole;
  const selectedRole: Role | null = roleValue && ROLES.has(roleValue as Role) && champion.roles.includes(roleValue as Role) ? roleValue as Role : null;
  const unavailableRole = rawRole !== undefined && (Array.isArray(rawRole) || !ROLES.has(roleValue as Role) || !champion.roles.includes(roleValue as Role)) ? (Array.isArray(rawRole) ? "That role selection" : roleValue || "That role selection") : null;
  const meta = await queries.meta();
  return (
    <main className="site-shell champion-page">
      <ScopeBar meta={!('code' in meta) ? meta : null} warming={'code' in meta} />
      <div className="champion-identity">
        <img src={champion.iconUrl} alt={`${champion.name} champion icon`} width={96} height={96} />
        <div><p className="eyebrow">Champion profile</p><h1>{champion.name}</h1><p className="role-summary">Published roles: {champion.roles.map(roleLabel).join(" · ")}</p></div>
      </div>
      <RoleSelector championSlug={champion.slug} roles={champion.roles} selectedRole={selectedRole} unavailableRole={unavailableRole} />
      {selectedRole ? <section className="stats-placeholder" aria-labelledby="stats-heading"><p className="eyebrow">{roleLabel(selectedRole)} statistics</p><h2 id="stats-heading">Statistics are coming into focus.</h2><p>The role is selected. Detailed item and combination results will appear here in the next release.</p></section> : null}
    </main>
  );
}
