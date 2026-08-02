import type { PublicStatus } from "@lol/public-api";
import { productionPublicQueries } from "../../lib/route-factory";

export const metadata = { title: "Dataset status" };
export const dynamic = "force-dynamic";

function dateLabel(value: string | null): string { return value ? new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "Not published"; }

export default async function StatusPage() {
  let status: PublicStatus | null = null;
  try {
    const result = await productionPublicQueries().status();
    if (result && !("code" in result)) status = result;
  } catch { status = null; }
  return (
    <main className="site-shell content-page">
      <p className="eyebrow">Public system status</p><h1>Dataset status</h1>
      {status ? <>
        <section className="status-summary" aria-labelledby="status-current"><h2 id="status-current">Current scope</h2><p><strong>TR1 · Ranked Solo · Emerald+</strong> · Patch {status.patch.version}</p><p>Coverage started: {dateLabel(status.coverageStartedAt)}</p><p>Last successful publication: {dateLabel(status.publishedAt)}{status.publicationAgeSeconds != null ? ` (${Math.floor(status.publicationAgeSeconds / 3600)}h old)` : ""}</p><p>Dataset state: <strong>{status.datasetState}</strong></p></section>
        <section aria-labelledby="status-run"><h2 id="status-run">Collection progress</h2><p>Run status: <strong>{status.runStatus}</strong> · Stage: <strong>{status.stage}</strong></p><dl><dt>Matches discovered</dt><dd>{status.counters.matchesDiscovered}</dd><dt>Matches ingested</dt><dd>{status.counters.matchesIngested}</dd><dt>Eligible observations</dt><dd>{status.counters.observationsAccepted}</dd><dt>Rejected observations</dt><dd>{status.counters.observationsRejected}</dd><dt>Unknown-item observations</dt><dd>{status.unknownItemCount}</dd></dl></section>
        <section aria-labelledby="status-roles"><h2 id="status-roles">Eligible accepted samples by role</h2><ul>{Object.entries(status.eligibleSamplesByRole).map(([role, count]) => <li key={role}>{role}: {count}</li>)}</ul></section>
      </> : <section className="state-page" role="status"><h2>Current patch is warming up</h2><p>The current TR1 patch is being collected and validated. No private collector details are shown here.</p></section>}
    </main>
  );
}
