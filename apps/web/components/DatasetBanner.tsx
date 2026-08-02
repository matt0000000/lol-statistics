import Link from "next/link";
import type { PublicDatasetState } from "@lol/public-api";

const SIX_HOURS = 6 * 60 * 60 * 1000;

/** Pure server-side freshness calculation. No browser clock is consulted. */
export function datasetState(input: { publishedAt?: string | Date | null } | null, now: Date): PublicDatasetState {
  if (!input?.publishedAt) return "warming";
  const published = new Date(input.publishedAt);
  if (!Number.isFinite(published.getTime()) || published.getTime() > now.getTime()) return "warming";
  return now.getTime() - published.getTime() <= SIX_HOURS ? "fresh" : "stale";
}

function formatPublishedAt(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC" : "";
}

export function DatasetBanner({ state, publishedAt }: { state: PublicDatasetState; publishedAt?: string | null }) {
  if (state === "fresh") return null;
  const warming = state === "warming";
  return (
    <aside className="dataset-banner" role="status" aria-live="polite">
      <strong>{warming ? "Current-patch data is warming up." : "Statistics were last updated"}</strong>
      <span>{warming ? "We’re collecting enough current-patch games before publishing this dataset." : `${formatPublishedAt(publishedAt)}. New results are being validated.`}</span>
      <nav aria-label="Dataset information"><Link href="/status">View status</Link><Link href="/methodology">Methodology</Link></nav>
    </aside>
  );
}
