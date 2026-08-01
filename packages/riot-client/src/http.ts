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
      await this.gate.beforeRequest();
      let response: Response;
      try {
        response = await this.fetcher(url, {
          method: "GET",
          redirect: "error",
          headers: { "X-Riot-Token": this.options.apiKey },
        });
      } catch {
        if (retry < MAX_RETRIES) {
          await this.sleep(backoffMs(retry, this.random));
          continue;
        }
        throw this.error("network", null, true, request.path);
      }

      this.gate.observe(response.headers);
      if (response.ok) {
        try {
          const body = await response.json();
          return request.schema.parse(body);
        } catch {
          throw this.error("schema", response.status, false, request.path);
        }
      }

      const category = categoryForStatus(response.status);
      const canRetry = retryableStatus(response.status);
      if (!canRetry || retry >= MAX_RETRIES) {
        throw this.error(category, response.status, canRetry, request.path);
      }
      const retryAfter = response.status === 429 ? parseRetryAfter(response.headers.get("Retry-After")) : null;
      await this.sleep(retryAfter ?? backoffMs(retry, this.random));
    }
  }

  private error(category: RiotErrorCategory, status: number | null, retryable: boolean, path: string): RiotHttpError {
    return new RiotHttpError(`Riot ${category} request failed at ${safeEndpoint(path)}`, status, retryable, category);
  }
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

function safeEndpoint(path: string): string {
  const parts = path.split("?")[0].split("#")[0].split("/").filter(Boolean);
  return `/${parts.slice(0, 4).join("/")}` || "/";
}

function buildUrl(host: string, path: string, forbiddenValue: string): URL {
  if (!path.startsWith("/") || path.includes("#") || path.includes("://") || /[\u0000-\u001f\u007f\r\n]/.test(path) || (forbiddenValue.length > 0 && path.includes(forbiddenValue))) {
    throw new RiotHttpError("Riot schema request failed at /", null, false, "schema");
  }
  if (!/^[A-Za-z0-9.-]+\.api\.riotgames\.com$/.test(host) || host.includes("..")) {
    throw new RiotHttpError("Riot schema request failed at /", null, false, "schema");
  }
  const url = new URL(`https://${host}${path}`);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new RiotHttpError("Riot schema request failed at /", null, false, "schema");
  }
  return url;
}
