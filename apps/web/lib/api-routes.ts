import {
  publicChampionSchema,
  publicChampionSummarySchema,
  publicMetaSchema,
  publicMethodologySchema,
  publicStatsResponseSchema,
  roleSchema,
  statsSortSchema,
  statsViewSchema,
  type PublicQueries,
  type Role
} from "@lol/public-api";
import { responseForError, mapQueryResult } from "./api-errors";
import { cachedJson, publicationEtag } from "./http-cache";

export type RouteQueries = PublicQueries;
type Context = { params?: Record<string, string> | Promise<Record<string, string>> };
type Handler = (request: Request, context?: Context) => Promise<Response>;

const QUERY_LIMITS = { search: 100 } as const;
const PATH_ID = /^[1-9]\d*$/;

function invalid(): Response { return responseForError({ code: "invalid_request" }); }

function queryValues(request: Request, allowed: readonly string[]): Map<string, string> | Response {
  const url = new URL(request.url);
  const raw = url.search;
  // WHATWG URL accepts malformed percent escapes literally. Reject them so a
  // proxy and Next cannot disagree about the resource key.
  if (/%(?![0-9a-fA-F]{2})/.test(raw) || /[\u0000-\u001f\u007f]/.test(raw)) return invalid();
  if (raw.length > 1 && raw.slice(1).split("&").some((part) => part.length === 0)) return invalid();
  const values = new Map<string, string>();
  for (const [key, value] of url.searchParams.entries()) {
    if (!allowed.includes(key) || values.has(key) || key.includes("\ufffd") || value.includes("\ufffd") || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
    values.set(key, value);
  }
  return values;
}

function positiveChampionId(value: unknown): number | undefined {
  if (typeof value !== "string" || !PATH_ID.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function rawPathSegment(request: Request, marker: string): string | undefined {
  const pathname = new URL(request.url).pathname;
  const index = pathname.indexOf(marker);
  if (index < 0) return undefined;
  const rest = pathname.slice(index + marker.length);
  return rest.split("/")[0];
}

function pathChampionId(request: Request, value: unknown): number | undefined {
  const id = positiveChampionId(value);
  const raw = rawPathSegment(request, "/api/champions/");
  return id !== undefined && (raw === undefined || raw === String(value)) ? id : undefined;
}

function pathRole(request: Request, value: unknown): string | undefined {
  const raw = rawPathSegment(request, "/roles/");
  return typeof value === "string" && (raw === undefined || raw === value) ? value : undefined;
}

async function routeParams(context?: Context): Promise<Record<string, string>> {
  const params = context?.params;
  return params ? await params : {};
}

function scopedId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const direct = record.publicationId;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const meta = record.meta;
  if (meta && typeof meta === "object") {
    const nested = (meta as Record<string, unknown>).publicationId;
    if (typeof nested === "string" && nested.length > 0) return nested;
  }
  return undefined;
}

async function queryErrorOr<T>(operation: () => Promise<T>): Promise<{ value?: T; error?: Response }> {
  try {
    const value = await operation();
    const error = mapQueryResult(value);
    return error ? { error: responseForError(error) } : { value };
  } catch {
    return { error: responseForError({ code: "internal_error" }) };
  }
}

export function createRouteHandlers(queries: RouteQueries) {
  const meta: Handler = async (request) => {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
    const parsed = queryValues(request, []); if (parsed instanceof Response || parsed.size) return invalid();
    const result = await queryErrorOr(() => queries.meta()); if (result.error) return result.error;
    const value = publicMetaSchema.safeParse(result.value); if (!value.success) return responseForError({ code: "internal_error" });
    const id = scopedId(result.value);
    return cachedJson(request, value.data, id ? publicationEtag(id, "meta") : undefined);
  };

  const champions: Handler = async (request) => {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
    const parsed = queryValues(request, ["search"]); if (parsed instanceof Response) return parsed;
    const searchValue = parsed.get("search") ?? null;
    if (searchValue !== null && (searchValue.trim().length === 0 || searchValue.length > QUERY_LIMITS.search)) return invalid();
    const scope = await queryErrorOr(() => queries.meta()); if (scope.error) return scope.error;
    const scopeId = scopedId(scope.value); if (!scopeId) return responseForError({ code: "internal_error" });
    const result = await queryErrorOr(() => queries.champions(searchValue === null ? undefined : searchValue)); if (result.error) return result.error;
    if (!Array.isArray(result.value)) return responseForError({ code: "internal_error" });
    let output;
    try { output = result.value.map((entry) => publicChampionSummarySchema.parse(entry)); }
    catch { return responseForError({ code: "internal_error" }); }
    const key = `champions:${searchValue === null ? "" : searchValue.trim().toLocaleLowerCase("en-US")}`;
    return cachedJson(request, output, publicationEtag(scopeId, key));
  };

  const champion: Handler = async (request, context) => {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
    const parsed = queryValues(request, []); if (parsed instanceof Response || parsed.size) return invalid();
    const params = await routeParams(context); const championId = pathChampionId(request, params.championId); if (!championId) return invalid();
    const scope = await queryErrorOr(() => queries.meta()); if (scope.error) return scope.error;
    const scopeId = scopedId(scope.value); if (!scopeId) return responseForError({ code: "internal_error" });
    const result = await queryErrorOr(() => queries.champion(championId)); if (result.error) return result.error;
    const output = publicChampionSchema.safeParse(result.value); if (!output.success) return responseForError({ code: "internal_error" });
    return cachedJson(request, output.data, publicationEtag(scopeId, `champion:${championId}`));
  };

  const stats: Handler = async (request, context) => {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
    const parsed = queryValues(request, ["view", "sort", "includeLowConfidence"]); if (parsed instanceof Response) return parsed;
    const params = await routeParams(context); const championId = pathChampionId(request, params.championId); if (!championId) return invalid();
    const role = roleSchema.safeParse(pathRole(request, params.role)); if (!role.success) return invalid();
    const view = statsViewSchema.safeParse(parsed.get("view") ?? "items"); if (!view.success) return invalid();
    const sort = statsSortSchema.safeParse(parsed.get("sort") ?? "adjusted"); if (!sort.success) return invalid();
    const includeRaw = parsed.get("includeLowConfidence");
    if (includeRaw !== undefined && !["true", "false", "1", "0"].includes(includeRaw)) return invalid();
    const includeLowConfidence = includeRaw === "true" || includeRaw === "1";
    const result = await queryErrorOr(() => queries.stats({ championId, role: role.data as Role, view: view.data, sort: sort.data, includeLowConfidence })); if (result.error) return result.error;
    const scopeId = scopedId(result.value);
    const output = publicStatsResponseSchema.safeParse(result.value); if (!output.success) return responseForError({ code: "internal_error" });
    if (!scopeId) return responseForError({ code: "internal_error" });
    return cachedJson(request, output.data, publicationEtag(scopeId, `stats:${championId}:${role.data}:${view.data}:${sort.data}:${includeLowConfidence ? 1 : 0}`));
  };

  const methodology: Handler = async (request) => {
    if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } });
    const parsed = queryValues(request, []); if (parsed instanceof Response || parsed.size) return invalid();
    const result = await queryErrorOr(() => queries.methodology()); if (result.error) return result.error;
    const output = publicMethodologySchema.safeParse(result.value); if (!output.success) return responseForError({ code: "internal_error" });
    return cachedJson(request, output.data);
  };

  return { meta, champions, champion, stats, methodology };
}
