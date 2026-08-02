const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

export function publicationEtag(publicationId: string, resourceKey: string): string {
  // Both parts are encoded as one opaque token, preventing header injection and
  // making the publication scope explicit in every strong validator.
  const safePublication = encodeURIComponent(publicationId);
  const safeResource = encodeURIComponent(resourceKey);
  return `"publication-${safePublication}-${safeResource}"`;
}

/** Content-derived strong validator for resources without a publication scope. */
export async function contentEtag(body: unknown): Promise<string> {
  const serialized = JSON.stringify(body);
  const bytes = new TextEncoder().encode(serialized);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", bytes);
    const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    return `"sha256-${hex}"`;
  }
  // Web Crypto is available in supported Next runtimes; this deterministic
  // fallback keeps tests and restricted runtimes cache-safe if it is absent.
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `"content-${(hash >>> 0).toString(16).padStart(8, "0")}"`;
}

export function matchesIfNoneMatch(request: Request, etag: string): boolean {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header.split(",").some((candidate) => {
    const normalized = candidate.trim();
    return normalized === "*" || normalized === etag || normalized === `W/${etag}`;
  });
}

export function cachedJson(request: Request, body: unknown, etag?: string): Response {
  const headers = new Headers({ "Cache-Control": CACHE_CONTROL, "Content-Type": "application/json; charset=utf-8", Vary: "Accept, If-None-Match", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
  if (etag) headers.set("ETag", etag);
  if (etag && matchesIfNoneMatch(request, etag)) return new Response(null, { status: 304, headers });
  return Response.json(body, { status: 200, headers });
}
