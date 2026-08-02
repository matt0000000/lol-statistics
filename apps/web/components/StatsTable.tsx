import Link from "next/link";
import type { PublicStatsResponse, Role, StatsSort } from "@lol/public-api";
import { formatAge, formatDelta, formatGames, formatInterval, formatPercent, formatTimestamp } from "../lib/format";
import { statsHref } from "./ViewTabs";
import styles from "./StatsTable.module.css";

const SORTS: readonly [StatsSort, string][] = [["adjusted", "Adjusted score"], ["winRate", "Win rate"], ["baselineDelta", "Baseline delta"], ["buildRate", "Build rate"], ["sample", "Sample games"]];
const labels: Record<StatsSort, string> = { adjusted: "Adjusted score", winRate: "Win rate", baselineDelta: "Baseline delta", buildRate: "Build rate", sample: "Sample games" };

function itemEntries(row: PublicStatsResponse["rows"][number]) {
  const metadata = row.itemMetadata ?? [];
  return row.itemIds.map((id, index) => metadata[index] ?? { id, name: `Item ${id}`, iconUrl: "" });
}

export function StatsTable({ response, basePath = `/champions/${encodeURIComponent(response.champion.slug)}` }: { response: PublicStatsResponse; basePath?: string }) {
  const { champion, role, view, sort, includeLowConfidence, rows } = response;
  const showLowHref = statsHref(basePath, role, view, sort, true);
  const caption = `${champion.name} ${role} statistics, patch ${response.meta.patch.version}, ${view}`;
  if (rows.length === 0) {
    return <section aria-labelledby="stats-results-heading">
      <h2 id="stats-results-heading" className="visually-hidden">Statistics results</h2>
      <p className={styles.summary} aria-label="Statistics freshness summary">
        <span>Last publication <strong><time dateTime={response.meta.publishedAt}>{formatTimestamp(response.meta.publishedAt)}</time></strong> ({formatAge(response.meta.publishedAt)})</span>
      </p>
      <div className={styles.empty} role="status">
        <p>{includeLowConfidence ? "No statistics are available for this view." : "No recommended results meet the minimum sample."}</p>
        {!includeLowConfidence ? <p><Link href={showLowHref}>Show low-confidence results</Link></p> : null}
      </div>
      <p className="limitation-copy">These results show correlation, not causation. Winning players earn more gold and are more likely to complete expensive items.</p>
    </section>;
  }
  return <section aria-labelledby="stats-results-heading">
    <h2 id="stats-results-heading" className="visually-hidden">Statistics results</h2>
    <p className={styles.summary} aria-label="Statistics baseline summary">
      <span>Champion-role win rate <strong>{formatPercent(response.baseline.winRate)}</strong></span>
      <span>Eligible games <strong>{formatGames(response.baseline.sample)}</strong></span>
      <span>Patch <strong>{response.meta.patch.version}</strong></span>
      <span>Coverage start <strong>{new Date(response.meta.coverageStartedAt).toLocaleDateString("en-GB", { timeZone: "UTC" })}</strong></span>
      <span>Published <strong><time dateTime={response.meta.publishedAt}>{formatTimestamp(response.meta.publishedAt)}</time></strong> ({formatAge(response.meta.publishedAt)})</span>
    </p>
    <p className="confidence-toggle">{includeLowConfidence ? <Link href={statsHref(basePath, role, view, sort, false)}>Hide low-confidence results</Link> : <Link href={statsHref(basePath, role, view, sort, true)}>Show low-confidence results</Link>}</p>
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption>{caption}</caption>
        <thead><tr>
          <th scope="col">Build</th>
          {SORTS.map(([value, label]) => <th key={value} scope="col"><Link href={statsHref(basePath, role, view, value, includeLowConfidence)} aria-current={sort === value ? "page" : undefined}>{label}</Link></th>)}
          <th scope="col">95% CI</th><th scope="col">Confidence</th>
        </tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key}>
          <td data-label="Build"><div className={styles.itemCell} aria-label={itemEntries(row).map((item) => item.name).join(", ")}>
            {itemEntries(row).map((item) => item.iconUrl ? <img key={item.id} src={item.iconUrl} alt="" width={32} height={32} /> : null)}
            <span className={styles.itemNames}>{itemEntries(row).map((item) => <span key={`${item.id}-${item.name}`}>{item.name}</span>)}</span>
          </div></td>
          <td data-label={labels.adjusted}>{row.adjustedScore === null ? "—" : formatPercent(row.adjustedScore)}</td>
          <td data-label={labels.winRate}>{formatPercent(row.rawWinRate)}</td>
          <td data-label={labels.buildRate}>{formatPercent(row.buildRate)}</td>
          <td data-label={labels.sample}>{formatGames(row.sample)}</td>
          <td data-label="Baseline delta" className={styles.baseline}>{formatDelta(row.baselineDelta)}</td>
          <td data-label="95% CI">95% CI {formatInterval(row.confidenceLower, row.confidenceUpper)}</td>
          <td data-label="Confidence" className={`${styles.confidence} ${row.confidence === "recommended" ? styles.recommended : styles.low}`}>{row.confidence === "recommended" ? "Recommended" : "Low confidence"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="limitation-copy">These results show correlation, not causation. Winning players earn more gold and are more likely to complete expensive items.</p>
  </section>;
}
