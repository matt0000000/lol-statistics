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
    await expect(result).rejects.toSatisfy((error: Error) => !error.message.includes(secret) && !error.message.includes(puuid) && error.message.includes("match"));
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
});
