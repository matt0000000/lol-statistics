import type { PublicChampionSummary, PublicMeta } from "@lol/public-api";
import { ChampionGrid } from "../components/ChampionGrid";
import { datasetState } from "../components/DatasetBanner";
import { productionPublicQueries } from "../lib/route-factory";

export const metadata = { title: "LoL Statistics — Champion builds", description: "Explore public League of Legends champion statistics for TR1 Emerald+ Ranked Solo." };
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const queries = productionPublicQueries();
  const [metaResult, championsResult] = await Promise.all([queries.meta(), queries.championDirectory()]);
  const warming = ("code" in metaResult) || !Array.isArray(championsResult);
  const meta = !("code" in metaResult) ? metaResult as PublicMeta : null;
  const champions = Array.isArray(championsResult) ? championsResult as PublicChampionSummary[] : [];
  const freshnessState = warming || !meta ? "warming" : datasetState(meta, new Date());
  return (
    <main className="site-shell">
      <header className="hero">
        <p className="eyebrow">TR1 / public data</p>
        <h1>Know the build.<br /><em>Play the matchup.</em></h1>
        <p className="hero-copy">A clear read on champion builds from the current published dataset. Choose a champion, then choose the role you actually play.</p>
      </header>
      <ChampionGrid champions={champions} meta={meta} warming={warming} state={freshnessState} />
    </main>
  );
}
