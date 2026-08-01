import { RiotHttpError, type RiotErrorCategory } from "./errors";
import { RiotRateLimitGate } from "./rate-limit";
import { backoffMs, MAX_RETRIES, retryableStatus } from "./retry";

export type Parser<T> = { parse(value: unknown): T };
export type RiotRequest<T> = { host: string; path: string; schema: Parser<T> };
export type RiotFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RiotHttpClientOptions = {
  apiKey: string;
  fetcher?: RiotFetcher;
  sleep?: (milliseconds: number) => void | Promise<void>;
  clock?: () => number;
  random?: () => number;
};

class FetchFailure {
  constructor(readonly cause: unknown) {}
}

export class RiotHttpClient {
  private readonly fetcher: RiotFetcher;
  private readonly sleep: (milliseconds: number) => void | Promise<void>;
  private readonly random: () => number;
  private readonly gate: RiotRateLimitGate;

  constructor(private readonly options: RiotHttpClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
    this.gate = new RiotRateLimitGate(options.clock ?? Date.now, this.sleep);
  }

  async getJson<T>(request: RiotRequest<T>): Promise<T> {
    const url = buildUrl(request.host, request.path, this.options.apiKey);
    for (let retry = 0; ; retry += 1) {
      let response: Response;
      try {
        response = await this.gate.runExclusive(async () => {
          await this.gate.beforeRequest();
          let result: Response;
          try {
            result = await this.fetcher(url, {
              method: "GET",
              redirect: "error",
              headers: { "X-Riot-Token": this.options.apiKey },
            });
          } catch (error) {
            throw new FetchFailure(error);
          }
          this.gate.observe(result.headers);
          return result;
        });
      } catch (error) {
        if (!(error instanceof FetchFailure)) throw error;
        if (!isRecognizedNetworkFailure(error.cause)) throw error.cause;
        if (retry < MAX_RETRIES) {
          await this.sleep(backoffMs(retry, this.random));
          continue;
        }
        throw this.error("network", null, true);
      }

      if (response.ok) {
        try {
          const body = await response.json();
          return request.schema.parse(body);
        } catch {
          throw this.error("schema", response.status, false);
        }
      }

      const category = categoryForStatus(response.status);
      const canRetry = retryableStatus(response.status);
      if (!canRetry || retry >= MAX_RETRIES) {
        throw this.error(category, response.status, canRetry);
      }
      const retryAfter = response.status === 429 ? parseRetryAfter(response.headers.get("Retry-After")) : null;
      await this.sleep(retryAfter ?? backoffMs(retry, this.random));
    }
  }

  private error(category: RiotErrorCategory, status: number | null, retryable: boolean): RiotHttpError {
    return new RiotHttpError(`Riot ${category} request failed`, status, retryable, category);
  }
}

function isRecognizedNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError;
}

function categoryForStatus(status: number): RiotErrorCategory {
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  return "schema";
}

function parseRetryAfter(value: string | null): number | null {
  if (!value || !/^\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const seconds = Number(value.trim());
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const milliseconds = seconds * 1_000;
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function buildUrl(host: string, path: string, forbiddenValue: string): URL {
  const question = path.indexOf("?");
  const pathname = question < 0 ? path : path.slice(0, question);
  const query = question < 0 ? "" : path.slice(question + 1);
  if (!validHost(host) || !pathname.startsWith("/") || pathname.startsWith("//") || pathname.includes("//") || pathname.includes("\\") || query.includes("\\") || path.includes("#") || path.includes("://") || path.includes("@") || /[\u0000-\u001f\u007f\r\n]/.test(path) || !validPercentEncoding(path) || !validateDecodedLevels(pathname, true) || !validateDecodedLevels(query, false) || containsDecodedSecret(path, forbiddenValue)) failUnsafeUrl();
  const target = pathname + (question < 0 ? "" : `?${query}`);
  let url: URL;
  try {
    url = new URL(`https://${host}${path}`);
  } catch {
    failUnsafeUrl();
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || `${url.pathname}${url.search}` !== target) failUnsafeUrl();
  return url;
}

function validPercentEncoding(value: string): boolean {
  return !/%(?![0-9A-Fa-f]{2})/.test(value);
}

function validateDecodedLevels(value: string, pathname: boolean): boolean {
  let current = value;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!validPercentEncoding(current)) return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return false;
    }
    if (pathname && decoded.split("/").length !== current.split("/").length) return false;
    if (decoded.includes("\\") || decoded.includes("#") || /[\u0000-\u001f\u007f\r\n]/.test(decoded)) return false;
    if (pathname && /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded)) return false;
    if (decoded === current) return true;
    current = decoded;
  }
  return false;
}

function containsDecodedSecret(value: string, secret: string): boolean {
  if (!secret) return false;
  const decoded = decodeRepeated(value);
  return decoded !== null && decoded.includes(secret);
}

function decodeRepeated(value: string): string | null {
  let current = value;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (decoded === current) return current;
    current = decoded;
  }
  return current;
}

function validHost(host: string): boolean {
  if (host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 4) return false;
  const suffix = labels.slice(-3).map((label) => label.toLowerCase()).join(".");
  if (suffix !== "api.riotgames.com") return false;
  return labels.every((label) => label.length >= 1 && label.length <= 63 && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label));
}

function failUnsafeUrl(): never {
  throw new RiotHttpError("Riot schema request failed at /", null, false, "schema");
}
