import { describe, expect, it, vi } from "vitest";
import { RiotHttpClient } from "./http";

const request = { host: "tr1.api.riotgames.com", path: "/lol/test", schema: { parse: (value: unknown) => value } };

describe("RiotHttpClient", () => {
  it("uses the header key and never places it in the URL", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new RiotHttpClient({ apiKey: "RGAPI-secret", fetcher, sleep: vi.fn() });
    await client.getJson(request);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).not.toContain("RGAPI-secret");
    expect(new Headers(init.headers).get("X-Riot-Token")).toBe("RGAPI-secret");
  });

  it("honors Retry-After once after a 429", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "2" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep, random: () => 0 });
    await client.getJson(request);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it.each([401, 403])("does not retry status %s", async (status) => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep: vi.fn() });
    await expect(client.getJson(request)).rejects.toMatchObject({ status, retryable: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries server failures with exponential backoff and jitter", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep, random: () => 0 });
    await client.getJson(request);
    expect(sleep).toHaveBeenNthCalledWith(1, 250);
    expect(sleep).toHaveBeenNthCalledWith(2, 500);
  });

  it("caps retries at five after the initial attempt", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("", { status: 503 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep, random: () => 0 });
    await expect(client.getJson(request)).rejects.toMatchObject({ status: 503, retryable: true });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(5);
  });

  it("redacts path identifiers and response details from errors", async () => {
    const secret = "RGAPI-secret";
    const puuid = "PUUID-sensitive-value";
    const fetcher = vi.fn().mockResolvedValue(new Response(`contains ${secret}`, { status: 404 }));
    const client = new RiotHttpClient({ apiKey: secret, fetcher, sleep: vi.fn() });
    const result = client.getJson({ host: "tr1.api.riotgames.com", path: `/lol/match/v5/matches/${puuid}`, schema: request.schema });
    await expect(result).rejects.toSatisfy((error: Error) => !error.message.includes(secret) && !error.message.includes(puuid) && error.message.includes("not_found"));
  });

  it("treats malformed JSON and schema failures as nonretryable schema errors", async () => {
    const malformed = new RiotHttpClient({
      apiKey: "RGAPI-test",
      fetcher: vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
      sleep: vi.fn(),
    });
    await expect(malformed.getJson(request)).rejects.toMatchObject({ category: "schema", retryable: false });

    const rejected = new RiotHttpClient({
      apiKey: "RGAPI-test",
      fetcher: vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
      sleep: vi.fn(),
    });
    await expect(rejected.getJson({ ...request, schema: { parse: () => { throw new Error("invalid"); } } })).rejects.toMatchObject({ category: "schema", retryable: false });
  });

  it("waits for a limit bucket before the next request", async () => {
    let now = 1_000;
    const clock = () => now;
    const sleep = vi.fn().mockImplementation(async (milliseconds: number) => { now += milliseconds; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200, headers: {
        "X-App-Rate-Limit": "1:2",
        "X-App-Rate-Limit-Count": "1:2",
      } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep, clock });
    await client.getJson(request);
    await client.getJson(request);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("never includes any request-controlled path or query marker in failure messages", async () => {
    const markers = ["PUUID-SECRET", "SUMMONER-SECRET", "MATCH-SECRET", "QUERY-SECRET", "ENCODED%2FSECRET"];
    const paths = [
      `/PUUID-SECRET/lol/test/${markers[1]}/later/${markers[2]}?q=${markers[3]}`,
      `/lol/match/v5/matches/${markers[2]}/later/${markers[0]}?q=${markers[3]}`,
    ];
    for (const status of [404, 500]) {
      for (const path of paths) {
        const fetcher = vi.fn().mockResolvedValue(new Response("", { status }));
        const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep: vi.fn(), random: () => 0 });
        const failure = client.getJson({ ...request, path });
        const error = await failure.catch((value) => value as Error) as Error;
        expect(error.message).toContain(status === 404 ? "not_found" : "server");
        for (const marker of markers) expect(error.message).not.toContain(marker);
      }
    }

    const schemaClient = new RiotHttpClient({
      apiKey: "RGAPI-test",
      fetcher: vi.fn().mockResolvedValue(new Response("not-json", { status: 200 })),
      sleep: vi.fn(),
    });
    const schemaError = await schemaClient.getJson({ ...request, path: paths[0] }).catch((value) => value as Error) as Error;
    for (const marker of markers) expect(schemaError.message).not.toContain(marker);

    const networkClient = new RiotHttpClient({
      apiKey: "RGAPI-test",
      fetcher: vi.fn().mockRejectedValue(new TypeError("network with MATCH-SECRET")),
      sleep: vi.fn().mockResolvedValue(undefined),
      random: () => 0,
    });
    const networkError = await networkClient.getJson({ ...request, path: paths[1] }).catch((value) => value as Error) as Error;
    for (const marker of markers) expect(networkError.message).not.toContain(marker);
  });

  it("propagates programmer errors without retrying", async () => {
    const programmerError = new Error("bug");
    const fetcher = vi.fn().mockRejectedValue(programmerError);
    const sleep = vi.fn();
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep });
    await expect(client.getJson(request)).rejects.toBe(programmerError);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("does not classify a sleeper failure as a fetch network failure", async () => {
    const sleeperError = new TypeError("sleeper bug");
    const fetcher = vi.fn().mockResolvedValueOnce(new Response("", { status: 429, headers: { "Retry-After": "1" } }));
    const sleep = vi.fn().mockRejectedValue(sleeperError);
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep });
    await expect(client.getJson(request)).rejects.toBe(sleeperError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent fetch attempts and releases the reservation after errors", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const fetcher = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      order.push("start");
      await Promise.resolve();
      inFlight -= 1;
      order.push("finish");
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep: vi.fn() });
    await Promise.all([client.getJson(request), client.getJson(request), client.getJson(request)]);
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(["start", "finish", "start", "finish", "start", "finish"]);

    const failingFetcher = vi.fn()
      .mockRejectedValueOnce(new Error("programmer"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const failingClient = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher: failingFetcher, sleep: vi.fn() });
    await expect(failingClient.getJson(request)).rejects.toThrow("programmer");
    await expect(failingClient.getJson(request)).resolves.toEqual({ ok: true });
    expect(failingFetcher).toHaveBeenCalledTimes(2);
  });

  it("fails safe for malformed rate-limit buckets and Retry-After values", async () => {
    let now = 1_000;
    const sleep = vi.fn().mockImplementation(async (milliseconds: number) => { now += milliseconds; });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("", { status: 429, headers: {
        "Retry-After": "Infinity",
        "X-App-Rate-Limit": "1:2:bad,2:-1,3:0",
        "X-App-Rate-Limit-Count": "1:2:bad,2:2,3:3",
        "X-Method-Rate-Limit": "1:2",
        "X-Method-Rate-Limit-Count": "1:other",
      } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep, clock: () => now, random: () => 0 });
    await client.getJson(request);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("rejects invalid Riot hosts and path attacks before fetch", async () => {
    const fetcher = vi.fn();
    const client = new RiotHttpClient({ apiKey: "RGAPI-secret", fetcher, sleep: vi.fn() });
    for (const host of ["http://tr1.api.riotgames.com", "user:pass@tr1.api.riotgames.com", "evil.example.com", "tr1.api.riotgames.com#fragment"]) {
      await expect(client.getJson({ ...request, host })).rejects.toMatchObject({ retryable: false });
    }
    for (const path of ["https://evil.example/", "/lol/test#fragment", "/lol/test\r\nX-Evil: true"]) {
      await expect(client.getJson({ ...request, path })).rejects.toMatchObject({ retryable: false });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sets redirect:error on every request", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await new RiotHttpClient({ apiKey: "RGAPI-test", fetcher, sleep: vi.fn() }).getJson(request);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });
});
