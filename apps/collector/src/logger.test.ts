import { describe, expect, it } from "vitest";
import { createCollectorLogger } from "./logger";

describe("collector logger", () => {
  it("emits only allowlisted fields and redacts nested and encoded secrets", () => {
    const lines: string[] = [];
    const logger = createCollectorLogger({ write: (line) => lines.push(line) });
    logger.info({ runId: "run-1", stage: "MATCHES", endpointCategory: "match", host: "europe.api.riotgames.com", responseStatus: 200, attempt: 1, duration: 4, aggregateCount: 2, riotApiKey: "RGAPI-secret", puuid: "puuid-secret", headers: { "X-Riot-Token": "RGAPI-secret" }, requestPath: "/matches/puuid-secret" });
    const output = lines.join("\n");
    expect(output).not.toContain("RGAPI-secret");
    expect(output).not.toContain("puuid-secret");
    expect(output).not.toContain(encodeURIComponent("puuid-secret"));
    expect(output).toContain("MATCHES");
    expect(output).not.toContain("requestPath");
  });

  it("preserves sanitized diagnostic codes while excluding private and secret fields", () => {
    const lines: string[] = [];
    const logger = createCollectorLogger({ write: (line) => lines.push(line) });
    logger.error({
      event: "collection_failed",
      diagnosticCode: "57014",
      code: "private-code",
      lowercaseCode: "57014",
      password: "do-not-log",
      message: "secret failure details"
    });
    const output = lines.join("\n");
    expect(output).toContain('"diagnosticCode":"57014"');
    expect(output).not.toContain("private-code");
    expect(output).not.toContain("lowercaseCode");
    expect(output).not.toContain("do-not-log");
    expect(output).not.toContain("secret failure details");
  });
});
