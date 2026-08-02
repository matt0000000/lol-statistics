import { PUBLIC_METHODOLOGY } from "@lol/public-api";

export const metadata = { title: "Methodology" };

export default async function MethodologyPage() {
  const methodology = PUBLIC_METHODOLOGY;
  const { scope, formulas, collectorRules } = methodology;
  return (
    <main className="site-shell content-page">
      <p className="eyebrow">Transparent evidence</p><h1>Methodology</h1>
      <p className="hero-copy">A publication describes what was collected, how it was classified, and how uncertainty is shown.</p>
      <section><h2>Collection scope</h2><p>{scope.platform}, Ranked Solo queue {scope.queue}, {scope.rank} rank at collection time. Each publication is filtered to the exact current patch and a rolling 35-day window. The supported roles are {Object.values(collectorRules.teamPositionMapping).join(", ")}.</p><p>{collectorRules.remakeRule} Games shorter than {collectorRules.durationMinimumSeconds} seconds are excluded. A player’s tier and division are evaluated when the match is collected, not retroactively.</p><p>Canonical team-position mapping: {Object.entries(collectorRules.teamPositionMapping).map(([source, role]) => `${source} → ${role}`).join(", ")}.</p></section>
      <section><h2>Items and builds</h2><p>We classify completed items using the catalog’s normalized IDs and explicit aliases. Boots are a separate category. Components, starters, consumables, trinkets, support items, mode-only items, and unknown items are excluded.</p><p>Builds are unordered contained numeric multisets: repeated item IDs remain repeated. We report individual items, pairs, and trios; a pair or trio is counted when it is contained in the completed-item multiset. Build rates overlap and therefore do not sum to 100%.</p></section>
      <section><h2>Formulas and confidence</h2><dl><dt>Raw win rate</dt><dd><code>{formulas.rawWinRate}</code></dd><dt>Build rate</dt><dd><code>{formulas.buildRate}</code></dd><dt>Baseline delta</dt><dd><code>{formulas.baselineDelta}</code></dd><dt>Confidence-adjusted score</dt><dd>{formulas.adjustedScore}</dd></dl><p>The minimum sample of {methodology.minimumSample} is a recommendation threshold, not a filter: low-sample rows remain accessible when requested and are labelled low confidence. {methodology.lowConfidence}</p></section>
      <section><h2>Limitations</h2>{methodology.limitations.map((limitation) => <p key={limitation}>{limitation}</p>)}<p>Winning players earn more gold and are more likely to complete expensive items. Hourly batches and publication validation check the dataset before it becomes current.</p><p>This site reports only the scope above; other game modes are not represented in this dataset.</p></section>
    </main>
  );
}
