import { describe, expect, it } from "vitest";
import { deriveHealthSnapshot, healthCommand } from "./health";

describe("collector health", () => {
  it("returns sanitized JSON when database configuration is unavailable", async () => {
    const lines: string[] = [];
    const result = await healthCommand({ env: { DATABASE_URL: "postgres://secret-user:secret-pass@db/private" }, json: true, write: (line) => lines.push(line) });
    expect(result).toBe(1);
    const output = lines.join("");
    expect(() => JSON.parse(output)).not.toThrow();
    expect(output).not.toContain("secret-pass");
    expect(output).toContain("database_unavailable");
  });

  it("reports current-patch warming and the failed run instead of stale publication", () => {
    expect(deriveHealthSnapshot({
      currentPatch: { id: 2, patchKey: "16.16" },
      activePublication: { id: "old", patchId: 1, collectedAt: new Date("2026-08-01T00:00:00Z") },
      run: { status: "FAILED", stage: "matches", errorDetails: { category: "auth" }, matchesDiscovered: 4 }
    })).toMatchObject({ patch: "16.16", status: "dataset_warming", datasetState: "dataset_warming", runStatus: "FAILED", stage: "matches", dataAge: null, errorCategory: "auth", counters: { matchesDiscovered: 4 } });
  });

  it("reports ready only when the active publication belongs to current patch", () => {
    expect(deriveHealthSnapshot({ currentPatch: { id: 2, patchKey: "16.16" }, activePublication: { id: "new", patchId: 2, collectedAt: "2026-08-02T00:00:00Z" }, run: { status: "COMPLETED", stage: "publish" } })).toMatchObject({ status: "COMPLETED", datasetState: "ready", dataAge: "2026-08-02T00:00:00.000Z" });
  });
});
