const forbiddenWebKeys = ["DATABASE_URL", "RIOT_API_KEY", "RIOT_PLATFORM", "RIOT_REGION"] as const;

export type WebConfig = {
  databaseReadUrl: string;
  publicSiteUrl: string;
};

function parseUrl(value: string | undefined, protocols: readonly string[], credentialsAllowed: boolean): URL | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (!protocols.includes(parsed.protocol)) return undefined;
    if (!credentialsAllowed && (parsed.username || parsed.password)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function normalizePublicUrl(url: URL): string {
  // Keep query/hash semantics while making the origin's root representation stable.
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}${url.search}${url.hash}`;
}

/** Validate only the public origin for metadata generation. Build-time omission
 * is allowed so `next build` can run with the read-only database supplied later;
 * production runtime still fails closed when the value is absent. */
export function readPublicSiteUrl(environment: Record<string, string | undefined> = process.env): string | undefined {
  const raw = environment.PUBLIC_SITE_URL;
  if (!raw) {
    if (environment.NODE_ENV === "production" && environment.NEXT_PHASE !== "phase-production-build") {
      throw new Error("Invalid public site URL");
    }
    return undefined;
  }
  const parsed = parseUrl(raw, ["http:", "https:"], false);
  if (!parsed) throw new Error("Invalid public site URL");
  if (environment.NODE_ENV === "production" && environment.NEXT_PHASE !== "phase-production-build" && parsed.protocol !== "https:") {
    throw new Error("Invalid public site URL");
  }
  return normalizePublicUrl(parsed);
}

/** Parse the deliberately small web environment surface without echoing secrets. */
export function readWebConfig(environment: Record<string, string | undefined>): WebConfig {
  const databaseReadUrl = parseUrl(environment.DATABASE_READ_URL, ["postgres:", "postgresql:"], true);
  const publicSiteUrl = parseUrl(environment.PUBLIC_SITE_URL, ["http:", "https:"], false);
  if (!databaseReadUrl || !publicSiteUrl || forbiddenWebKeys.some((key) => environment[key] !== undefined)) {
    throw new Error("Invalid web configuration");
  }
  return { databaseReadUrl: environment.DATABASE_READ_URL!, publicSiteUrl: normalizePublicUrl(publicSiteUrl) };
}
