const CACHE_CONTROL = "public, s-maxage=300, stale-while-revalidate=3600";

export function publicationEtag(publicationId: string, resourceKey: string): string {
  // Both parts are encoded as one opaque token, preventing header injection and
  // making the publication scope explicit in every strong validator.
  const safePublication = encodeURIComponent(publicationId);
  const safeResource = encodeURIComponent(resourceKey);
  return `"publication-${safePublication}-${safeResource}"`;
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
